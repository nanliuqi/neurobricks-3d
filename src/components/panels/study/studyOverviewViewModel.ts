/**
 * Study 总览纯视图模型（模块 06）：只做派生，不写 store、不产生副作用。
 * 证据作用域是硬规则：当前 Study 只能看到严格归属自己的
 * Experiment / Attempt / Claim，不得凭 ID 或名称相似推测归属。
 */
import type {
  Attempt,
  ClaimVerdict,
  ConclusionTrust,
  EvaluationClaim,
  Experiment,
  ExperimentLedgerV1,
  LedgerEvent,
  Study,
} from '@/types/experiment';
import type { TrainMetric } from '@/types/training';
import { studyUsedGpuMinutes } from '@/utils/studyProtocol';
import {
  CONCLUSION_TRUST_RANK,
  isKnownClaimStatus,
  projectEffectiveClaimTrust,
} from '@/utils/claimProtocol';
import {
  isAttemptActive,
  isAttemptCompleted,
  isExecutionTrusted,
  isKnownAttemptStatus,
  isKnownExecutionTrust,
  splitStrategyLabel,
  verdictLabel,
} from './studyLabels';

/* ---------------- 活动 Study 解析与证据作用域 ---------------- */

/** 活动 Study 解析：不存在或已归档一律安全返回 null（读取方不得替换成其他 Study）。 */
export function resolveActiveStudy(ledger: ExperimentLedgerV1, activeStudyId: string | null): Study | null {
  if (!activeStudyId) return null;
  const study = ledger.studies.find(item => item.id === activeStudyId);
  if (!study || study.archivedAt) return null;
  return study;
}

export interface StudyEvidenceScope {
  experiments: Experiment[];
  attempts: Attempt[];
  claims: EvaluationClaim[];
}

/** 严格证据作用域：Experiment 按 studyId，Attempt 按归属 Experiment，Claim 按 studyId。 */
export function scopeStudyEvidence(ledger: ExperimentLedgerV1, studyId: string): StudyEvidenceScope {
  const experiments = ledger.experiments.filter(item => item.studyId === studyId);
  const experimentIds = new Set(experiments.map(item => item.id));
  return {
    experiments,
    attempts: ledger.attempts.filter(item => experimentIds.has(item.experimentId)),
    claims: ledger.claims.filter(item => item.studyId === studyId),
  };
}

/* ---------------- Attempt 选择规则 ---------------- */

/** 最新 Attempt 按 ordinal 确定；不得假定 ledger 数组最后一项就是最新。 */
export function selectLatestAttempt(attempts: readonly Attempt[]): Attempt | null {
  let latest: Attempt | null = null;
  for (const attempt of attempts) {
    if (!latest || attempt.ordinal > latest.ordinal) latest = attempt;
  }
  return latest;
}

/** 候选入口规则：同一 Experiment 中最新（按 ordinal）、完成且执行可信的 Attempt。 */
export function selectLatestSelectableCandidate(attempts: readonly Attempt[]): Attempt | null {
  let candidate: Attempt | null = null;
  for (const attempt of attempts) {
    if (!isAttemptCompleted(attempt.status) || !isExecutionTrusted(attempt.provenance.executionTrust)) continue;
    if (!candidate || attempt.ordinal > candidate.ordinal) candidate = attempt;
  }
  return candidate;
}

/* ---------------- 指标展示 ---------------- */

/** 指标值：优先 metricValue，其次 accuracy；NaN/Infinity/缺失一律不可用。 */
export function formatMetricValue(metric: TrainMetric | null | undefined): string | null {
  if (!metric) return null;
  const candidates = [metric.metricValue, metric.accuracy];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(4);
  }
  return null;
}

/* ---------------- 证据摘要 ---------------- */

export interface StudyEvidenceSummary {
  experimentCount: number;
  attemptCount: number;
  completedCount: number;
  activeCount: number;
  failedCount: number;
  trustedCompletedCount: number;
  unverifiedOrExternalCount: number;
  partialCurveOnlyCount: number;
  /** 未知状态/未知信任值的 Attempt：失败关闭，计入记录异常。 */
  anomalousAttemptRecordCount: number;
  claimCount: number;
}

export function buildEvidenceSummary(
  experiments: readonly Experiment[],
  attempts: readonly Attempt[],
  claims: readonly EvaluationClaim[],
): StudyEvidenceSummary {
  const completedCount = attempts.filter(attempt => isAttemptCompleted(attempt.status)).length;
  const trustedCompletedCount = attempts.filter(attempt => (
    isAttemptCompleted(attempt.status) && isExecutionTrusted(attempt.provenance.executionTrust)
  )).length;
  return {
    experimentCount: experiments.length,
    attemptCount: attempts.length,
    completedCount,
    activeCount: attempts.filter(attempt => isAttemptActive(attempt.status)).length,
    failedCount: attempts.filter(attempt => (
      attempt.status === 'failed' || attempt.status === 'cancelled' || attempt.status === 'interrupted'
    )).length,
    trustedCompletedCount,
    unverifiedOrExternalCount: attempts.filter(attempt => (
      attempt.provenance.executionTrust === 'unverified' || attempt.provenance.source !== 'controlled'
    )).length,
    // 有部分曲线但不可比较：有指标记录、但不是“完成且执行可信”的 Attempt。
    partialCurveOnlyCount: attempts.filter(attempt => (
      attempt.metrics.length > 0
      && !(isAttemptCompleted(attempt.status) && isExecutionTrusted(attempt.provenance.executionTrust))
    )).length,
    anomalousAttemptRecordCount: attempts.filter(attempt => (
      !isKnownAttemptStatus(attempt.status) || !isKnownExecutionTrust(attempt.provenance.executionTrust)
    )).length,
    claimCount: claims.length,
  };
}

/* ---------------- Claim 证据投影：裁决记录、审计完整性与结论信任三者分离 ---------------- */

export type ClaimEvidenceIssue =
  | 'claim_not_in_study'
  | 'attempt_not_in_study'
  | 'unknown_claim_status'
  | 'post_hoc'
  | 'missing_verdict'
  | 'unknown_verdict'
  | 'unknown_conclusion_trust'
  | 'audit_incomplete'
  | 'audit_persistence_not_healthy'
  | 'trust_mismatch';

/** 记录分类：结构异常 / 合法但不具备独立背书 / 档案持久化阻断 / 正常（含合法未裁决）。 */
export type ClaimEvidenceClassification =
  | 'normal'
  | 'structural_anomaly'
  | 'non_authoritative'
  | 'persistence_blocked';

export interface ClaimEvidenceRecord {
  claimId: string;
  /** 仅当 verdict 通过既有 isAuthoritativeVerdict 才非空。 */
  verdict: ClaimVerdict | null;
  /** 协议重算 + 存档取低后的有效信任；无法背书或存档异常时为 null。 */
  effectiveTrust: ConclusionTrust | null;
  /** 存档信任字段；未知/损坏值为 null（UI 只显示“存档字段异常”，不展示原始字符串）。 */
  archivedTrust: ConclusionTrust | null;
  issues: ClaimEvidenceIssue[];
  classification: ClaimEvidenceClassification;
}

export interface StudyClaimEvidenceProjection {
  total: number;
  adjudicatedRecords: number;
  formalVerdictRecords: number;
  auditCompleteRecords: number;
  /** 结构异常：越界引用/未知枚举/实体审计链不完整/存档与重算不一致。 */
  structuralAnomalyCount: number;
  /** 合法但按协议不提供独立背书（如 post_hoc）。 */
  nonAuthoritativeCount: number;
  /** Claim 与实体审计链完整，但全局档案持久化状态不允许背书。 */
  persistenceBlockedCount: number;
  trustCounts: Record<ConclusionTrust, number>;
  highestEffectiveTrust: ConclusionTrust | null;
  records: ClaimEvidenceRecord[];
}

/** 结构异常问题集：audit_persistence_not_healthy 与 post_hoc 不属于 Claim 结构损坏。 */
const STRUCTURAL_ISSUES: ReadonlySet<ClaimEvidenceIssue> = new Set<ClaimEvidenceIssue>([
  'claim_not_in_study',
  'attempt_not_in_study',
  'unknown_claim_status',
  'missing_verdict',
  'unknown_verdict',
  'unknown_conclusion_trust',
  'audit_incomplete',
  'trust_mismatch',
]);

function classifyIssues(issues: readonly ClaimEvidenceIssue[]): ClaimEvidenceClassification {
  if (issues.some(issue => STRUCTURAL_ISSUES.has(issue))) return 'structural_anomaly';
  if (issues.includes('post_hoc')) return 'non_authoritative';
  if (issues.includes('audit_persistence_not_healthy')) return 'persistence_blocked';
  return 'normal';
}

/**
 * Claim 证据投影（纯函数）：有效信任等级消费协议层单一来源
 * projectEffectiveClaimTrust，本文件不再维护第二套 TRUST_RANK/取低算法；
 * 自身仍校验作用域（claim.studyId），保留结构异常/post_hoc/档案阻断三类分类。
 * 同一 Claim 在 Study 总览、ClaimComposer、Study 报告、实验包导出中等级必须一致。
 */
export function projectStudyClaimEvidence(
  study: Study,
  attempts: readonly Attempt[],
  claims: readonly EvaluationClaim[],
  events: readonly LedgerEvent[],
  auditPersistence: 'unavailable' | 'healthy' | 'degraded',
): StudyClaimEvidenceProjection {
  const attemptById = new Map(attempts.map(attempt => [attempt.id, attempt]));
  const records: ClaimEvidenceRecord[] = [];
  const trustCounts: Record<ConclusionTrust, number> = {
    not_evaluated: 0, exploratory: 0, iid_only: 0, gold: 0,
  };
  let adjudicatedRecords = 0;
  let formalVerdictRecords = 0;
  let auditCompleteRecords = 0;
  let structuralAnomalyCount = 0;
  let nonAuthoritativeCount = 0;
  let persistenceBlockedCount = 0;
  let highestEffectiveTrust: ConclusionTrust | null = null;

  const pushRecord = (record: ClaimEvidenceRecord): void => {
    if (record.classification === 'structural_anomaly') structuralAnomalyCount += 1;
    else if (record.classification === 'non_authoritative') nonAuthoritativeCount += 1;
    else if (record.classification === 'persistence_blocked') persistenceBlockedCount += 1;
    records.push(record);
  };

  for (const claim of claims) {
    // 自身作用域校验：越界 Claim 不进入任何计数，不得仅依赖 scopeStudyEvidence。
    if (claim.studyId !== study.id) {
      pushRecord({
        claimId: claim.id,
        verdict: null,
        effectiveTrust: null,
        archivedTrust: null,
        issues: ['claim_not_in_study'],
        classification: 'structural_anomaly',
      });
      continue;
    }

    const attempt = attemptById.get(claim.attemptId) ?? null;
    // 统一投影：闸门、重算、取低全部在协议层完成，本处只消费结果。
    const projection = projectEffectiveClaimTrust({ study, claim, attempt, events, auditPersistence });

    const issues: ClaimEvidenceIssue[] = [];
    if (projection.reasons.includes('attempt_missing') || projection.reasons.includes('attempt_mismatch')) {
      issues.push('attempt_not_in_study');
    }
    if (projection.reasons.includes('unknown_claim_status')) issues.push('unknown_claim_status');
    if (projection.reasons.includes('unknown_conclusion_trust')) issues.push('unknown_conclusion_trust');
    if (projection.reasons.includes('post_hoc')) issues.push('post_hoc');
    if (projection.reasons.includes('missing_verdict')) issues.push('missing_verdict');
    if (projection.reasons.includes('unknown_verdict')) issues.push('unknown_verdict');
    if (projection.reasons.includes('audit_incomplete')) issues.push('audit_incomplete');
    if (projection.reasons.includes('audit_persistence_not_healthy')) issues.push('audit_persistence_not_healthy');
    if (projection.reasons.includes('trust_mismatch')) issues.push('trust_mismatch');

    const adjudicated = isKnownClaimStatus(claim.status) && claim.status === 'adjudicated';
    if (adjudicated) {
      adjudicatedRecords += 1;
      if (projection.verdict !== null) formalVerdictRecords += 1;
      if (projection.auditComplete) auditCompleteRecords += 1;
    }

    const effectiveTrust: ConclusionTrust | null = projection.eligible ? projection.effectiveTrust : null;
    if (effectiveTrust !== null) {
      trustCounts[effectiveTrust] += 1;
      if (
        highestEffectiveTrust === null
        || CONCLUSION_TRUST_RANK[effectiveTrust] > CONCLUSION_TRUST_RANK[highestEffectiveTrust]
      ) {
        highestEffectiveTrust = effectiveTrust;
      }
    }

    pushRecord({
      claimId: claim.id,
      verdict: projection.verdict,
      effectiveTrust,
      archivedTrust: projection.archivedTrust,
      issues,
      classification: classifyIssues(issues),
    });
  }

  return {
    total: claims.length,
    adjudicatedRecords,
    formalVerdictRecords,
    auditCompleteRecords,
    structuralAnomalyCount,
    nonAuthoritativeCount,
    persistenceBlockedCount,
    trustCounts,
    highestEffectiveTrust,
    records,
  };
}

/**
 * 结论等级文案优先级（模块 06 最终补丁）：
 * 1-3 有效等级（gold/iid_only/exploratory）；4 无有效等级且存在实体审计以外的
 * 结构异常；5 Claim 与事件链完整但档案持久化无法背书；6 仅有事后主张；
 * 7 有裁决记录但实体审计链不完整；8 尚无正式裁决。
 * 注：audit_incomplete 属于结构异常集，但单独存在时用更具体的第 7 条文案，
 * 与全局持久化阻断（第 5 条）严格区分；两类问题绝不共用同一文案。
 */
export function conclusionGradeText(
  projection: StudyClaimEvidenceProjection,
): string {
  const highest = projection.highestEffectiveTrust;
  if (highest === 'gold') return '结论等级：金标裁决';
  if (highest === 'iid_only') return '结论等级：仅在样本 IID 假设下成立';
  if (highest === 'exploratory') return '结论等级：探索性裁决，不构成独立验证背书';

  const hasNonAuditStructural = projection.records.some(record => (
    record.issues.some(issue => STRUCTURAL_ISSUES.has(issue) && issue !== 'audit_incomplete')
  ));
  if (hasNonAuditStructural) return '结论记录异常，不能授予可信等级';
  if (projection.persistenceBlockedCount > 0) return '裁决记录完整，但当前档案持久化状态无法背书';
  if (projection.nonAuthoritativeCount > 0 && projection.adjudicatedRecords === 0) {
    return '仅有事后主张，不具备独立验证资格';
  }
  const hasAuditIncomplete = projection.records.some(record => record.issues.includes('audit_incomplete'));
  if (projection.adjudicatedRecords > 0 && hasAuditIncomplete) {
    return '裁决记录存在，但实体审计链不完整';
  }
  if (projection.adjudicatedRecords > 0) return '结论记录异常，不能授予可信等级';
  return '结论等级：尚未形成正式裁决';
}

/** 单条 Claim 的裁决结果·有效等级摘要（裁决结果与信任等级正交，逐条展示不隐藏差异）。 */
export function claimRecordSummary(record: ClaimEvidenceRecord): string {
  const idPart = `Claim …${record.claimId.slice(-8)}`;
  const verdictPart = record.verdict !== null
    ? verdictLabel(record.verdict) ?? '未知 verdict'
    : record.issues.includes('unknown_verdict')
      ? '未知 verdict'
      : record.issues.includes('missing_verdict')
        ? '缺少 verdict'
        : '无裁决结果';
  let trustPart: string;
  if (record.effectiveTrust === 'gold') trustPart = '金标';
  else if (record.effectiveTrust === 'iid_only') trustPart = '仅 IID 假设';
  else if (record.effectiveTrust === 'exploratory') trustPart = '探索性';
  else if (record.effectiveTrust === 'not_evaluated') trustPart = '未评估';
  else if (record.issues.includes('unknown_conclusion_trust')) trustPart = '存档结论信任字段异常';
  else if (
    record.issues.includes('unknown_verdict')
    || record.issues.includes('missing_verdict')
    || record.issues.includes('claim_not_in_study')
    || record.issues.includes('attempt_not_in_study')
    || record.issues.includes('unknown_claim_status')
    || record.issues.includes('trust_mismatch')
  ) trustPart = '记录异常';
  else if (record.issues.includes('audit_incomplete')) trustPart = '审计不完整';
  else if (record.issues.includes('audit_persistence_not_healthy')) trustPart = '档案暂不可背书';
  else if (record.issues.includes('post_hoc')) trustPart = '事后主张，不具独立背书';
  else if (record.classification === 'structural_anomaly') trustPart = '记录异常';
  else trustPart = '未裁决';
  return `${idPart}：${verdictPart} · ${trustPart}`;
}

/* ---------------- 预算视图 ---------------- */

export interface StudyBudgetView {
  experimentsUsed: number;
  experimentsMax: number | null;
  experimentBudgetReached: boolean;
  gpuMinutesUsed: number;
  gpuMinutesMax: number | null;
  gpuBudgetReached: boolean;
  gpuProgressPercent: number;
  runningAttemptCount: number;
}

/**
 * 预算视图：已用量来自 studyUsedGpuMinutes（与 runtime 阻断同一算法）；
 * 视觉进度钳制在 0~100，真实数值由文字展示（允许超额显示）。
 */
export function buildBudgetView(
  study: Study,
  experiments: readonly Experiment[],
  attempts: readonly Attempt[],
  now: number,
): StudyBudgetView {
  const gpuMinutesUsed = studyUsedGpuMinutes(attempts, now);
  const experimentsUsed = experiments.length;
  const experimentsMax = study.budget.maxExperiments;
  const gpuMinutesMax = study.budget.maxGpuMinutes;
  const gpuProgressPercent = gpuMinutesMax !== null && gpuMinutesMax > 0
    ? Math.max(0, Math.min(100, (gpuMinutesUsed / gpuMinutesMax) * 100))
    : 0;
  return {
    experimentsUsed,
    experimentsMax,
    experimentBudgetReached: experimentsMax !== null && experimentsUsed >= experimentsMax,
    gpuMinutesUsed,
    gpuMinutesMax,
    gpuBudgetReached: gpuMinutesMax !== null && gpuMinutesUsed >= gpuMinutesMax,
    gpuProgressPercent,
    runningAttemptCount: attempts.filter(attempt => isAttemptActive(attempt.status)).length,
  };
}

/* ---------------- 数据契约摘要 ---------------- */

export interface ContractRow {
  label: string;
  value: string;
  /** 需要完整值的哈希类字段提供截断值 + 完整值。 */
  fullValue?: string;
}

/** 哈希默认截断展示；完整值只通过 Tooltip/可访问文本提供。 */
export function shortHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  return hash.length > 16 ? `${hash.slice(0, 16)}…` : hash;
}

const KNOWN_TASK_TYPES = new Set(['image_classification', 'tabular_regression']);
const KNOWN_SPLIT_STRATEGIES = new Set(['random', 'group', 'temporal', 'predefined']);

/**
 * 严格可比资格的保守判定：不得只看 comparisonKey。
 * 异常/旧档案可能保留非空键但真实字段缺失，此时一律“无法验证”。
 * 不重新计算、不修改 comparisonKey；严格可比与金标资格是两个概念，不得合并。
 */
export function strictlyComparable(study: Study): boolean {
  const { identity, split, preprocessing } = study.datasetContract;
  return Boolean(study.comparisonKey)
    && Boolean(identity.contentHash)
    && Boolean(split.splitHash)
    && Boolean(preprocessing.configHash)
    && KNOWN_TASK_TYPES.has(identity.taskType)
    && KNOWN_SPLIT_STRATEGIES.has(split.strategy);
}

/** 只展示快照中真实存在的字段；缺失一律“未记录/未声明/无法验证”，不猜测。 */
export function buildContractRows(study: Study): ContractRow[] {
  const { identity, split, preprocessing } = study.datasetContract;
  const rows: ContractRow[] = [
    { label: '数据集', value: identity.name?.trim() || '未记录' },
    { label: '任务类型', value: identity.taskType === 'tabular_regression' ? '表格回归' : identity.taskType === 'image_classification' ? '图像分类' : '未记录' },
  ];
  const fingerprint = shortHash(identity.contentHash);
  rows.push(fingerprint
    ? { label: '内容指纹', value: fingerprint, fullValue: identity.contentHash ?? undefined }
    : { label: '内容指纹', value: '未记录（不能进入严格可比组）' });
  rows.push({ label: '切分策略', value: splitStrategyLabel(split.strategy) });
  rows.push({ label: 'seed', value: typeof split.seed === 'number' ? String(split.seed) : '未记录' });
  rows.push({ label: '验证集比例', value: Number.isFinite(split.validationRatio) ? `${(split.validationRatio * 100).toFixed(0)}%` : '未记录' });
  rows.push({ label: '封存测试比例', value: Number.isFinite(split.testRatio) ? `${(split.testRatio * 100).toFixed(0)}%` : '未记录' });
  if (split.strategy === 'group') rows.push({ label: '分组字段', value: split.groupField ?? '未选择' });
  if (split.strategy === 'temporal') rows.push({ label: '时间字段', value: split.timeField ?? '未选择' });
  rows.push({ label: '样本单位', value: split.sampleUnit?.trim() || '未声明' });
  rows.push({
    label: '独立性',
    value: split.independence === 'machine_verified'
      ? '机器记录'
      : split.independence === 'user_declared'
        ? '用户声明'
        : split.independence === 'iid_assumed'
          ? '仅 IID 假设'
          : '未声明',
  });
  const leakage = split.machineChecks.length > 0
    ? split.machineChecks.every(check => check.status === 'passed')
      ? '全部通过'
      : split.machineChecks.some(check => check.status === 'failed')
        ? '存在未通过项'
        : '未全部运行'
    : '无检查记录';
  rows.push({ label: '泄漏检查', value: leakage });
  const preprocessingValue = shortHash(preprocessing.configHash);
  rows.push(preprocessingValue
    ? { label: '预处理哈希', value: preprocessingValue, fullValue: preprocessing.configHash ?? undefined }
    : { label: '预处理', value: preprocessing.summary?.trim() || '未记录' });

  // 表格回归契约：只读 Study 创建时保存的快照，不读当前面板临时选择，不猜末列。
  if (identity.taskType === 'tabular_regression') {
    rows.push({
      label: '目标列',
      value: identity.targetField?.trim() ? identity.targetField : '未记录（回归任务定义不完整）',
    });
    if (identity.featureFields && identity.featureFields.length > 0) {
      const joined = identity.featureFields.join('、');
      rows.push({
        label: '特征列',
        value: `${identity.featureFields.length} 列${joined.length > 40 ? `：${joined.slice(0, 40)}…` : `：${joined}`}`,
        fullValue: joined,
      });
    } else {
      rows.push({ label: '特征列', value: '未记录' });
    }
  }
  return rows;
}
