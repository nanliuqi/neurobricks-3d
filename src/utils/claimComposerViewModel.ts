/**
 * Claim 工作流纯视图模型（模块 08）：
 * - 无 React、无 store 写入、无副作用；
 * - 候选绑定投影：只读展示当前候选，不伪装可选择；
 * - 严格指标复用模块 07 单一来源，不读数组尾项、不猜指标名/方向/单位；
 * - 状态/verdict 标签失败关闭：未知 status → 主张状态异常；未知 verdict → 裁决记录异常；
 * - predicate 结构校验按 role 判定，不按数组 index；
 * - 冻结/解封复核视图完整呈现身份与统计规格；
 * - 有效信任一律来自 projectEffectiveClaimTrust，绝不直接读存档 conclusionTrust 背书。
 */
import type {
  Attempt,
  ClaimPredicate,
  EvaluationClaim,
  Experiment,
  ExperimentLedgerV1,
  Study,
} from '@/types/experiment';
import { isAuthoritativeVerdict, isKnownClaimStatus } from '@/utils/claimProtocol';
import { isKnownAttemptStatus, attemptStatusLabel } from '@/components/panels/study/studyLabels';
import type { UnsealProjection } from '@/utils/claimUnsealProjection';
import {
  finalStrictMetric,
  formatStrictMetricValue,
  strictMetricDescriptor,
} from '@/utils/metricSeries';

/* ---------------- 候选绑定投影 ---------------- */

export interface CandidateBinding {
  /** no_candidate：Study 未选候选；candidate_not_in_study：候选 ID 不属于当前 Study（失败关闭）。 */
  status: 'no_candidate' | 'candidate_not_in_study' | 'bound';
  attempt: Attempt | null;
  experiment: Experiment | null;
  experimentNumber: number | null;
  /** 中文资格阻断原因：未完成/不可信/缺权重/缺测试集/缺预处理哈希。 */
  blockers: string[];
  canCreateClaim: boolean;
  /** 严格验证指标摘要；不可用时诚实说明，不阻止合法 Claim 创建。 */
  strictMetricText: string;
  strictMetricAvailable: boolean;
}

export function candidateBinding(study: Study, ledger: ExperimentLedgerV1): CandidateBinding {
  const studyExperiments = ledger.experiments.filter(experiment => experiment.studyId === study.id);
  if (!study.selectedAttemptId) {
    return {
      status: 'no_candidate', attempt: null, experiment: null, experimentNumber: null,
      blockers: [], canCreateClaim: false,
      strictMetricText: '严格验证指标不可用', strictMetricAvailable: false,
    };
  }
  const attempt = ledger.attempts.find(item => item.id === study.selectedAttemptId) ?? null;
  const experiment = attempt
    ? studyExperiments.find(item => item.id === attempt.experimentId) ?? null
    : null;
  // 候选 Attempt 必须属于当前 Study：全局存在不代表当前 Study 的证据（失败关闭）。
  if (!attempt || !experiment) {
    return {
      status: 'candidate_not_in_study', attempt: null, experiment: null, experimentNumber: null,
      blockers: ['候选 Attempt 不属于当前 Study 或不存在，已失败关闭'],
      canCreateClaim: false,
      strictMetricText: '严格验证指标不可用', strictMetricAvailable: false,
    };
  }
  const blockers: string[] = [];
  // 未知 Attempt status 不展示原始字符串：显示“Attempt 状态异常”并失败关闭。
  if (!isKnownAttemptStatus(attempt.status)) {
    blockers.push('Attempt 状态异常（无法识别的运行状态），已失败关闭');
  } else if (attempt.status !== 'completed') {
    blockers.push(`Attempt 状态为“${attemptStatusLabel(attempt.status)}”，不是已完成运行`);
  }
  if (attempt.provenance.executionTrust !== 'trusted') blockers.push('Attempt 不是受控管线可信执行');
  if (!attempt.provenance.modelWeightsHash) blockers.push('缺少模型权重哈希');
  if (!attempt.provenance.testSetHash) blockers.push('缺少测试集哈希');
  if (!attempt.provenance.preprocessingHash) blockers.push('缺少预处理哈希');

  // 严格指标摘要：复用模块 07 单一来源，绝不读取数组尾项或猜指标语义。
  const descriptor = strictMetricDescriptor(attempt);
  const finalMetric = descriptor.available
    ? finalStrictMetric(attempt, descriptor.descriptor.metricName)
    : null;
  const strictMetricAvailable = descriptor.available && finalMetric !== null;
  const strictMetricText = strictMetricAvailable && finalMetric
    ? `validation ${descriptor.available ? descriptor.descriptor.metricName : ''}=${formatStrictMetricValue(descriptor.available ? descriptor.descriptor.metricName : '', finalMetric.value)}（epoch ${finalMetric.epoch}）`
    : '严格验证指标不可用';

  return {
    status: 'bound',
    attempt,
    experiment,
    experimentNumber: studyExperiments.findIndex(item => item.id === experiment.id) + 1,
    blockers,
    canCreateClaim: blockers.length === 0,
    strictMetricText,
    strictMetricAvailable,
  };
}

/* ---------------- predicate 结构校验（按 role，不按 index） ---------------- */

export interface PredicateStructureValidation {
  errors: string[];
  primaryCount: number;
  guardrailCount: number;
}

export function validatePredicateStructure(predicates: readonly ClaimPredicate[]): PredicateStructureValidation {
  const errors: string[] = [];
  const known = predicates.filter(predicate => predicate.role === 'primary' || predicate.role === 'guardrail');
  const primaryCount = predicates.filter(predicate => predicate.role === 'primary').length;
  const guardrailCount = predicates.filter(predicate => predicate.role === 'guardrail').length;
  if (known.length !== predicates.length) errors.push('存在角色无法识别的子句（既不是 primary 也不是 guardrail）');
  if (primaryCount === 0) errors.push('缺少主指标（role=primary）；不得把数组第一项强行解释为主指标');
  if (primaryCount > 1) errors.push(`存在 ${primaryCount} 个主指标；一条主张只允许一个主指标`);
  if (guardrailCount > 2) errors.push(`AND 护栏超过上限（${guardrailCount}/2）`);
  const ids = predicates.map(predicate => predicate.id);
  if (new Set(ids).size !== ids.length) errors.push('子句 ID 重复；React key 与协议身份都要求稳定唯一');
  return { errors, primaryCount, guardrailCount };
}

/* ---------------- 状态 / verdict 标签（失败关闭） ---------------- */

export interface ClaimLabelSet {
  statusLabel: string;
  statusAbnormal: boolean;
  verdictText: string;
  /** 未知 verdict：不得冒充 INCONCLUSIVE 或未裁决。 */
  verdictAbnormal: boolean;
}

const KNOWN_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  frozen: '已冻结',
  adjudicated: '已裁决',
  post_hoc: '事后主张',
};

export function claimLabelSet(claim: EvaluationClaim): ClaimLabelSet {
  const statusKnown = isKnownClaimStatus(claim.status);
  const statusLabel = statusKnown ? KNOWN_STATUS_LABELS[claim.status] ?? String(claim.status) : '主张状态异常';
  let verdictText = '尚未裁决';
  let verdictAbnormal = false;
  if (claim.verdict !== null && claim.verdict !== undefined) {
    if (isAuthoritativeVerdict(claim.verdict)) {
      verdictText = claim.verdict === 'pass' ? 'PASS' : claim.verdict === 'fail' ? 'FAIL' : 'INCONCLUSIVE';
    } else {
      verdictText = '裁决记录异常';
      verdictAbnormal = true;
    }
  }
  return { statusLabel, statusAbnormal: !statusKnown, verdictText, verdictAbnormal };
}

/* ---------------- 冻结复核视图 ---------------- */

export interface FreezeReviewRow {
  label: string;
  value: string;
}

export function predicateSpecRows(predicate: ClaimPredicate): FreezeReviewRow[] {
  const rows: FreezeReviewRow[] = [
    { label: '角色', value: predicate.role === 'primary' ? '主指标' : 'AND 护栏' },
    { label: '指标 / 验收方向 / 阈值', value: `${predicate.metric} ${predicate.operator === 'gte' ? '≥' : '≤'} ${predicate.threshold}` },
    { label: '置信度', value: String(predicate.confidenceLevel) },
    { label: '区间方法', value: predicate.intervalMethod },
    { label: '最小有效样本 n', value: String(predicate.minimumEffectiveSampleSize) },
  ];
  if (predicate.targetClass !== undefined) rows.push({ label: '目标类别', value: String(predicate.targetClass) });
  if (predicate.aggregation !== undefined) rows.push({ label: '聚合', value: predicate.aggregation });
  if (predicate.bootstrapSamples !== undefined) rows.push({ label: 'Bootstrap 次数', value: String(predicate.bootstrapSamples) });
  if (predicate.bootstrapSeed !== undefined) rows.push({ label: 'Bootstrap seed', value: String(predicate.bootstrapSeed) });
  return rows;
}

/** 长哈希截断展示；完整值必须经 Tooltip/复制入口可核对，不得只留省略文本。 */
export function truncateHash(hash: string | null | undefined): string {
  if (!hash) return '缺失';
  return hash.length > 22 ? `${hash.slice(0, 18)}…` : hash;
}

/* ---------------- 解封复核视图（消费测试集级共享投影） ---------------- */

export interface UnsealReview {
  /** first=首次；subsequent=同测试集事后验证；retry=对已留痕裁决的重试。invalid 不生成复核视图。 */
  mode: 'first' | 'subsequent' | 'retry';
  claimId: string;
  studyId: string;
  attemptId: string;
  revision: number | null;
  frozenHash: string | null;
  /** 冻结 Claim 自身身份：确认框必须展示这些值，不得拿当前 Attempt 哈希冒充。 */
  claimModelWeightsHash: string | null;
  claimTestDatasetHash: string | null;
  claimPreprocessingHash: string | null;
  /** 当前 Attempt 身份（供核对；漂移已由身份闸门在按钮层关闭）。 */
  attemptModelWeightsHash: string | null;
  attemptTestSetHash: string | null;
  attemptPreprocessingHash: string | null;
  attemptModelId: string | null;
  sequence: number;
  testSetHistory: number[];
  reasons: string[];
  snapshotMismatch: boolean;
}

export function unsealReview(
  claim: EvaluationClaim,
  attempt: Attempt | null,
  projection: UnsealProjection,
): UnsealReview | null {
  if (claim.status !== 'frozen') return null;
  if (projection.mode === 'invalid' || projection.sequence === null) return null;
  return {
    mode: projection.mode,
    claimId: claim.id,
    studyId: claim.studyId,
    attemptId: claim.attemptId,
    revision: claim.revision ?? null,
    frozenHash: claim.frozenHash,
    claimModelWeightsHash: claim.modelWeightsHash,
    claimTestDatasetHash: claim.testDatasetHash,
    claimPreprocessingHash: claim.preprocessingHash,
    attemptModelWeightsHash: attempt?.provenance.modelWeightsHash ?? null,
    attemptTestSetHash: attempt?.provenance.testSetHash ?? null,
    attemptPreprocessingHash: attempt?.provenance.preprocessingHash ?? null,
    attemptModelId: attempt?.modelId ?? null,
    sequence: projection.sequence,
    testSetHistory: projection.testSetHistory,
    reasons: projection.reasons,
    snapshotMismatch: projection.snapshotMismatch,
  };
}

/**
 * 解封身份闸门（UI 按钮层与确认复核共用同一判定）：
 * 自身完整校验，不依赖调用方预检——
 * Claim frozenHash/revision/三哈希完整；Attempt 存在、状态已知且 completed、trusted、
 * modelId 非空；Experiment/Study 归属一致；Claim↔Attempt 三哈希一致；
 * 未知枚举失败关闭且不展示原始值。
 */
export function unsealIdentityGate(
  claim: EvaluationClaim,
  attempt: Attempt | null,
  experiment: Experiment | null,
  study: Study,
): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (claim.studyId !== study.id) reasons.push('Claim 不属于当前 Study');
  if (!claim.frozenHash) reasons.push('主张缺少冻结哈希');
  if (claim.revision !== null && (!Number.isSafeInteger(claim.revision) || claim.revision < 1)) {
    reasons.push('主张 revision 非法');
  }
  if (!claim.modelWeightsHash || !claim.testDatasetHash || !claim.preprocessingHash) {
    reasons.push('主张身份哈希不完整');
  }
  if (!attempt) reasons.push('找不到冻结主张绑定的 Attempt');
  if (attempt) {
    if (!isKnownAttemptStatus(attempt.status)) {
      reasons.push('Attempt 状态异常（无法识别的运行状态），已失败关闭');
    } else if (attempt.status !== 'completed') {
      reasons.push(`Attempt 状态为“${attemptStatusLabel(attempt.status)}”，不是已完成运行`);
    }
    if (attempt.provenance.executionTrust !== 'trusted') reasons.push('Attempt 不是受控管线可信执行');
    if (!attempt.modelId) reasons.push('Attempt 缺少独立权重文件身份（modelId）');
    if (!attempt.provenance.modelWeightsHash || !attempt.provenance.testSetHash || !attempt.provenance.preprocessingHash) {
      reasons.push('Attempt 身份哈希不完整');
    }
  }
  if (attempt && !experiment) reasons.push('找不到 Attempt 所属 Experiment');
  if (experiment && experiment.studyId !== study.id) reasons.push('Experiment 不属于当前 Study');
  if (attempt) {
    if (claim.modelWeightsHash !== attempt.provenance.modelWeightsHash) reasons.push('冻结权重哈希与当前 Attempt 不一致（身份漂移）');
    if (claim.testDatasetHash !== attempt.provenance.testSetHash) reasons.push('冻结测试集哈希与当前 Attempt 不一致（身份漂移）');
    if (claim.preprocessingHash !== attempt.provenance.preprocessingHash) reasons.push('冻结预处理哈希与当前 Attempt 不一致（身份漂移）');
  }
  return { allowed: reasons.length === 0, reasons };
}

/* ---------------- 结果卡视图 ---------------- */

export function finiteText(value: number | null | undefined, digits = 4): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '不可用';
}

export interface ResultRow {
  predicateId: string;
  role: string;
  metric: string;
  acceptance: string;
  pointEstimate: string;
  interval: string;
  effectiveSampleSize: string;
  actualConfidence: string;
  intervalMethod: string;
  clauseVerdict: string;
}

export function resultRows(claim: EvaluationClaim): ResultRow[] {
  return claim.predicateResults.map(result => {
    const predicate = claim.predicates.find(item => item.id === result.predicateId);
    const clauseVerdict = isAuthoritativeVerdict(result.verdict)
      ? result.verdict === 'pass' ? 'PASS' : result.verdict === 'fail' ? 'FAIL' : 'INCONCLUSIVE'
      : '子句裁决异常';
    return {
      predicateId: result.predicateId,
      // 未知角色失败关闭：不得把所有非 primary 强行显示为护栏。
      role: predicate?.role === 'primary' ? '主指标' : predicate?.role === 'guardrail' ? 'AND 护栏' : '角色异常',
      metric: predicate?.metric ?? '指标未知',
      acceptance: predicate ? `${predicate.operator === 'gte' ? '≥' : '≤'} ${predicate.threshold}` : '验收线未知',
      pointEstimate: finiteText(result.pointEstimate),
      interval: `[${finiteText(result.lowerBound)}, ${finiteText(result.upperBound)}]`,
      effectiveSampleSize: finiteText(result.effectiveSampleSize, 0),
      actualConfidence: Number.isFinite(result.confidenceLevel) ? `${(result.confidenceLevel * 100).toFixed(2)}%` : '不可用',
      intervalMethod: predicate?.intervalMethod ?? '方法未知',
      clauseVerdict,
    };
  });
}

/** predicateResults 重复 predicateId 检测：重复时展示异常，不静默覆盖。 */
export function hasDuplicatePredicateResults(claim: EvaluationClaim): boolean {
  const ids = claim.predicateResults.map(result => result.predicateId);
  return new Set(ids).size !== ids.length;
}

/** 混淆矩阵计数合法性：必须是非负有限整数，否则展示“不可用”。 */
export function matrixCountText(count: unknown): string {
  return typeof count === 'number' && Number.isFinite(count) && Number.isInteger(count) && count >= 0
    ? String(count)
    : '不可用';
}

/** 草稿绑定漂移：候选变化后旧草稿不得改绑保存，必须引导创建新草稿。 */
export function draftBindingDrifted(editingClaim: EvaluationClaim | null, binding: CandidateBinding): boolean {
  if (!editingClaim) return false;
  if (binding.status !== 'bound' || !binding.attempt) return true;
  return editingClaim.attemptId !== binding.attempt.id;
}
