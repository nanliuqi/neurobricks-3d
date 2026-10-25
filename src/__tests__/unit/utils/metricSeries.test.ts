/**
 * 指标序列规范化测试（模块 07）：严格闸门、排序、去重、非有限值排除、
 * 多指标名冲突、方向未知失败关闭、train/batch 与 loss 不混入。
 */
import { describe, expect, it } from 'vitest';
import {
  extractDiagnosticSeries,
  extractStrictSeries,
  extractStrictSeriesFromMetrics,
  finalStrictMetric,
  formatStrictMetricValue,
  strictMetricDescriptor,
  strictMetricDescriptorFromMetrics,
  strictMetricValueOf,
  diagnosticMetricValueOf,
} from '@/utils/metricSeries';
import type { TrainMetric } from '@/types/training';
import type { Attempt } from '@/types/experiment';

function makeAttempt(metrics: TrainMetric[]): Attempt {
  return {
    id: 'att-1', protocolVersion: 1, experimentId: 'exp-1', runId: 'r', modelId: 'm',
    config: { epochs: 3, learningRate: 0.01, batchSize: 8, dataset: 'mnist', device: 'cpu', seed: 42, layers: [] },
    ordinal: 1, parentAttemptId: null, restartCount: 0, resumeType: 'fresh',
    status: 'completed', startedAt: 1, endedAt: 2, executionMode: 'native',
    metrics, artifacts: null,
    provenance: {
      source: 'controlled', executionTrust: 'trusted', witnessedByPipeline: true,
      environment: { applicationVersion: '0', torchVersion: null, pythonVersion: null, device: 'cpu', cudaVersion: null },
      datasetContentHash: 'h', splitHash: 's', testSetHash: 't', machineChecks: [],
      testSampleCount: 0, testLabelCounts: null, testTargetSummary: null,
      preprocessingHash: 'p', configHash: 'c', modelWeightsHash: 'w',
    },
  } as unknown as Attempt;
}

function validationEpoch(epoch: number, value: number, overrides: Partial<TrainMetric> = {}): TrainMetric {
  return {
    epoch, step: epoch, loss: 0.1, accuracy: value, metricName: 'accuracy', metricValue: value,
    optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: epoch,
    ...overrides,
  } as TrainMetric;
}

describe('extractStrictSeries：严格闸门', () => {
  it('只接受 validation/epoch + 明确 metricName + 明确 direction + 有限数值', () => {
    const attempt = makeAttempt([
      validationEpoch(1, 0.7),
      validationEpoch(2, 0.8),
    ]);
    const result = extractStrictSeries(attempt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metricName).toBe('accuracy');
    expect(result.direction).toBe('maximize');
    expect(result.points).toEqual([{ epoch: 1, value: 0.7 }, { epoch: 2, value: 0.8 }]);
  });

  it('train/batch 记录不混入严格序列', () => {
    const attempt = makeAttempt([
      validationEpoch(1, 0.7),
      validationEpoch(1, 0.5, { split: 'train', scope: 'batch' }),
      validationEpoch(2, 0.9, { scope: 'batch' }),
    ]);
    const result = extractStrictSeries(attempt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points).toEqual([{ epoch: 1, value: 0.7 }]);
  });

  it('loss 记录不混入目标指标序列', () => {
    const attempt = makeAttempt([
      validationEpoch(1, 0.7),
      // loss 记录：无 metricName 的裸 loss 不进入；带 loss 名的记录属于另一指标
      { epoch: 1, step: 2, loss: 0.05, accuracy: 0.05, metricName: undefined, split: 'validation', scope: 'epoch', timestamp: 9 } as TrainMetric,
    ]);
    const result = extractStrictSeries(attempt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points).toEqual([{ epoch: 1, value: 0.7 }]);
  });

  it('metricName 缺失：失败关闭，不猜成 accuracy', () => {
    const attempt = makeAttempt([
      { epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, split: 'validation', scope: 'epoch', timestamp: 1 } as TrainMetric,
    ]);
    const result = extractStrictSeries(attempt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('no_strict_records');
  });

  it('optimizationDirection 未知或缺失：失败关闭，不按 maximize 处理', () => {
    for (const direction of [undefined, 'up' as never]) {
      const attempt = makeAttempt([validationEpoch(1, 0.7, { optimizationDirection: direction })]);
      const result = extractStrictSeries(attempt);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.kind).toBe('unknown_direction');
    }
  });

  it('NaN/Infinity 被排除并形成可见警告，不进入坐标', () => {
    const attempt = makeAttempt([
      validationEpoch(1, 0.7),
      validationEpoch(2, Number.NaN, { metricValue: Number.NaN, accuracy: Number.NaN }),
      validationEpoch(3, Number.POSITIVE_INFINITY, { metricValue: Number.POSITIVE_INFINITY, accuracy: Number.POSITIVE_INFINITY }),
    ]);
    const result = extractStrictSeries(attempt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points).toEqual([{ epoch: 1, value: 0.7 }]);
    expect(result.excludedCount).toBe(2);
    expect(result.warnings.join('')).toContain('非有限');
  });

  it('同一 epoch 重复记录：稳定保留 (timestamp, step) 更大的最终观测', () => {
    const attempt = makeAttempt([
      validationEpoch(1, 0.6, { timestamp: 5, step: 10 }),
      validationEpoch(1, 0.75, { timestamp: 9, step: 12 }),
      validationEpoch(1, 0.5, { timestamp: 9, step: 8 }),
    ]);
    const result = extractStrictSeries(attempt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // timestamp 9 的两条中 step 12 胜出；timestamp 5 的被更晚观测覆盖
    expect(result.points).toEqual([{ epoch: 1, value: 0.75 }]);
  });

  it('乱序输入按真实 epoch 排序，绝不用数组下标冒充', () => {
    const attempt = makeAttempt([
      validationEpoch(5, 0.9),
      validationEpoch(2, 0.7),
      validationEpoch(3, 0.8),
    ]);
    const result = extractStrictSeries(attempt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points.map(point => point.epoch)).toEqual([2, 3, 5]);
  });

  it('同一 Attempt 多个 metricName：返回冲突，不随意选择第一项', () => {
    const attempt = makeAttempt([
      validationEpoch(1, 0.7),
      validationEpoch(1, 0.2, { metricName: 'mae', metricValue: 0.2, optimizationDirection: 'minimize' }),
    ]);
    const result = extractStrictSeries(attempt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('multiple_metric_names');
    if (result.kind === 'multiple_metric_names') {
      expect(result.metricNames).toEqual(['accuracy', 'mae']);
    }
    // 用户显式选择后只取该指标
    const chosen = extractStrictSeries(attempt, 'mae');
    expect(chosen.ok).toBe(true);
    if (chosen.ok) {
      expect(chosen.metricName).toBe('mae');
      expect(chosen.direction).toBe('minimize');
    }
  });

  it('不同训练轮数不阻止提取：各自覆盖范围如实返回', () => {
    const short = extractStrictSeries(makeAttempt([validationEpoch(1, 0.5)]));
    const long = extractStrictSeries(makeAttempt([validationEpoch(1, 0.5), validationEpoch(2, 0.6), validationEpoch(3, 0.7)]));
    expect(short.ok && short.points).toHaveLength(1);
    expect(long.ok && long.points).toHaveLength(3);
  });
});

describe('extractDiagnosticSeries / finalStrictMetric', () => {
  it('诊断序列接受未完成运行的有限值记录，排除非有限值', () => {
    const attempt = makeAttempt([
      { epoch: 1, step: 1, loss: 0.3, accuracy: 0.4, timestamp: 1 } as TrainMetric,
      { epoch: 2, step: 2, loss: Number.NaN, accuracy: Number.NaN, timestamp: 2 } as TrainMetric,
    ]);
    expect(extractDiagnosticSeries(attempt)).toEqual([{ epoch: 1, value: 0.4 }]);
  });

  it('finalStrictMetric 返回最后一条合法严格记录；序列不可用时返回 null', () => {
    const attempt = makeAttempt([validationEpoch(1, 0.7), validationEpoch(2, 0.8)]);
    expect(finalStrictMetric(attempt, 'accuracy')).toEqual({ value: 0.8, epoch: 2 });
    expect(finalStrictMetric(makeAttempt([]), 'accuracy')).toBeNull();
  });
});

describe('strictMetricDescriptor：指标语义单一来源（验收补丁）', () => {
  it('完整元数据 → 可用描述符（name/direction/split/scope）', () => {
    const result = strictMetricDescriptor(makeAttempt([validationEpoch(1, 0.7)]));
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.descriptor).toEqual({
      metricName: 'accuracy', optimizationDirection: 'maximize', split: 'validation', scope: 'epoch',
    });
  });

  it('没有指标记录 → 不可用，绝不返回 accuracy', () => {
    const result = strictMetricDescriptor(makeAttempt([]));
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.kind).toBe('no_records');
  });

  it('仅有 train/batch 记录 → 不可用', () => {
    const result = strictMetricDescriptor(makeAttempt([validationEpoch(1, 0.7, { split: 'train', scope: 'batch' })]));
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.kind).toBe('no_strict_records');
  });

  it('严格记录缺 metricName 或混有未命名记录 → 不可用', () => {
    const unnamed = strictMetricDescriptor(makeAttempt([
      { epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, split: 'validation', scope: 'epoch', timestamp: 1 } as TrainMetric,
    ]));
    expect(unnamed.available).toBe(false);
    if (!unnamed.available) expect(unnamed.kind).toBe('missing_name');

    const mixed = strictMetricDescriptor(makeAttempt([
      validationEpoch(1, 0.7),
      { epoch: 2, step: 2, loss: 0.2, accuracy: 0.8, split: 'validation', scope: 'epoch', timestamp: 2 } as TrainMetric,
    ]));
    expect(mixed.available).toBe(false);
    if (!mixed.available) expect(mixed.kind).toBe('missing_name');
  });

  it('多指标名 → 明确冲突并列出候选', () => {
    const result = strictMetricDescriptor(makeAttempt([
      validationEpoch(1, 0.7),
      validationEpoch(1, 0.2, { metricName: 'mae', metricValue: 0.2, optimizationDirection: 'minimize' }),
    ]));
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.kind).toBe('multiple_metric_names');
    expect(result.metricNames).toEqual(['accuracy', 'mae']);
  });

  it('direction 缺失/未知/不一致 → 不可用，不按 maximize 处理', () => {
    for (const direction of [undefined, 'up' as never]) {
      const result = strictMetricDescriptor(makeAttempt([validationEpoch(1, 0.7, { optimizationDirection: direction })]));
      expect(result.available).toBe(false);
      if (!result.available) expect(result.kind).toBe('unknown_direction');
    }
    const inconsistent = strictMetricDescriptor(makeAttempt([
      validationEpoch(1, 0.7),
      validationEpoch(2, 0.8, { optimizationDirection: 'minimize' }),
    ]));
    expect(inconsistent.available).toBe(false);
    if (!inconsistent.available) expect(inconsistent.kind).toBe('unknown_direction');
  });

  it('全部严格记录非有限 → no_finite_values；部分非法时描述符仍成立', () => {
    const allNaN = strictMetricDescriptor(makeAttempt([
      validationEpoch(1, Number.NaN, { metricValue: Number.NaN, accuracy: Number.NaN }),
      validationEpoch(2, Number.POSITIVE_INFINITY, { metricValue: Number.POSITIVE_INFINITY, accuracy: Number.POSITIVE_INFINITY }),
    ]));
    expect(allNaN.available).toBe(false);
    if (!allNaN.available) expect(allNaN.kind).toBe('no_finite_values');

    // 部分非法、部分合法：描述符成立，非法记录由序列层排除并形成警告
    const partial = strictMetricDescriptor(makeAttempt([
      validationEpoch(1, Number.NaN, { metricValue: Number.NaN, accuracy: Number.NaN }),
      validationEpoch(2, 0.8),
    ]));
    expect(partial.available).toBe(true);
  });
});

describe('metrics 级单一来源与显示格式（README 摘要收口）', () => {
  it('strictMetricDescriptorFromMetrics 直接作用于记录数组；attempt 级入口委托同一规则', () => {
    const metrics = [validationEpoch(1, 0.7)];
    const direct = strictMetricDescriptorFromMetrics(metrics);
    expect(direct.available).toBe(true);
    expect(strictMetricDescriptor(makeAttempt(metrics))).toEqual(direct);
    // 失败关闭规则同样一致（空记录集）
    expect(strictMetricDescriptorFromMetrics([])).toEqual(strictMetricDescriptor(makeAttempt([])));
  });

  it('extractStrictSeriesFromMetrics 直接作用于记录数组；attempt 级入口委托同一规则', () => {
    const metrics = [validationEpoch(2, 0.8), validationEpoch(1, 0.7)];
    const direct = extractStrictSeriesFromMetrics(metrics);
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(direct.points.map(point => point.epoch)).toEqual([1, 2]);
    expect(extractStrictSeries(makeAttempt(metrics))).toEqual(direct);
  });

  it('formatStrictMetricValue：只有 accuracy 百分比，其余原始数值，绝不“不是 MAE 就乘 100”', () => {
    expect(formatStrictMetricValue('accuracy', 0.912)).toBe('91.2%');
    expect(formatStrictMetricValue('mae', 0.2)).toBe('0.200000');
    expect(formatStrictMetricValue('rmse', 0.2)).toBe('0.200000');
    expect(formatStrictMetricValue('r2', 0.85)).toBe('0.850000');
    expect(formatStrictMetricValue('my_score', 0.3)).toBe('0.300000');
    expect(formatStrictMetricValue('accuracy', Number.NaN)).toBe('数值不可用');
    expect(formatStrictMetricValue('accuracy', Number.POSITIVE_INFINITY)).toBe('数值不可用');
  });
});

describe('严格指标值来源：accuracy 字段绝不冒充 metricValue（最终指标语义补丁）', () => {
  function strictRecordWith(overrides: Partial<TrainMetric>): TrainMetric {
    return {
      epoch: 1, step: 1, loss: 0.1, accuracy: 0.92, metricName: 'mae', metricValue: 0.2,
      optimizationDirection: 'minimize', split: 'validation', scope: 'epoch', timestamp: 1,
      ...overrides,
    } as TrainMetric;
  }

  it('strictMetricValueOf 只认有限 metricValue；diagnosticMetricValueOf 才允许旧 accuracy 兼容', () => {
    expect(strictMetricValueOf(strictRecordWith({ metricValue: undefined }))).toBeNull();
    expect(diagnosticMetricValueOf(strictRecordWith({ metricValue: undefined }))).toBe(0.92);
    expect(strictMetricValueOf(strictRecordWith({ metricValue: 0.2 }))).toBe(0.2);
  });

  it('MAE：metricValue 缺失、accuracy 有限——不得生成严格 MAE（不重新贴标签）', () => {
    const attempt = makeAttempt([strictRecordWith({ metricValue: undefined })]);
    const descriptor = strictMetricDescriptor(attempt);
    expect(descriptor.available).toBe(false);
    if (!descriptor.available) expect(descriptor.kind).toBe('no_finite_values');
    const series = extractStrictSeries(attempt, 'mae');
    expect(series.ok).toBe(false);
  });

  it('MAE：metricValue=NaN、accuracy 有限——不得把 accuracy 当 MAE', () => {
    const attempt = makeAttempt([strictRecordWith({ metricValue: Number.NaN })]);
    expect(strictMetricDescriptor(attempt).available).toBe(false);
    const series = extractStrictSeries(attempt, 'mae');
    expect(series.ok).toBe(false);
    if (!series.ok && series.kind === 'no_strict_records') {
      expect(series.reason).toContain('metricValue');
    }
  });

  it('accuracy 指标：metricValue 缺失、accuracy 字段有限——同样不得进入严格证据', () => {
    const attempt = makeAttempt([strictRecordWith({ metricName: 'accuracy', optimizationDirection: 'maximize', metricValue: undefined })]);
    expect(strictMetricDescriptor(attempt).available).toBe(false);
    expect(extractStrictSeries(attempt).ok).toBe(false);
  });

  it('自定义指标：metricValue=Infinity、accuracy 有限——不得重新贴标签', () => {
    const attempt = makeAttempt([strictRecordWith({ metricName: 'my_score', optimizationDirection: 'maximize', metricValue: Number.POSITIVE_INFINITY })]);
    expect(strictMetricDescriptor(attempt).available).toBe(false);
    expect(extractStrictSeries(attempt, 'my_score').ok).toBe(false);
  });

  it('一条合法、一条非法：描述符成立，非法记录被排除且 excludedCount/warning 准确', () => {
    const attempt = makeAttempt([
      strictRecordWith({ metricValue: 0.2 }),
      strictRecordWith({ epoch: 2, metricValue: undefined, timestamp: 2 }),
    ]);
    expect(strictMetricDescriptor(attempt).available).toBe(true);
    const series = extractStrictSeries(attempt, 'mae');
    expect(series.ok).toBe(true);
    if (!series.ok) return;
    expect(series.points).toEqual([{ epoch: 1, value: 0.2 }]);
    expect(series.excludedCount).toBe(1);
    expect(series.warnings.join('')).toContain('1 条记录因 metricValue 缺失或数值非有限被排除');
  });

  it('乱序输入 + 非法记录：仍按真实 epoch 选最近合法点', () => {
    const attempt = makeAttempt([
      strictRecordWith({ epoch: 3, metricValue: 0.15, timestamp: 3 }),
      strictRecordWith({ epoch: 2, metricValue: Number.NaN, timestamp: 2 }),
      strictRecordWith({ epoch: 1, metricValue: 0.25, timestamp: 1 }),
    ]);
    const series = extractStrictSeries(attempt, 'mae');
    expect(series.ok).toBe(true);
    if (!series.ok) return;
    expect(series.points).toEqual([{ epoch: 1, value: 0.25 }, { epoch: 3, value: 0.15 }]);
    expect(finalStrictMetric(attempt, 'mae')).toEqual({ value: 0.15, epoch: 3 });
  });

  it('metrics 级与 attempt 级严格入口在新值规则下仍完全一致', () => {
    const metrics = [strictRecordWith({ metricValue: undefined })];
    expect(strictMetricDescriptorFromMetrics(metrics)).toEqual(strictMetricDescriptor(makeAttempt(metrics)));
    expect(extractStrictSeriesFromMetrics(metrics, 'mae')).toEqual(extractStrictSeries(makeAttempt(metrics), 'mae'));
  });

  it('诊断曲线仍兼容旧 accuracy 字段（不进严格链）', () => {
    const attempt = makeAttempt([
      { epoch: 1, step: 1, loss: 0.3, accuracy: 0.4, timestamp: 1 } as TrainMetric,
    ]);
    expect(extractDiagnosticSeries(attempt)).toEqual([{ epoch: 1, value: 0.4 }]);
    // 同一条记录在严格路径失败关闭
    expect(extractStrictSeries(attempt).ok).toBe(false);
  });
});
