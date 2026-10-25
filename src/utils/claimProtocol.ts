import {
  TRUST_PROTOCOL_VERSION,
  type Attempt,
  type ClaimEvaluationPayload,
  type ClaimPredicate,
  type ClaimStatus,
  type ClaimVerdict,
  type ClassificationDiagnostics,
  type ConclusionTrust,
  type EvaluationClaim,
  type ExperimentTaskType,
  type LedgerEvent,
  type PredicateResult,
  type Study,
} from '@/types/experiment';
import { ExperimentProtocolError, sha256ProtocolValue, stableProtocolJson } from '@/utils/experimentProtocol';
import { projectClaimUnseal } from '@/utils/claimUnsealProjection';
import {
  clopperPearsonInterval,
  combinePredicateVerdicts,
  seededBootstrapInterval,
  verdictForInterval,
  wilsonInterval,
} from '@/utils/statistics';

const PROPORTION_METRICS = new Set(['accuracy', 'recall', 'precision', 'false_positive_rate']);
const REGRESSION_METRICS = new Set(['mae', 'rmse', 'r2']);

/* ---------------- 枚举守卫与信任等级排序的协议层单一来源 ----------------
 * 持久化数据不能被 TypeScript 联合类型担保（parseExperimentLedger 只验顶层结构），
 * UI、报告与导出不得各自复制白名单；等级比较只接受已验证的合法枚举。 */

export function isKnownClaimStatus(value: unknown): value is ClaimStatus {
  return value === 'draft' || value === 'frozen' || value === 'adjudicated' || value === 'post_hoc';
}

/** Attempt 状态白名单（协议层自持，与 AttemptStatus 联合类型同步）：未知状态失败关闭。 */
const KNOWN_ATTEMPT_STATUS_VALUES: ReadonlySet<string> = new Set([
  'pending', 'starting', 'running', 'paused', 'completed', 'interrupted', 'failed', 'cancelled',
]);

export function isKnownConclusionTrust(value: unknown): value is ConclusionTrust {
  return value === 'not_evaluated' || value === 'exploratory' || value === 'iid_only' || value === 'gold';
}

/** verdict 是否为三个正式裁决值之一；未知字符串/空值一律不算（防持久化数据绕过类型）。 */
export function isAuthoritativeVerdict(verdict: unknown): verdict is ClaimVerdict {
  return verdict === 'pass' || verdict === 'fail' || verdict === 'inconclusive';
}

export const CONCLUSION_TRUST_RANK: Readonly<Record<ConclusionTrust, number>> = {
  not_evaluated: 0,
  exploratory: 1,
  iid_only: 2,
  gold: 3,
};

/** 取两个合法等级中更低者（存档与重算不一致时的失败关闭合并）。 */
export function lowerConclusionTrust(a: ConclusionTrust, b: ConclusionTrust): ConclusionTrust {
  return CONCLUSION_TRUST_RANK[a] <= CONCLUSION_TRUST_RANK[b] ? a : b;
}

/** 取两个合法等级中更高者（实验包最高有效等级的安全排序）。 */
export function maxConclusionTrust(a: ConclusionTrust, b: ConclusionTrust): ConclusionTrust {
  return CONCLUSION_TRUST_RANK[a] >= CONCLUSION_TRUST_RANK[b] ? a : b;
}

function createId(prefix: string): string {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export interface ClaimPreflight {
  blockers: string[];
  warnings: string[];
}

/**
 * A claim snapshot is not evidence by itself. Trust-bearing exports must be able
 * to reconstruct the same draft, freeze and adjudication from the append-only
 * event stream, and must still bind to the exact Attempt artifacts.
 */
export function isClaimAuditComplete(
  claim: EvaluationClaim,
  attempt: Attempt | null | undefined,
  events: LedgerEvent[],
): boolean {
  if (
    !attempt
    || claim.status !== 'adjudicated'
    || !claim.frozenHash
    || !claim.preprocessingHash
    // 失败关闭（模块 06 跨界补丁）：持久化异常值即使与事件“互相一致”也不算完整审计链。
    || !Number.isSafeInteger(claim.unsealSequence)
    || (claim.unsealSequence as number) <= 0
    || !isAuthoritativeVerdict(claim.verdict)
    || !isKnownConclusionTrust(claim.conclusionTrust)
    || attempt.provenance.modelWeightsHash !== claim.modelWeightsHash
    || attempt.provenance.testSetHash !== claim.testDatasetHash
    || attempt.provenance.preprocessingHash !== claim.preprocessingHash
    || claim.predicateResults.length !== claim.predicates.length
    || !claim.predicateResults.every(result => (
      isAuthoritativeVerdict(result.verdict)
      && Number.isFinite(result.pointEstimate)
      && Number.isFinite(result.lowerBound)
      && Number.isFinite(result.upperBound)
      && Number.isFinite(result.confidenceLevel)
      && Number.isFinite(result.effectiveSampleSize)
      && result.lowerBound <= result.upperBound
    ))
  ) return false;

  const claimEvents = events.filter(event => event.entityType === 'claim' && event.entityId === claim.id);
  const matchingDrafts = claimEvents.filter(event => (
    (event.eventType === 'claim_draft_created' || event.eventType === 'claim_draft_revised')
    && event.payload.revision === claim.revision
    && event.payload.attemptId === claim.attemptId
    && event.payload.modelWeightsHash === claim.modelWeightsHash
    && event.payload.testSetHash === claim.testDatasetHash
    && event.payload.preprocessingHash === claim.preprocessingHash
    && stableProtocolJson(event.payload.predicates) === stableProtocolJson(claim.predicates)
  ));
  const matchingFreezes = claimEvents.filter(event => (
    event.eventType === 'claim_frozen'
    && event.payload.frozenHash === claim.frozenHash
    && event.payload.revision === claim.revision
    && event.payload.attemptId === claim.attemptId
    && event.payload.modelWeightsHash === claim.modelWeightsHash
    && event.payload.testSetHash === claim.testDatasetHash
    && event.payload.preprocessingHash === claim.preprocessingHash
  ));
  const matchingAdjudications = claimEvents.filter(event => (
    event.eventType === 'claim_adjudicated'
    && event.payload.frozenHash === claim.frozenHash
    && event.payload.unsealSequence === claim.unsealSequence
    && event.payload.verdict === claim.verdict
    && event.payload.conclusionTrust === claim.conclusionTrust
    && stableProtocolJson(event.payload.predicateResults) === stableProtocolJson(claim.predicateResults)
  ));

  /* 解封许可见证（模块 08 最终运行时原子性补丁）：
   * Claim 快照不是证据；封存测试集访问必须由只追加 claim_unsealed 事件授权。
   * 复用测试集级共享投影 projectClaimUnseal（单一来源，不在此另写一套解封身份推断）：
   * - 必须存在与当前 Claim 完整匹配的合法解封事件（mode='retry' 且序号等于快照）；
   *   这同时排除：缺失、身份不匹配、重复、冲突、非法序号、授权链断裂；
   * - claim_evaluation_retried 不能替代首次 claim_unsealed 授权（投影只看 claim_unsealed）。 */
  const unsealProjection = projectClaimUnseal(claim, events);
  if (unsealProjection.mode !== 'retry' || unsealProjection.recordedSequence !== claim.unsealSequence) return false;

  // 生命周期顺序：当前 revision 的 draft → claim_frozen → claim_unsealed → claim_adjudicated；
  // 顺序颠倒不得判定审计完整（重复/缺失已由上方各 matching 计数与投影拦截）。
  const firstIndex = (predicate: (event: LedgerEvent) => boolean): number => claimEvents.findIndex(predicate);
  const draftIndex = firstIndex(event => matchingDrafts.includes(event));
  const freezeIndex = firstIndex(event => matchingFreezes.includes(event));
  const unsealIndex = firstIndex(event => (
    event.eventType === 'claim_unsealed'
    && event.payload.frozenHash === claim.frozenHash
    && event.payload.testSetHash === claim.testDatasetHash
    && event.payload.unsealSequence === claim.unsealSequence
  ));
  const adjudicationIndex = firstIndex(event => matchingAdjudications.includes(event));
  const lifecycleOrdered = draftIndex !== -1 && freezeIndex !== -1 && unsealIndex !== -1 && adjudicationIndex !== -1
    && draftIndex < freezeIndex
    && freezeIndex < unsealIndex
    && unsealIndex < adjudicationIndex;

  return matchingDrafts.length === 1
    && matchingFreezes.length === 1
    && matchingAdjudications.length === 1
    && lifecycleOrdered;
}

export function validateClaimPredicates(
  predicates: ClaimPredicate[],
  taskType: ExperimentTaskType,
  classCount?: number,
): void {
  const primaryCount = predicates.filter(predicate => predicate.role === 'primary').length;
  const guardrailCount = predicates.filter(predicate => predicate.role === 'guardrail').length;
  if (primaryCount !== 1 || guardrailCount > 2 || predicates.length !== primaryCount + guardrailCount) {
    throw new ExperimentProtocolError('主张必须包含 1 个主指标，最多再加 2 个 AND 护栏');
  }
  const ids = new Set<string>();
  for (const predicate of predicates) {
    if (!predicate.id || ids.has(predicate.id)) throw new ExperimentProtocolError('主张子句 ID 缺失或重复');
    ids.add(predicate.id);
    if (!Number.isFinite(predicate.threshold)) throw new ExperimentProtocolError('验收线必须是有限数值');
    if (!(predicate.confidenceLevel >= 0.8 && predicate.confidenceLevel < 1)) {
      throw new ExperimentProtocolError('置信水平必须位于 [0.8, 1)');
    }
    if (!Number.isInteger(predicate.minimumEffectiveSampleSize) || predicate.minimumEffectiveSampleSize < 1) {
      throw new ExperimentProtocolError('最小有效样本量必须是正整数');
    }
    if (predicate.decisionThreshold !== undefined) {
      throw new ExperimentProtocolError('当前协议只见证模型原始 Top-1 决策，尚不接受事后决策阈值');
    }
    const isRegressionMetric = REGRESSION_METRICS.has(predicate.metric);
    if ((taskType === 'tabular_regression') !== isRegressionMetric) {
      throw new ExperimentProtocolError('主张指标与 Study 任务类型不一致');
    }
    const expectedOperator = ['false_positive_rate', 'mae', 'rmse'].includes(predicate.metric) ? 'lte' : 'gte';
    if (predicate.operator !== expectedOperator) {
      throw new ExperimentProtocolError(`${predicate.metric} 只接受 ${expectedOperator === 'gte' ? '≥' : '≤'} 方向的验收线`);
    }
    if (PROPORTION_METRICS.has(predicate.metric)) {
      if (predicate.threshold < 0 || predicate.threshold > 1) {
        throw new ExperimentProtocolError('比例指标阈值必须位于 [0, 1]');
      }
      if (!['wilson', 'clopper_pearson'].includes(predicate.intervalMethod)) {
        throw new ExperimentProtocolError('比例指标只允许 Wilson 或 Clopper-Pearson 区间');
      }
    } else {
      if (predicate.intervalMethod !== 'seeded_bootstrap') {
        throw new ExperimentProtocolError('macro-F1 与回归指标必须使用种子化 bootstrap');
      }
      if (!Number.isInteger(predicate.bootstrapSamples) || predicate.bootstrapSamples! < 500 || predicate.bootstrapSamples! > 100_000) {
        throw new ExperimentProtocolError('bootstrapSamples 必须是 500 到 100000 的整数');
      }
      if (!Number.isInteger(predicate.bootstrapSeed)) {
        throw new ExperimentProtocolError('bootstrapSeed 必须冻结为整数');
      }
    }
    if (['recall', 'precision', 'false_positive_rate'].includes(predicate.metric) && !predicate.targetClass?.trim()) {
      throw new ExperimentProtocolError(`${predicate.metric} 必须冻结目标类别`);
    }
    if (predicate.targetClass !== undefined) {
      const targetClass = Number(predicate.targetClass);
      if (!/^\d+$/.test(predicate.targetClass.trim()) || !Number.isSafeInteger(targetClass)) {
        throw new ExperimentProtocolError('目标类别必须是非负整数索引');
      }
      if (classCount !== undefined && targetClass >= classCount) {
        throw new ExperimentProtocolError(`目标类别索引超出数据集的 ${classCount} 个类别`);
      }
    }
  }
}

function knownEffectiveSampleSize(predicate: ClaimPredicate, attempt: Attempt): number | null {
  if (predicate.metric === 'accuracy' || REGRESSION_METRICS.has(predicate.metric) || predicate.metric === 'macro_f1') {
    return attempt.provenance.testSampleCount;
  }
  if (predicate.metric === 'recall' && predicate.targetClass) {
    return attempt.provenance.testLabelCounts?.[predicate.targetClass] ?? 0;
  }
  if (predicate.metric === 'false_positive_rate' && predicate.targetClass && attempt.provenance.testLabelCounts) {
    const positives = attempt.provenance.testLabelCounts[predicate.targetClass] ?? 0;
    return Math.max(0, (attempt.provenance.testSampleCount ?? 0) - positives);
  }
  // precision 的分母取决于模型预测，答案可见前无法知道。
  return null;
}

export function preflightClaim(predicates: ClaimPredicate[], attempt: Attempt): ClaimPreflight {
  const blockers: string[] = [];
  const warnings: string[] = [];
  for (const predicate of predicates) {
    const adjustedConfidence = 1 - (1 - predicate.confidenceLevel) / predicates.length;
    if (predicate.metric === 'r2' && (attempt.provenance.testTargetSummary?.variance ?? 0) <= Number.EPSILON) {
      blockers.push('R² 的封存目标方差为 0，数学上无法计算');
      continue;
    }
    const n = knownEffectiveSampleSize(predicate, attempt);
    if (n === 0) {
      blockers.push(`${predicate.metric} 的有效样本量为 0，数学上无法计算`);
      continue;
    }
    if (n === null) {
      warnings.push(`${predicate.metric} 的有效样本量取决于预测结果，冻结前无法预知`);
      continue;
    }
    if (n < predicate.minimumEffectiveSampleSize) {
      warnings.push(`${predicate.metric} 当前最多只有 ${n} 个有效样本，低于冻结值 ${predicate.minimumEffectiveSampleSize}`);
    }
    if (PROPORTION_METRICS.has(predicate.metric)) {
      const interval = predicate.intervalMethod === 'clopper_pearson'
        ? clopperPearsonInterval(predicate.operator === 'gte' ? n : 0, n, adjustedConfidence)
        : wilsonInterval(predicate.operator === 'gte' ? n : 0, n, adjustedConfidence);
      if (verdictForInterval(predicate.operator, predicate.threshold, interval[0], interval[1]) !== 'pass') {
        warnings.push(`${predicate.metric} 即使结果最理想也无法 PASS，但仍可能得到确定 FAIL`);
      }
      if (interval[1] - interval[0] > 0.2) {
        warnings.push(`${predicate.metric} 的理想情形区间宽度仍超过 0.20，证据可能不足`);
      }
    }
  }
  return { blockers, warnings };
}

export function createDraftClaim(study: Study, attempt: Attempt, predicates: ClaimPredicate[], now = Date.now()): EvaluationClaim {
  if (study.kind !== 'candidate_selection') {
    throw new ExperimentProtocolError('单模型验收主张只属于候选选择型 Study；探索或消融证据需先升级为候选 Study');
  }
  if (!study.selectedAttemptId || study.selectedAttemptId !== attempt.id) {
    throw new ExperimentProtocolError('必须先按 Study 选择规则留痕选定具体 Attempt，才能冻结验收主张');
  }
  if (attempt.status !== 'completed' || attempt.provenance.executionTrust !== 'trusted') {
    throw new ExperimentProtocolError('只有受控管线完整完成的可信 Attempt 才能预注册主张');
  }
  if (!attempt.provenance.modelWeightsHash || !attempt.provenance.testSetHash) {
    throw new ExperimentProtocolError('Attempt 缺少权重身份或封存测试集身份');
  }
  if (!attempt.provenance.preprocessingHash) {
    throw new ExperimentProtocolError('Attempt 缺少运行时预处理身份');
  }
  validateClaimPredicates(predicates, study.datasetContract.identity.taskType, study.datasetContract.identity.classCount);
  return {
    id: createId('claim'),
    protocolVersion: TRUST_PROTOCOL_VERSION,
    studyId: study.id,
    attemptId: attempt.id,
    modelWeightsHash: attempt.provenance.modelWeightsHash,
    testDatasetHash: attempt.provenance.testSetHash,
    preprocessingHash: attempt.provenance.preprocessingHash,
    status: 'draft',
    revision: 1,
    predicates: predicates.map(predicate => ({ ...predicate })),
    frozenHash: null,
    frozenAt: null,
    unsealSequence: null,
    adjudicatedAt: null,
    verdict: null,
    predicateResults: [],
    classificationDiagnostics: null,
    conclusionTrust: 'not_evaluated',
    createdAt: now,
    updatedAt: now,
  };
}

export async function freezeClaim(claim: EvaluationClaim, study: Study, attempt: Attempt, now = Date.now()): Promise<EvaluationClaim> {
  if (claim.status !== 'draft') throw new ExperimentProtocolError('只有草稿主张可以冻结');
  if (!Number.isInteger(claim.revision) || claim.revision < 1) throw new ExperimentProtocolError('主张草稿缺少有效版本号，请先保存为当前协议草稿');
  if (claim.attemptId !== attempt.id || claim.studyId !== study.id) throw new ExperimentProtocolError('主张绑定关系已漂移');
  if (claim.modelWeightsHash !== attempt.provenance.modelWeightsHash || claim.testDatasetHash !== attempt.provenance.testSetHash) {
    throw new ExperimentProtocolError('主张冻结前权重或测试集身份已变化');
  }
  if (claim.preprocessingHash !== attempt.provenance.preprocessingHash) {
    throw new ExperimentProtocolError('主张冻结前预处理身份已变化');
  }
  validateClaimPredicates(claim.predicates, study.datasetContract.identity.taskType, study.datasetContract.identity.classCount);
  const frozenHash = await sha256ProtocolValue({
    protocolVersion: claim.protocolVersion,
    claimId: claim.id,
    studyId: claim.studyId,
    attemptId: claim.attemptId,
    modelWeightsHash: claim.modelWeightsHash,
    testDatasetHash: claim.testDatasetHash,
    preprocessingHash: claim.preprocessingHash,
    taskType: study.datasetContract.identity.taskType,
    classCount: study.datasetContract.identity.classCount ?? null,
    revision: claim.revision,
    predicates: claim.predicates,
  });
  return { ...claim, status: 'frozen', frozenHash, frozenAt: now, updatedAt: now };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricForIndices(metric: 'mae' | 'rmse' | 'r2', targets: number[], predictions: number[], indices: number[]): number {
  const errors = indices.map(index => predictions[index] - targets[index]);
  if (metric === 'mae') return mean(errors.map(Math.abs));
  if (metric === 'rmse') return Math.sqrt(mean(errors.map(error => error * error)));
  const selectedTargets = indices.map(index => targets[index]);
  const targetMean = mean(selectedTargets);
  const total = selectedTargets.reduce((sum, target) => sum + (target - targetMean) ** 2, 0);
  if (total <= Number.EPSILON) return Number.NaN;
  const residual = errors.reduce((sum, error) => sum + error * error, 0);
  return 1 - residual / total;
}

function macroF1(targets: number[], predictions: number[], indices: number[], classes: number[]): number {
  if (classes.length === 0) return Number.NaN;
  return mean(classes.map(targetClass => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const index of indices) {
      if (targets[index] === targetClass && predictions[index] === targetClass) tp += 1;
      else if (targets[index] !== targetClass && predictions[index] === targetClass) fp += 1;
      else if (targets[index] === targetClass && predictions[index] !== targetClass) fn += 1;
    }
    return tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  }));
}

function proportionCounts(predicate: ClaimPredicate, payload: ClaimEvaluationPayload): [number, number] {
  const targetClass = predicate.targetClass === undefined ? null : Number(predicate.targetClass);
  if (targetClass !== null && !Number.isFinite(targetClass)) throw new ExperimentProtocolError('目标类别必须是可解析的类别索引');
  let successes = 0;
  let total = 0;
  payload.targets.forEach((target, index) => {
    const prediction = payload.predictions[index];
    if (predicate.metric === 'accuracy') {
      total += 1;
      if (prediction === target) successes += 1;
    } else if (predicate.metric === 'recall' && target === targetClass) {
      total += 1;
      if (prediction === targetClass) successes += 1;
    } else if (predicate.metric === 'precision' && prediction === targetClass) {
      total += 1;
      if (target === targetClass) successes += 1;
    } else if (predicate.metric === 'false_positive_rate' && target !== targetClass) {
      total += 1;
      if (prediction === targetClass) successes += 1;
    }
  });
  return [successes, total];
}

export function adjudicatePredicates(
  predicates: ClaimPredicate[],
  payload: ClaimEvaluationPayload,
): { results: PredicateResult[]; verdict: ClaimVerdict } {
  if (payload.targets.length === 0 || payload.targets.length !== payload.predictions.length) {
    throw new ExperimentProtocolError('eval-only 返回的目标与预测长度无效');
  }
  if (![...payload.targets, ...payload.predictions].every(Number.isFinite)) {
    throw new ExperimentProtocolError('eval-only 返回了 NaN 或 Infinity');
  }
  if (payload.taskType === 'image_classification') {
    if (!Number.isSafeInteger(payload.classCount) || (payload.classCount ?? 0) < 2) {
      throw new ExperimentProtocolError('分类 eval-only 缺少冻结的完整类别数');
    }
    if (![...payload.targets, ...payload.predictions].every(value => (
      Number.isSafeInteger(value) && value >= 0 && value < payload.classCount!
    ))) {
      throw new ExperimentProtocolError('分类 eval-only 返回了越界或非整数类别索引');
    }
  }
  const indices = payload.targets.map((_value, index) => index);
  const fixedClasses = payload.taskType === 'image_classification'
    ? Array.from({ length: payload.classCount! }, (_value, index) => index)
    : [];
  const results = predicates.map(predicate => {
    let pointEstimate: number;
    let lowerBound: number;
    let upperBound: number;
    let effectiveSampleSize: number;
    const adjustedConfidence = 1 - (1 - predicate.confidenceLevel) / predicates.length;
    if (PROPORTION_METRICS.has(predicate.metric)) {
      const [successes, total] = proportionCounts(predicate, payload);
      if (total === 0) throw new ExperimentProtocolError(`${predicate.metric} 的有效样本量为 0`);
      pointEstimate = successes / total;
      [lowerBound, upperBound] = predicate.intervalMethod === 'clopper_pearson'
        ? clopperPearsonInterval(successes, total, adjustedConfidence)
        : wilsonInterval(successes, total, adjustedConfidence);
      effectiveSampleSize = total;
    } else if (predicate.metric === 'macro_f1') {
      pointEstimate = macroF1(payload.targets, payload.predictions, indices, fixedClasses);
      [lowerBound, upperBound] = seededBootstrapInterval(
        indices,
        sample => macroF1(payload.targets, payload.predictions, sample, fixedClasses),
        adjustedConfidence,
        predicate.bootstrapSamples,
        predicate.bootstrapSeed,
      );
      effectiveSampleSize = indices.length;
    } else {
      const metric = predicate.metric as 'mae' | 'rmse' | 'r2';
      pointEstimate = metricForIndices(metric, payload.targets, payload.predictions, indices);
      [lowerBound, upperBound] = seededBootstrapInterval(
        indices,
        sample => metricForIndices(metric, payload.targets, payload.predictions, sample),
        adjustedConfidence,
        predicate.bootstrapSamples,
        predicate.bootstrapSeed,
      );
      effectiveSampleSize = indices.length;
    }
    if (![pointEstimate, lowerBound, upperBound].every(Number.isFinite)) {
      throw new ExperimentProtocolError(`${predicate.metric} 无法在当前测试集上计算`);
    }
    const verdict = effectiveSampleSize < predicate.minimumEffectiveSampleSize
      ? 'inconclusive'
      : verdictForInterval(predicate.operator, predicate.threshold, lowerBound, upperBound);
    return { predicateId: predicate.id, pointEstimate, lowerBound, upperBound, effectiveSampleSize, confidenceLevel: adjustedConfidence, verdict };
  });
  return { results, verdict: combinePredicateVerdicts(results) };
}

export function buildClassificationDiagnostics(
  payload: ClaimEvaluationPayload,
  declaredClassNames: string[] = [],
): ClassificationDiagnostics {
  if (payload.taskType !== 'image_classification') throw new ExperimentProtocolError('回归任务没有混淆矩阵');
  const values = [...payload.targets, ...payload.predictions];
  if (payload.targets.length === 0 || payload.targets.length !== payload.predictions.length
    || !values.every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new ExperimentProtocolError('无法从无效分类预测建立混淆矩阵');
  }
  const indices = [...new Set([
    ...declaredClassNames.map((_name, index) => index),
    ...values,
  ])].sort((left, right) => left - right);
  const counts = new Map<string, number>();
  payload.targets.forEach((actual, index) => {
    const predicted = payload.predictions[index];
    const key = `${actual}:${predicted}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const labelFor = (classIndex: number) => declaredClassNames[classIndex] ?? String(classIndex);
  const entries = [...counts.entries()].map(([key, count]) => {
    const [actual, predicted] = key.split(':').map(Number);
    return { actual, predicted, count };
  }).sort((left, right) => left.actual - right.actual || left.predicted - right.predicted);
  const perClassRecall = indices.map(classIndex => {
    const support = entries.filter(entry => entry.actual === classIndex).reduce((sum, entry) => sum + entry.count, 0);
    const truePositive = entries.find(entry => entry.actual === classIndex && entry.predicted === classIndex)?.count ?? 0;
    return { classIndex, label: labelFor(classIndex), support, recall: support > 0 ? truePositive / support : null };
  });
  return {
    classIndices: indices,
    classLabels: indices.map(labelFor),
    entries,
    perClassRecall,
  };
}

export function conclusionTrustFor(study: Study, attempt: Attempt, unsealSequence: number): EvaluationClaim['conclusionTrust'] {
  if (unsealSequence !== 1 || attempt.provenance.executionTrust !== 'trusted') return 'exploratory';
  const split = study.datasetContract.split;
  // 当前区间以单样本 IID 为单位；group/temporal 相关性需 cluster/block bootstrap 才能升金。
  if (split.strategy === 'group' || split.strategy === 'temporal') return 'iid_only';
  const atomicSampleUnit = study.datasetContract.identity.taskType === 'tabular_regression' ? 'row' : 'image';
  if (split.sampleUnit !== atomicSampleUnit) return 'iid_only';
  const contractDeclared = split.independence === 'machine_verified'
    || (split.independence === 'user_declared' && Boolean(split.userDeclaration?.trim()));
  const machineChecksPass = attempt.provenance.machineChecks.length > 0
    && attempt.provenance.machineChecks.every(check => check.status === 'passed');
  return contractDeclared && machineChecksPass ? 'gold' : 'iid_only';
}

/* ---------------- 有效信任投影的单一来源（模块 06 跨界补丁） ----------------
 * Study 总览、ClaimComposer、Study 报告、实验包导出必须共同消费本投影；
 * 可信等级不得因“在哪个页面查看、从哪个按钮导出”而变化。
 * 除 claimRuntime 写入存档与本函数内部外，任何读取/展示/导出位置
 * 不得直接调用 conclusionTrustFor 生成有效等级。 */

export type EffectiveTrustReason =
  | 'claim_not_in_study'
  | 'attempt_missing'
  | 'attempt_mismatch'
  | 'unknown_claim_status'
  | 'not_adjudicated'
  | 'post_hoc'
  | 'missing_verdict'
  | 'unknown_verdict'
  | 'unknown_conclusion_trust'
  | 'audit_incomplete'
  | 'audit_persistence_not_healthy'
  | 'attempt_not_eligible'
  | 'trust_mismatch';

export interface EffectiveClaimTrustProjection {
  /** 有效信任等级：任一闸门失败时为 not_evaluated，绝不升级。 */
  effectiveTrust: ConclusionTrust;
  /** 经合法性验证的存档等级；未知/损坏值为 null。 */
  archivedTrust: ConclusionTrust | null;
  /** 原始存档值（仅保留事实，绝不参与等级；UI 不得直接展示）。 */
  archivedTrustRaw: unknown;
  /** 协议重算值；未达重算闸门时为 null。 */
  recomputedTrust: ConclusionTrust | null;
  /** 权威 verdict（仅 adjudicated 且通过 isAuthoritativeVerdict 时非空）。 */
  verdict: ClaimVerdict | null;
  /** 是否具备有效背书资格（全部闸门通过）。 */
  eligible: boolean;
  /** 实体只追加审计链是否完整（isClaimAuditComplete）。 */
  auditComplete: boolean;
  /** 存档与重算不一致（此时 eligible 仍可为 true，等级取低）。 */
  trustMismatch: boolean;
  reasons: EffectiveTrustReason[];
}

export interface ProjectEffectiveClaimTrustInput {
  study: Study;
  claim: EvaluationClaim;
  /** 必须能验证归属：传入作用域内查到的 Attempt（查不到传 null）。 */
  attempt: Attempt | null | undefined;
  events: readonly LedgerEvent[];
  auditPersistence: 'unavailable' | 'healthy' | 'degraded';
}

/**
 * 统一闸门（全部通过才有有效等级）：
 * 1 claim.studyId === study.id；2 attempt 存在；3 claim.attemptId === attempt.id；
 * 4 status 是已知的 adjudicated；5 verdict 是三个正式值之一；
 * 6 存档 conclusionTrust 是已知枚举；7 isClaimAuditComplete 通过；
 * 8 auditPersistence === 'healthy'；9 conclusionTrustFor 重算；
 * 10 存档与重算取较低等级；11 不一致返回明确原因；12 任一闸门失败绝不升级。
 * PASS/FAIL/INCONCLUSIVE 不影响信任资格。
 */
export function projectEffectiveClaimTrust(
  input: ProjectEffectiveClaimTrustInput,
): EffectiveClaimTrustProjection {
  const { study, claim, attempt, events, auditPersistence } = input;
  const reasons: EffectiveTrustReason[] = [];

  const archivedTrustRaw: unknown = claim.conclusionTrust;
  const knownArchived = isKnownConclusionTrust(archivedTrustRaw);
  const archivedTrust: ConclusionTrust | null = knownArchived ? archivedTrustRaw : null;
  if (!knownArchived) reasons.push('unknown_conclusion_trust');

  const knownStatus = isKnownClaimStatus(claim.status);
  if (!knownStatus) reasons.push('unknown_claim_status');
  const adjudicated = knownStatus && claim.status === 'adjudicated';
  if (!adjudicated) {
    reasons.push('not_adjudicated');
    if (knownStatus && claim.status === 'post_hoc') reasons.push('post_hoc');
  }

  if (claim.studyId !== study.id) reasons.push('claim_not_in_study');
  if (!attempt) reasons.push('attempt_missing');
  else if (attempt.id !== claim.attemptId) reasons.push('attempt_mismatch');

  /* Attempt 资格门（模块 08 最终运行时原子性补丁）：
   * 绑定 Attempt 必须是已知的 completed 状态且 executionTrust='trusted'；
   * 外部/中断/未知状态执行不能因为存在测试结果而升级为 gold/iid_only/exploratory 背书。
   * 状态白名单在协议层自持（不得导入 UI 层 studyLabels，避免循环依赖）。 */
  const attemptEligible = Boolean(attempt)
    && KNOWN_ATTEMPT_STATUS_VALUES.has(String(attempt?.status))
    && attempt?.status === 'completed'
    && attempt?.provenance.executionTrust === 'trusted';
  if (attempt && !attemptEligible) reasons.push('attempt_not_eligible');

  const verdict: ClaimVerdict | null = adjudicated && isAuthoritativeVerdict(claim.verdict)
    ? claim.verdict
    : null;
  if (adjudicated && verdict === null) {
    reasons.push(claim.verdict === null || claim.verdict === undefined ? 'missing_verdict' : 'unknown_verdict');
  }

  // 实体审计完整性只对 adjudicated 且归属可验的 Claim 有意义。
  const auditComplete = adjudicated && Boolean(attempt) && attempt?.id === claim.attemptId
    && claim.studyId === study.id
    && isClaimAuditComplete(claim, attempt ?? null, [...events]);
  if (adjudicated && !auditComplete) reasons.push('audit_incomplete');

  const persistenceHealthy = auditPersistence === 'healthy';
  if (adjudicated && !persistenceHealthy) reasons.push('audit_persistence_not_healthy');

  const eligible = adjudicated
    && claim.studyId === study.id
    && Boolean(attempt) && attempt?.id === claim.attemptId
    && attemptEligible
    && verdict !== null
    && knownArchived
    && auditComplete
    && persistenceHealthy;

  let recomputedTrust: ConclusionTrust | null = null;
  let effectiveTrust: ConclusionTrust = 'not_evaluated';
  let trustMismatch = false;
  if (eligible && attempt) {
    recomputedTrust = conclusionTrustFor(study, attempt, claim.unsealSequence ?? 0);
    const archived = archivedTrust as ConclusionTrust;
    trustMismatch = archived !== recomputedTrust;
    if (trustMismatch) reasons.push('trust_mismatch');
    effectiveTrust = lowerConclusionTrust(archived, recomputedTrust);
  }

  return {
    effectiveTrust,
    archivedTrust,
    archivedTrustRaw,
    recomputedTrust,
    verdict,
    eligible,
    auditComplete,
    trustMismatch,
    reasons,
  };
}
