/**
 * 指标序列规范化（模块 07）：严格对比曲线的唯一数据入口。
 * 纪律：
 * - 严格序列只接受 split='validation'、scope='epoch'、metricName 明确存在、
 *   optimizationDirection 明确存在且数值有限的记录；
 * - 不把 train/batch 混入 validation/epoch；不把 loss 混入目标指标；
 * - metricName 缺失不猜测；未知 direction 不按 maximize 处理；
 * - X 轴使用真实 epoch，绝不用数组下标冒充；
 * - 排序键：epoch → globalStep/step → timestamp；
 * - 去重规则（稳定、可解释）：同一 epoch 的多条记录，保留
 *   (timestamp, globalStep/step) 最大的一条——训练端同一 epoch 可能先写
 *   batch 汇总再写 epoch 终值，时间戳更晚、步数更大的记录代表该 epoch 的最终观测；
 * - 非有限值被排除并形成可见警告，不进入坐标计算。
 */
import type { TrainMetric } from '@/types/training';
import type { Attempt } from '@/types/experiment';

export type MetricDirection = 'maximize' | 'minimize';

export interface SeriesPoint {
  epoch: number;
  value: number;
}

export interface StrictSeriesOk {
  ok: true;
  metricName: string;
  direction: MetricDirection;
  points: SeriesPoint[];
  /** 被排除的记录数（split/scope/方向/数值不合法）。 */
  excludedCount: number;
  warnings: string[];
}

export interface StrictSeriesConflict {
  ok: false;
  /** 同一 Attempt 出现多个 metricName：不得随意选择第一项。 */
  kind: 'multiple_metric_names';
  metricNames: string[];
}

export interface StrictSeriesUnavailable {
  ok: false;
  kind: 'no_strict_records' | 'unknown_direction';
  reason: string;
}

export type StrictSeriesResult = StrictSeriesOk | StrictSeriesConflict | StrictSeriesUnavailable;

/**
 * 严格指标值读取的单一来源（最终指标语义补丁）：
 * 只接受有限的 metricValue；绝不用 accuracy 字段替代缺失或非法的 metricValue。
 * metricName='accuracy' 时同样必须具有有限 metricValue，不因 accuracy 字段有限而绕过完整性。
 * 否则会发生错误重新贴标签：metricName='mae' + metricValue=NaN + accuracy=0.92
 * 会把 0.92 当成 MAE 进入严格对比、Study 报告与实验包。
 */
export function strictMetricValueOf(metric: TrainMetric): number | null {
  return typeof metric.metricValue === 'number' && Number.isFinite(metric.metricValue)
    ? metric.metricValue
    : null;
}

/**
 * 诊断兼容读取：旧 sidecar 把数值写在 accuracy 字段（见 TrainMetric 类型注释），
 * 仅限诊断曲线/历史展示路径使用；绝不进入严格描述符、严格序列、
 * 最终严格指标或审计证据。
 */
export function diagnosticMetricValueOf(metric: TrainMetric): number | null {
  const strict = strictMetricValueOf(metric);
  if (strict !== null) return strict;
  return typeof metric.accuracy === 'number' && Number.isFinite(metric.accuracy) ? metric.accuracy : null;
}

/* ---------------- 严格指标语义的单一来源（模块 07 验收补丁） ----------------
 * comparability、pairedAblationEvidence、studyReport、对比视图必须共同消费本描述符；
 * 任何消费方不得再各自猜测 metricName/optimizationDirection/split/scope。 */

export interface StrictMetricDescriptor {
  metricName: string;
  optimizationDirection: MetricDirection;
  split: 'validation';
  scope: 'epoch';
}

export type StrictMetricDescriptorResult =
  | { available: true; descriptor: StrictMetricDescriptor }
  | {
      available: false;
      kind: 'no_records' | 'no_strict_records' | 'missing_name' | 'multiple_metric_names' | 'unknown_direction' | 'no_finite_values';
      reason: string;
      metricNames?: string[];
    };

/**
 * 严格指标描述符（metrics 级单一来源）：只统计明确标记 validation/epoch 的记录。
 * - 没有指标记录 → 不可用（绝不返回 accuracy）；
 * - 仅有 train/batch 记录 → 不可用；
 * - 严格记录缺明确 metricName 或混有未命名记录 → 不可用；
 * - 多指标名 → 明确冲突；
 * - direction 缺失/未知/不一致 → 不可用（不按 maximize 处理）；
 * - 全部值非有限 → 不可用。
 * 消费方（含实验包 README）不得另行实现筛选，也不得伪造 Attempt 调用 attempt 级入口。
 */
export function strictMetricDescriptorFromMetrics(metrics: readonly TrainMetric[]): StrictMetricDescriptorResult {
  if (metrics.length === 0) {
    return { available: false, kind: 'no_records', reason: '没有指标记录，无法确定指标语义' };
  }
  const strictRecords = metrics.filter(metric => metric.split === 'validation' && metric.scope === 'epoch');
  if (strictRecords.length === 0) {
    return { available: false, kind: 'no_strict_records', reason: '只有 train/batch 等非严格记录，不能代表验证指标语义' };
  }
  const named = strictRecords.filter(metric => typeof metric.metricName === 'string' && metric.metricName.length > 0);
  if (named.length === 0) {
    return { available: false, kind: 'missing_name', reason: '严格记录缺少明确 metricName' };
  }
  if (named.length !== strictRecords.length) {
    return { available: false, kind: 'missing_name', reason: '严格记录中混有未命名指标，语义不完整' };
  }
  const names = [...new Set(named.map(metric => metric.metricName as string))].sort();
  if (names.length > 1) {
    return { available: false, kind: 'multiple_metric_names', reason: '同一次运行存在多个严格指标名', metricNames: names };
  }
  const directions = [...new Set(named.map(metric => metric.optimizationDirection))];
  const direction = directions.length === 1 ? directions[0] : undefined;
  if (direction !== 'maximize' && direction !== 'minimize') {
    return { available: false, kind: 'unknown_direction', reason: '优化方向缺失、未知或不一致' };
  }
  // 有限指标值是严格资格的一部分：严格路径只认有限 metricValue，
  // 全部缺失/非有限的记录集不得构成严格证据（accuracy 字段不能替代）；
  // 部分非法、部分合法时描述符成立，非法记录由序列层排除并形成可见警告。
  if (!named.some(metric => strictMetricValueOf(metric) !== null)) {
    return { available: false, kind: 'no_finite_values', reason: '严格记录均不含有限 metricValue（缺失/NaN/Infinity 不构成证据，accuracy 字段不可替代）' };
  }
  return {
    available: true,
    descriptor: { metricName: names[0], optimizationDirection: direction, split: 'validation', scope: 'epoch' },
  };
}

/** attempt 级入口：委托 metrics 级单一来源，规则只有一份。 */
export function strictMetricDescriptor(attempt: Attempt): StrictMetricDescriptorResult {
  return strictMetricDescriptorFromMetrics(Array.isArray(attempt.metrics) ? attempt.metrics : []);
}

/** 严格序列（metrics 级单一来源）：指定 metricName 时只取该指标；未指定时若存在多个指标名则返回冲突。 */
export function extractStrictSeriesFromMetrics(
  metrics: readonly TrainMetric[],
  chosenMetricName?: string,
): StrictSeriesResult {
  // 指标名候选只来自 validation/epoch 严格记录：
  // train/batch 中出现的其他指标名不得触发冲突，也不得成为候选。
  const namedMetrics = metrics.filter(metric => (
    metric.split === 'validation'
    && metric.scope === 'epoch'
    && typeof metric.metricName === 'string'
    && metric.metricName.length > 0
  ));
  const distinctNames = [...new Set(namedMetrics.map(metric => metric.metricName as string))].sort();

  let targetName = chosenMetricName;
  if (!targetName) {
    if (distinctNames.length > 1) return { ok: false, kind: 'multiple_metric_names', metricNames: distinctNames };
    if (distinctNames.length === 1) targetName = distinctNames[0];
  }

  const warnings: string[] = [];
  // 严格记录闸门：validation + epoch + 明确 metricName + 明确 direction + 有限数值。
  const candidates = metrics.filter(metric => {
    if (metric.split !== 'validation' || metric.scope !== 'epoch') return false;
    if (typeof metric.metricName !== 'string' || metric.metricName.length === 0) return false;
    if (targetName && metric.metricName !== targetName) return false;
    return true;
  });

  if (candidates.length === 0) {
    return {
      ok: false,
      kind: 'no_strict_records',
      reason: metrics.length === 0
        ? '没有指标记录'
        : '没有明确标记为 validation/epoch 且带指标名的记录；旧档案不猜测语义',
    };
  }

  const directions = [...new Set(candidates.map(metric => metric.optimizationDirection))];
  const direction = directions.length === 1 ? directions[0] : undefined;
  if (direction !== 'maximize' && direction !== 'minimize') {
    return {
      ok: false,
      kind: 'unknown_direction',
      reason: '指标优化方向缺失或不一致；未知方向不得按 maximize 处理',
    };
  }

  let excludedCount = 0;
  const byEpoch = new Map<number, TrainMetric>();
  for (const metric of candidates) {
    const value = strictMetricValueOf(metric);
    if (value === null || !Number.isFinite(metric.epoch)) {
      excludedCount += 1;
      continue;
    }
    const existing = byEpoch.get(metric.epoch);
    if (!existing) {
      byEpoch.set(metric.epoch, metric);
      continue;
    }
    // 去重规则：同一 epoch 保留 (timestamp, globalStep/step) 更大的最终观测。
    const existingStep = existing.globalStep ?? existing.step;
    const metricStep = metric.globalStep ?? metric.step;
    if (
      metric.timestamp > existing.timestamp
      || (metric.timestamp === existing.timestamp && metricStep > existingStep)
    ) {
      byEpoch.set(metric.epoch, metric);
    }
  }
  if (excludedCount > 0) warnings.push(`${excludedCount} 条记录因 metricValue 缺失或数值非有限被排除`);

  const points = [...byEpoch.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([epoch, metric]) => ({ epoch, value: strictMetricValueOf(metric) as number }));

  if (points.length === 0) {
    return { ok: false, kind: 'no_strict_records', reason: '严格记录均不含有限 metricValue' };
  }

  return {
    ok: true,
    metricName: targetName as string,
    direction,
    points,
    excludedCount,
    warnings,
  };
}

/** attempt 级入口：委托 metrics 级单一来源，规则只有一份。 */
export function extractStrictSeries(
  attempt: Attempt,
  chosenMetricName?: string,
): StrictSeriesResult {
  return extractStrictSeriesFromMetrics(Array.isArray(attempt.metrics) ? attempt.metrics : [], chosenMetricName);
}

/**
 * 指标显示格式的唯一规则（README 摘要收口补丁）：
 * 只有明确的比例指标 accuracy 使用百分比；mae/rmse/r2/loss/自定义指标
 * 一律原始数值；绝不“不是 MAE 就乘 100”，也不按方向或任务类型猜单位。
 */
export function formatStrictMetricValue(metricName: string, value: number): string {
  if (!Number.isFinite(value)) return '数值不可用';
  if (metricName === 'accuracy') return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(6);
}

/** 诊断性部分曲线（暂停/中断/失败/取消）：明确非严格，只用于故障排查；允许旧 accuracy 字段兼容。 */
export function extractDiagnosticSeries(attempt: Attempt): SeriesPoint[] {
  const metrics = Array.isArray(attempt.metrics) ? attempt.metrics : [];
  const points: SeriesPoint[] = [];
  for (const metric of metrics) {
    const value = diagnosticMetricValueOf(metric);
    if (value === null || !Number.isFinite(metric.epoch)) continue;
    points.push({ epoch: metric.epoch, value });
  }
  return points;
}

/** Attempt 的最终严格指标（表格与差值解释使用）：最后一条合法严格记录。 */
export function finalStrictMetric(
  attempt: Attempt,
  metricName: string,
): { value: number; epoch: number } | null {
  const result = extractStrictSeries(attempt, metricName);
  if (!result.ok) return null;
  const last = result.points[result.points.length - 1];
  return last ? { value: last.value, epoch: last.epoch } : null;
}
