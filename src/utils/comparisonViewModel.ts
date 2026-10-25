/**
 * 严格对比视图模型（模块 07）：纯投影与显示状态，无 React、无 store 写入。
 * - 证据作用域：Attempt 必须属于当前 Study 的 Experiment；
 * - 严格完成组只收 completed + executionTrust=trusted + 元数据齐全（comparability 权威分组）；
 * - 默认选择确定且可复现（候选优先 → 消融配对 → 最大严格组，稳定排序）；
 * - override 指纹与历史恢复校验：精确 Attempt 集合 + 指标语义 + 比较上下文；
 * - 方差资格与方向感知差值解释；三类 Study 语言纪律。
 */
import type { Attempt, Experiment, ExperimentLedgerV1, LedgerEvent, Study } from '@/types/experiment';
import {
  assessStrictComparability,
  COMPARISON_WATERMARK,
  environmentDifferences,
  groupStrictComparableAttempts,
} from '@/utils/comparability';
import { localGroupingKey } from '@/utils/experimentProtocol';
import { pairedAblationEvidence, type PairedAblationEvidence } from '@/utils/studyProtocol';
import type { MetricDirection, StrictSeriesOk, StrictSeriesResult } from '@/utils/metricSeries';

export const MAX_COMPARISON_CURVES = 4;

/* ---------------- 作用域与资格 ---------------- */

export interface ComparisonScope {
  experiments: Experiment[];
  studyAttempts: Attempt[];
  /** 严格完成资格：completed + trusted + 有指标（分组仍由 comparability 权威裁决）。 */
  eligibleAttempts: Attempt[];
  /** 诊断区：未完成但已有曲线。 */
  partialAttempts: Attempt[];
}

export function comparisonScope(ledger: ExperimentLedgerV1, studyId: string): ComparisonScope {
  const experiments = ledger.experiments.filter(experiment => experiment.studyId === studyId);
  const experimentIds = new Set(experiments.map(experiment => experiment.id));
  const studyAttempts = ledger.attempts.filter(attempt => experimentIds.has(attempt.experimentId));
  return {
    experiments,
    studyAttempts,
    eligibleAttempts: studyAttempts.filter(attempt => (
      attempt.status === 'completed'
      && attempt.provenance.executionTrust === 'trusted'
      && attempt.metrics.length > 0
    )),
    partialAttempts: studyAttempts.filter(attempt => (
      attempt.status !== 'completed' && attempt.metrics.length > 0
    )),
  };
}

/* ---------------- 指标语义（严格：不猜测） ---------------- */

/**
 * Attempt 的严格指标名候选（最终证据闭环补丁）：
 * 只来自 validation/epoch 记录，metricName 明确、direction 合法且同名方向唯一、
 * 至少存在一个有限指标值——保证不会出现“下拉框可选但选中后没有曲线”的伪选项；
 * train/batch 中出现的其他指标名绝不进入候选。
 */
export function strictMetricNames(attempt: Attempt): string[] {
  const metrics = Array.isArray(attempt.metrics) ? attempt.metrics : [];
  const directionsByName = new Map<string, Set<string>>();
  const finiteByName = new Map<string, boolean>();
  for (const metric of metrics) {
    if (metric.split !== 'validation' || metric.scope !== 'epoch') continue;
    if (typeof metric.metricName !== 'string' || metric.metricName.length === 0) continue;
    const name = metric.metricName;
    const directions = directionsByName.get(name) ?? new Set<string>();
    directions.add(String(metric.optimizationDirection));
    directionsByName.set(name, directions);
    // 严格值资格只认有限 metricValue（M07-002~015 修复）：绝不用 accuracy 字段替代——
    // 否则会产生“下拉框可选但严格序列永远为空”的伪候选（与 extractStrictSeries 的
    // strictMetricValueOf 规则保持同源）。
    const hasFinite = typeof metric.metricValue === 'number' && Number.isFinite(metric.metricValue);
    finiteByName.set(name, (finiteByName.get(name) ?? false) || hasFinite);
  }
  return [...directionsByName.entries()]
    .filter(([name, directions]) => (
      directions.size === 1
      && (directions.has('maximize') || directions.has('minimize'))
      && finiteByName.get(name) === true
    ))
    .map(([name]) => name)
    .sort();
}

/**
 * 选择集合的共同指标：唯一时返回；多个共同指标时返回列表交由用户选择；
 * 没有共同指标时返回空（阻止严格展示并解释原因）。
 */
export function commonMetricNames(attempts: readonly Attempt[]): string[] {
  if (attempts.length === 0) return [];
  let common: string[] | null = null;
  for (const attempt of attempts) {
    const names = strictMetricNames(attempt);
    common = common === null ? [...names] : common.filter(name => names.includes(name));
  }
  return [...(common ?? [])].sort();
}

/* ---------------- 默认选择（确定且可复现） ---------------- */

export interface DefaultSelection {
  attemptIds: string[];
  /** 超过上限被截断时的诚实提示。 */
  overflowCount: number;
  basis: 'candidate' | 'ablation_pair' | 'largest_strict_group' | 'single' | 'none';
}

export function defaultSelection(
  study: Study,
  scope: ComparisonScope,
  ledger: ExperimentLedgerV1,
): DefaultSelection {
  const eligibleIds = scope.eligibleAttempts.map(attempt => attempt.id);
  const groups = groupStrictComparableAttempts(ledger, eligibleIds)
    .filter(group => group.key !== null)
    // 稳定排序：组大小降序 → 组内 id 字典序，不依赖对象插入顺序。
    .sort((left, right) => (
      right.attemptIds.length - left.attemptIds.length
      || [...left.attemptIds].sort().join('|').localeCompare([...right.attemptIds].sort().join('|'))
    ));

  const clamp = (ids: string[], basis: DefaultSelection['basis']): DefaultSelection => ({
    attemptIds: ids.slice(0, MAX_COMPARISON_CURVES),
    overflowCount: Math.max(0, ids.length - MAX_COMPARISON_CURVES),
    basis,
  });

  // 1) 已选候选优先，再加同严格组内最新合法对照（按 ordinal）。
  if (study.selectedAttemptId && eligibleIds.includes(study.selectedAttemptId)) {
    const candidate = scope.eligibleAttempts.find(attempt => attempt.id === study.selectedAttemptId);
    const candidateGroup = groups.find(group => group.attemptIds.includes(study.selectedAttemptId as string));
    const peers = (candidateGroup?.attemptIds ?? [])
      .filter(id => id !== study.selectedAttemptId)
      .map(id => scope.eligibleAttempts.find(attempt => attempt.id === id))
      .filter((attempt): attempt is Attempt => Boolean(attempt))
      .sort((left, right) => (
        right.ordinal - left.ordinal || right.experimentId.localeCompare(left.experimentId) || right.id.localeCompare(left.id)
      ));
    if (candidate && peers.length > 0) {
      return clamp([candidate.id, ...peers.map(peer => peer.id)], 'candidate');
    }
    if (candidate) return clamp([candidate.id], 'candidate');
  }

  // 2) 对照消融：直接使用配对证据内的精确 Attempt ID（最终证据闭环补丁），
  //    不再按 experiment+seed 模糊查询，杜绝选到同 seed 的旧 Attempt。
  if (study.kind === 'controlled_ablation') {
    const evidence = pairedAblationEvidence(ledger, study.id);
    const eligibleIds = new Set(scope.eligibleAttempts.map(attempt => attempt.id));
    const pairIds: string[] = [];
    const seen = new Set<string>();
    // evidence 按实验顺序、pairs 按 seed 升序，采集顺序即稳定顺序；去重后保持首次出现。
    outer: for (const item of evidence) {
      for (const pair of item.pairs) {
        for (const id of [pair.baselineAttemptId, pair.candidateAttemptId]) {
          // 使用前验证：仍属于当前 Study 的合法资格集合（completed+trusted+在作用域内）。
          if (!eligibleIds.has(id) || seen.has(id)) continue;
          seen.add(id);
          pairIds.push(id);
          if (pairIds.length >= MAX_COMPARISON_CURVES) break outer;
        }
      }
    }
    if (pairIds.length >= 2) return clamp(pairIds, 'ablation_pair');
  }

  // 3) 最大严格组（稳定排序后取首组）。
  const largest = groups[0];
  if (largest && largest.attemptIds.length >= 2) {
    const sorted = [...largest.attemptIds].sort((left, right) => {
      const leftAttempt = scope.eligibleAttempts.find(attempt => attempt.id === left);
      const rightAttempt = scope.eligibleAttempts.find(attempt => attempt.id === right);
      return (leftAttempt?.ordinal ?? 0) - (rightAttempt?.ordinal ?? 0) || left.localeCompare(right);
    });
    return clamp(sorted, 'largest_strict_group');
  }
  if (eligibleIds.length === 1) return { attemptIds: [...eligibleIds].sort(), overflowCount: 0, basis: 'single' };
  return { attemptIds: [], overflowCount: 0, basis: 'none' };
}

/* ---------------- 可比性结论 ---------------- */

export interface ComparisonAssessmentView {
  strict: boolean;
  reasons: string[];
  environmentWarnings: string[];
}

export function assessSelection(
  ledger: ExperimentLedgerV1,
  selected: readonly Attempt[],
): ComparisonAssessmentView {
  if (selected.length < 2) return { strict: false, reasons: [], environmentWarnings: [] };
  const assessments = selected.slice(1).map(attempt => assessStrictComparability(ledger, selected[0].id, attempt.id));
  const reasons = [...new Set(assessments.flatMap(assessment => assessment.reasons))];
  const environmentWarnings = [...new Set(
    selected.slice(1).flatMap(attempt => environmentDifferences(selected[0], attempt)),
  )];
  return {
    strict: assessments.length > 0 && assessments.every(assessment => assessment.relation === 'strict'),
    reasons,
    environmentWarnings,
  };
}

/* ---------------- 非严格 override：指纹与历史恢复 ---------------- */

/**
 * 指纹必须覆盖完整指标视图，不能只哈希指标名字符串：
 * 方向不统一时逐 Attempt 记录实际方向，不能用第一条代表全部曲线。
 */
export interface MetricViewContext {
  metricName: string;
  split: 'validation';
  scope: 'epoch';
  /** 按 attemptId 排序的逐 Attempt 实际优化方向。 */
  directions: Array<{ attemptId: string; optimizationDirection: MetricDirection }>;
}

export interface OverrideContext {
  studyId: string;
  /** 排序后的精确 Attempt 集合。 */
  attemptIds: string[];
  reasons: string[];
  /** 指标语义（override 只对确认时的指标视图有效）。 */
  metricSemantics: string;
  metricView: MetricViewContext;
}

/** 比较指纹：Study + 精确集合 + 不可比原因 + 完整指标视图（名/方向/split/scope）。 */
export function overrideFingerprint(context: OverrideContext): string {
  return localGroupingKey({
    studyId: context.studyId,
    attemptIds: [...context.attemptIds].sort(),
    reasons: [...context.reasons].sort(),
    metricSemantics: context.metricSemantics,
    metricView: {
      metricName: context.metricView.metricName,
      split: context.metricView.split,
      scope: context.metricView.scope,
      directions: [...context.metricView.directions].sort((left, right) => left.attemptId.localeCompare(right.attemptId)),
    },
  });
}

/** 构建当前上下文的规范 attemptIds（仅用于当前选择；历史事件非规范排序必须拒绝，不得静默修正）。 */
export function canonicalOverrideAttemptIds(attemptIds: readonly string[]): string[] {
  return [...attemptIds].sort();
}

export interface RestoredOverride {
  eventId: string;
  occurredAt: number;
  attemptIds: string[];
  reasons: string[];
  metricSemantics: string;
  metricView: MetricViewContext;
  fingerprint: string;
}

function isMetricView(value: unknown): value is MetricViewContext {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Partial<MetricViewContext>;
  return typeof view.metricName === 'string' && view.metricName.length > 0
    && view.split === 'validation'
    && view.scope === 'epoch'
    && Array.isArray(view.directions)
    && view.directions.every(item => (
      typeof item === 'object' && item !== null
      && typeof item.attemptId === 'string'
      && (item.optimizationDirection === 'maximize' || item.optimizationDirection === 'minimize')
    ));
}

/**
 * 从 ledger 恢复历史 override（模块 07 验收补丁，全部失败关闭）：
 * eventType/entityType/entityId 精确匹配；attemptIds 必须是无重复、已按协议排序、
 * ≥ 2 且全部属于当前 Study 的字符串数组（非规范旧事件不得静默修正后采信）；
 * reasons 必须是字符串数组；watermark 必须等于协议常量；
 * metricSemantics/metricView/fingerprint 必须明确存在；
 * 用 payload 重算指纹必须与存档值完全一致。
 * 无法恢复的旧事件作为“历史档案异常”展示，绝不授予 override 权限。
 */
export function restoreOverrides(
  events: readonly LedgerEvent[],
  study: Study,
  studyAttemptIds: ReadonlySet<string>,
): { valid: RestoredOverride[]; anomalies: string[] } {
  const valid: RestoredOverride[] = [];
  const anomalies: string[] = [];
  for (const event of events) {
    if (event.eventType !== 'comparison_override') continue;
    if (event.entityType !== 'study' || event.entityId !== study.id) continue;
    const reject = (reason: string): void => {
      anomalies.push(`事件 ${event.eventId} ${reason}，已失败关闭（仅作历史档案异常展示，不授予越界权限）`);
    };
    const payload = event.payload as {
      attemptIds?: unknown;
      reasons?: unknown;
      watermark?: unknown;
      fingerprint?: unknown;
      metricSemantics?: unknown;
      metricView?: unknown;
    };
    if (!Array.isArray(payload.attemptIds) || payload.attemptIds.some(id => typeof id !== 'string')) {
      reject('缺少精确 Attempt 集合');
      continue;
    }
    const rawIds = payload.attemptIds as string[];
    if (new Set(rawIds).size !== rawIds.length) {
      reject('含重复 Attempt ID');
      continue;
    }
    if (rawIds.join('|') !== [...rawIds].sort().join('|')) {
      reject('Attempt 集合未按协议规范排序');
      continue;
    }
    if (rawIds.length < 2) {
      reject('Attempt 集合少于两个');
      continue;
    }
    if (!rawIds.every(id => studyAttemptIds.has(id))) {
      reject('含不属于当前 Study 的 Attempt');
      continue;
    }
    if (payload.watermark !== COMPARISON_WATERMARK) {
      reject('水印不是协议规定值');
      continue;
    }
    if (!Array.isArray(payload.reasons) || payload.reasons.some(reason => typeof reason !== 'string')) {
      reject('不可比原因不是有效字符串数组');
      continue;
    }
    if (typeof payload.metricSemantics !== 'string' || payload.metricSemantics.length === 0) {
      reject('缺少明确指标语义');
      continue;
    }
    if (!isMetricView(payload.metricView)) {
      reject('缺少完整指标视图（metricView）');
      continue;
    }
    // metricView 必须与 Attempt 集合完全一致：自洽指纹不能敕免结构错误。
    const view = payload.metricView;
    if (view.metricName !== payload.metricSemantics) {
      reject('metricView 与指标语义不一致');
      continue;
    }
    const directionIds = view.directions.map(item => item.attemptId);
    if (directionIds.length !== rawIds.length) {
      reject('方向记录数量与 Attempt 集合不一致');
      continue;
    }
    if (new Set(directionIds).size !== directionIds.length) {
      reject('方向记录含重复 Attempt');
      continue;
    }
    if (directionIds.join('|') !== [...directionIds].sort().join('|')) {
      reject('方向记录未按 attemptId 排序');
      continue;
    }
    if (directionIds.join('|') !== rawIds.join('|')) {
      reject('方向记录与 Attempt 集合不完全一致');
      continue;
    }
    if (typeof payload.fingerprint !== 'string' || payload.fingerprint.length === 0) {
      reject('缺少比较指纹');
      continue;
    }
    const metricView: MetricViewContext = {
      metricName: payload.metricView.metricName,
      split: 'validation',
      scope: 'epoch',
      directions: payload.metricView.directions.map(item => ({
        attemptId: item.attemptId,
        optimizationDirection: item.optimizationDirection,
      })),
    };
    const reasons = payload.reasons as string[];
    // 用事件 payload 重算指纹，必须与存档值完全一致；不存在兼容放行分支。
    const recomputed = overrideFingerprint({
      studyId: study.id,
      attemptIds: rawIds,
      reasons,
      metricSemantics: payload.metricSemantics,
      metricView,
    });
    if (recomputed !== payload.fingerprint) {
      reject('指纹与事件内容不一致');
      continue;
    }
    valid.push({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      attemptIds: rawIds,
      reasons,
      metricSemantics: payload.metricSemantics,
      metricView,
      fingerprint: payload.fingerprint,
    });
  }
  return { valid, anomalies };
}

/**
 * 当前选择是否已有精确匹配的历史 override：指纹必须完全相等（覆盖集合+
 * 原因+完整指标视图）；绝无 fingerprint 缺失兼容放行。
 */
export function findMatchingOverride(
  restored: readonly RestoredOverride[],
  context: OverrideContext,
): RestoredOverride | null {
  const fingerprint = overrideFingerprint(context);
  return restored.find(item => item.fingerprint === fingerprint) ?? null;
}

/* ---------------- 方差与配对证据 ---------------- */

export type VarianceQualification =
  | { kind: 'single_seed'; seed: number | null }
  | { kind: 'multi_seed_unpaired'; seedCount: number; seeds: number[] }
  | { kind: 'paired_ablation'; pairCount: number; seedCount: number };

/**
 * 方差资格只针对当前精确选择集合（模块 07 验收补丁）：
 * - pair 的基线与候选 Attempt 必须同时在当前选择中才计入资格；
 * - Study 中其他 Experiment 的配对结果不得让当前选择获得 paired 徽章；
 * - 当前选择只覆盖一个 seed 时仍显示未验证方差；
 * - 绝不把整个 Study 的 pairedTotal 直接投射到任意选择集合。
 */
export function varianceQualification(
  selected: readonly Attempt[],
  ablationEvidence: readonly PairedAblationEvidence[],
): VarianceQualification | null {
  if (selected.length === 0) return null;
  const selectedIds = new Set(selected.map(attempt => attempt.id));
  const scopedPairs = ablationEvidence.flatMap(evidence => evidence.pairs.filter(pair => (
    selectedIds.has(pair.baselineAttemptId) && selectedIds.has(pair.candidateAttemptId)
  )));
  const scopedSeeds = [...new Set(scopedPairs.map(pair => pair.seed))].sort((left, right) => left - right);
  const seeds = [...new Set(
    selected.map(attempt => attempt.config.seed).filter((seed): seed is number => typeof seed === 'number'),
  )].sort((left, right) => left - right);

  if (scopedPairs.length > 0 && scopedSeeds.length >= 2) {
    return { kind: 'paired_ablation', pairCount: scopedPairs.length, seedCount: scopedSeeds.length };
  }
  if (seeds.length <= 1) return { kind: 'single_seed', seed: seeds[0] ?? null };
  return { kind: 'multi_seed_unpaired', seedCount: seeds.length, seeds };
}

/** 选择集合内的作用域配对证据（供面板/测试消费，与徽章同源）。 */
export function scopedAblationPairs(
  selected: readonly Attempt[],
  ablationEvidence: readonly PairedAblationEvidence[],
): PairedAblationEvidence[] {
  const selectedIds = new Set(selected.map(attempt => attempt.id));
  return ablationEvidence
    .map(evidence => ({
      ...evidence,
      pairs: evidence.pairs.filter(pair => (
        selectedIds.has(pair.baselineAttemptId) && selectedIds.has(pair.candidateAttemptId)
      )),
    }))
    .filter(evidence => evidence.pairs.length > 0);
}

/** 方向感知差值解释：maximize 提高为正向；minimize 降低为正向；不做裸数值优劣判断。 */
export function interpretDifference(direction: MetricDirection, difference: number): string {
  if (!Number.isFinite(difference)) return '差值不可用';
  if (difference === 0) return '无差异';
  const improved = direction === 'maximize' ? difference > 0 : difference < 0;
  return improved ? '正向改善' : '负向变化';
}

/**
 * “最佳方案”只允许来自严格序列实际记录的 optimizationDirection（模块 07 验收补丁）：
 * - 所有序列必须 ok 且 metricName/direction 完全一致（不用第一条代表全部）；
 * - 调用方只在 assessment.strict && seriesReady 时才得消费本函数；
 * - 非严格 override 下绝不生成最佳/排名语言（调用层门控 + 本函数双重失败关闭）。
 */
export function bestStrictAttempt(
  selected: readonly Attempt[],
  series: readonly StrictSeriesResult[],
): Attempt | null {
  if (selected.length === 0 || selected.length !== series.length) return null;
  const okSeries: StrictSeriesOk[] = [];
  for (const item of series) {
    if (!item.ok) return null;
    okSeries.push(item);
  }
  const first = okSeries[0];
  if (!first) return null;
  if (!okSeries.every(item => item.metricName === first.metricName && item.direction === first.direction)) return null;
  const direction = first.direction;
  let best: Attempt | null = null;
  let bestValue: number | null = null;
  selected.forEach((attempt, index) => {
    const points = okSeries[index].points;
    const last = points[points.length - 1];
    if (!last || !Number.isFinite(last.value)) return;
    if (
      bestValue === null
      || (direction === 'maximize' ? last.value > bestValue : last.value < bestValue)
    ) {
      best = attempt;
      bestValue = last.value;
    }
  });
  return best;
}

/* ---------------- 三类 Study 语言纪律 ---------------- */

/** 视图层观察语言（不复制 allowedStudyConclusion；结论语言仍由协议函数权威生成）。 */
export function observationLanguage(study: Study, bestAttempt: Attempt | null, experiments: readonly Experiment[]): string | null {
  if (!bestAttempt) return null;
  const experimentName = experiments.find(experiment => experiment.id === bestAttempt.experimentId)?.name ?? '某方案';
  if (study.kind === 'free_exploration') {
    return `在本次探索中观察到 ${experimentName}（Attempt #${bestAttempt.ordinal}）的验证指标较高；这是描述性观察，不构成排序裁决或因果归因。`;
  }
  if (study.kind === 'candidate_selection') {
    return `在候选集、当前预算与既定选择规则下，${experimentName}（Attempt #${bestAttempt.ordinal}）可被选中；选择行为留痕，不附带任何组件级机制解释。`;
  }
  return `对照消融的差异表述以配对 seed 证据为准；多变量 bundle 只能表述为“该改动组合”，不得单独归因某一组件。`;
}

/**
 * 真实重合检测（M07-002~015 修复）：两条及以上严格序列的 epoch/数值完全相同时，
 * 几何上必然重叠。诚实披露“数值完全重合”，绝不加偏移/扰动伪造差异；
 * 区分两条 Attempt 的责任由图例、顶点标记与最终指标表承担。
 * 返回重合的 Attempt ID 集合（按选择顺序）；不足两条重合时返回 null。
 */
export function strictSeriesCoincidence(
  selected: readonly Attempt[],
  series: readonly StrictSeriesResult[],
): { attemptIds: string[]; pointCount: number } | null {
  if (selected.length < 2 || selected.length !== series.length) return null;
  const okPairs: Array<{ id: string; signature: string; pointCount: number }> = [];
  for (let index = 0; index < selected.length; index += 1) {
    const result = series[index];
    if (!result.ok) return null;
    okPairs.push({
      id: selected[index].id,
      // 签名：逐点 epoch+value 的精确字符串；不四舍五入，避免把接近值误报为重合
      signature: result.points.map(point => `${point.epoch}:${point.value}`).join('|'),
      pointCount: result.points.length,
    });
  }
  const groups = new Map<string, typeof okPairs>();
  for (const pair of okPairs) {
    const bucket = groups.get(pair.signature) ?? [];
    bucket.push(pair);
    groups.set(pair.signature, bucket);
  }
  for (const bucket of groups.values()) {
    if (bucket.length >= 2) {
      return { attemptIds: bucket.map(item => item.id), pointCount: bucket[0].pointCount };
    }
  }
  return null;
}

/**
 * 单点严格序列清单（M07-002~015 截图修复）：只有 1 个 validation/epoch 点的 Attempt
 * 只能比较最终值，不得被描述成训练趋势；UI 必须显式披露。
 */
export function singlePointSeries(
  selected: readonly Attempt[],
  series: readonly StrictSeriesResult[],
): Array<{ attemptId: string; ordinal: number }> {
  if (selected.length !== series.length) return [];
  const result: Array<{ attemptId: string; ordinal: number }> = [];
  for (let index = 0; index < selected.length; index += 1) {
    const item = series[index];
    if (item?.ok && item.points.length === 1) {
      result.push({ attemptId: selected[index].id, ordinal: selected[index].ordinal });
    }
  }
  return result;
}

/**
 * 同 epoch 共享点（M07-002~015 截图修复）：≥2 条 ok 序列在同一 epoch 都有严格值时，
 * 返回真实数值条目（绝不移动/复制/插值）；图表层据此做确定性的近重合标注。
 */
export function sharedEpochPoints(
  selected: readonly Attempt[],
  series: readonly StrictSeriesResult[],
): Array<{ epoch: number; entries: Array<{ attemptId: string; value: number }> }> {
  if (selected.length !== series.length) return [];
  const byEpoch = new Map<number, Array<{ attemptId: string; value: number }>>();
  for (let index = 0; index < selected.length; index += 1) {
    const item = series[index];
    if (!item?.ok) continue;
    for (const point of item.points) {
      const bucket = byEpoch.get(point.epoch) ?? [];
      bucket.push({ attemptId: selected[index].id, value: point.value });
      byEpoch.set(point.epoch, bucket);
    }
  }
  return [...byEpoch.entries()]
    .filter(([, entries]) => entries.length >= 2)
    .map(([epoch, entries]) => ({ epoch, entries }))
    .sort((left, right) => left.epoch - right.epoch);
}

/**
 * 两条选中序列的真实最终差值（M07-002~015 截图修复）：
 * 只在恰好两条 ok 序列且指标名一致时返回；差值是原始数值的事实陈述，
 * 不构成趋势/稳定提升/因果结论（展示层负责语言纪律）。
 */
export function strictFinalDifference(
  selected: readonly Attempt[],
  series: readonly StrictSeriesResult[],
): {
  metricName: string;
  left: { attemptId: string; ordinal: number; value: number; epoch: number };
  right: { attemptId: string; ordinal: number; value: number; epoch: number };
  difference: number;
  absoluteDifference: number;
} | null {
  if (selected.length !== 2 || series.length !== 2) return null;
  const [first, second] = series;
  if (!first?.ok || !second?.ok) return null;
  if (first.metricName !== second.metricName) return null;
  const leftLast = first.points[first.points.length - 1];
  const rightLast = second.points[second.points.length - 1];
  if (!leftLast || !rightLast) return null;
  if (!Number.isFinite(leftLast.value) || !Number.isFinite(rightLast.value)) return null;
  const difference = rightLast.value - leftLast.value;
  return {
    metricName: first.metricName,
    left: { attemptId: selected[0].id, ordinal: selected[0].ordinal, value: leftLast.value, epoch: leftLast.epoch },
    right: { attemptId: selected[1].id, ordinal: selected[1].ordinal, value: rightLast.value, epoch: rightLast.epoch },
    difference,
    absoluteDifference: Math.abs(difference),
  };
}

/** 严格序列失败的面向用户解释（空态矩阵：绝不空白无解释，也不泄露原始枚举）。 */
export function strictSeriesFailureText(result: StrictSeriesResult): string | null {
  if (result.ok) return null;
  if (result.kind === 'multiple_metric_names') {
    return `存在多个严格指标名（${result.metricNames.join('、')}），请选择共同指标或调整选择`;
  }
  return result.reason;
}

/* ---------------- 图表尺度（诚实默认）与刻度去重 ---------------- */

/**
 * 刻度去重（模块 07 验收补丁）：短 epoch 区间插值后四舍五入会产生重复值，
 * 直接渲染会生成重复 React key 与重叠刻度。按格式化后的显示值去重，
 * 保留首次出现；绝不改用数组下标作 key 并继续渲染重叠刻度。
 */
export function uniqueTicks(values: readonly number[], format: (value: number) => string): Array<{ value: number; key: string }> {
  const seen = new Set<string>();
  const ticks: Array<{ value: number; key: string }> = [];
  for (const value of values) {
    const key = format(value);
    if (seen.has(key)) continue;
    seen.add(key);
    ticks.push({ value, key });
  }
  return ticks;
}

/** 比例指标默认 0~1；非负指标包含 0 基线；其他情况标注自动尺度。 */
export function axisDomain(
  metricName: string,
  values: readonly number[],
): { min: number; max: number; scaleLabel: string } {
  const finite = values.filter(value => Number.isFinite(value));
  if (finite.length === 0) return { min: 0, max: 1, scaleLabel: '无有效数值' };
  const isProportion = metricName === 'accuracy' || metricName === 'recall' || metricName === 'precision' || metricName === 'macro_f1' || metricName === 'false_positive_rate';
  if (isProportion) return { min: 0, max: 1, scaleLabel: '0～1 全量尺度' };
  const max = Math.max(...finite);
  const min = Math.min(...finite);
  if (min >= 0) return { min: 0, max: max * 1.1 || 1, scaleLabel: '含 0 基线' };
  const pad = (max - min) * 0.1 || 1;
  return { min: min - pad, max: max + pad, scaleLabel: '自动尺度（含负值）' };
}

/**
 * 局部观察范围（M07-002~015 人工复测修复）：只在用户显式切换时使用的视觉放大域，
 * 基于当前全部有限真实值计算（±15% 余量；全同值时按量级给最小余量防零跨度）。
 * 纪律：不修改任何原始点/指标值；不构成默认尺度；不进入审计/候选/结论状态；
 * scaleLabel 必须明确标注“局部观察”，由展示层携带“不代表统计显著”声明。
 */
export function localObservationDomain(
  values: readonly number[],
): { min: number; max: number; scaleLabel: string } {
  const finite = values.filter(value => Number.isFinite(value));
  if (finite.length === 0) return { min: 0, max: 1, scaleLabel: '无有效数值（回退全量尺度）' };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  const pad = span > 0 ? span * 0.15 : Math.max(Math.abs(max) * 0.05, 0.01);
  return { min: min - pad, max: max + pad, scaleLabel: '局部观察范围（已放大）' };
}
