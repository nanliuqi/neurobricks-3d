/**
 * 严格对比视图模型测试（模块 07）：
 * 作用域隔离、默认选择确定性、方差资格、方向解释、
 * override 指纹/恢复校验（错 entityType/entityId、集合非法、fingerprint 不匹配全部拒绝）、
 * 诚实尺度与三类 Study 语言纪律。
 */
import { describe, expect, it } from 'vitest';
import {
  assessSelection,
  axisDomain,
  bestStrictAttempt,
  commonMetricNames,
  comparisonScope,
  defaultSelection,
  findMatchingOverride,
  interpretDifference,
  localObservationDomain,
  MAX_COMPARISON_CURVES,
  observationLanguage,
  overrideFingerprint,
  restoreOverrides,
  sharedEpochPoints,
  singlePointSeries,
  strictFinalDifference,
  strictMetricNames,
  strictSeriesCoincidence,
  strictSeriesFailureText,
  uniqueTicks,
  varianceQualification,
  type OverrideContext,
} from '@/utils/comparisonViewModel';
import { strictComparisonGroupKey } from '@/utils/comparability';
import { COMPARISON_WATERMARK } from '@/utils/comparability';
import { extractStrictSeries } from '@/utils/metricSeries';
import { pairedAblationEvidence } from '@/utils/studyProtocol';
import type { Attempt, Experiment, ExperimentLedgerV1, LedgerEvent, Study } from '@/types/experiment';
import type { TrainMetric } from '@/types/training';

function makeStudy(overrides: Partial<Study> = {}): Study {
  return {
    id: 'study-1', protocolVersion: 1, name: '课题', kind: 'candidate_selection', status: 'active',
    question: 'q', comparisonKey: 'key', selectionRule: '手动选择',
    budget: { maxExperiments: null, maxGpuMinutes: null }, createdAt: 1, updatedAt: 1, lockedAt: 1,
    datasetContract: {
      identity: { id: 'ds', name: 'MNIST', taskType: 'image_classification', contentHash: 'sha256:data', fingerprintAlgorithm: 'sha256-v1', sampleCount: 100, classCount: 2, classNames: ['0', '1'], importedAt: 1 },
      split: { strategy: 'random', seed: 42, validationRatio: 0.2, testRatio: 0.2, sampleUnit: 'image', independence: 'machine_verified', machineChecks: [], splitHash: 'sha256:split' },
      preprocessing: { configHash: 'sha256:pre', summary: 'fixed' },
    },
    ...overrides,
  } as Study;
}

function makeExperiment(id: string, studyId = 'study-1'): Experiment {
  return {
    id, protocolVersion: 1, studyId, name: id,
    config: { epochs: 1, learningRate: 0.01, batchSize: 8, dataset: 'mnist', device: 'cpu', seed: 42, layers: [] } as Experiment['config'],
    configHash: `sha256:${id}`, createdAt: 1,
  } as Experiment;
}

function strictMetric(epoch: number, value: number): TrainMetric {
  return {
    epoch, step: epoch, loss: 0.1, accuracy: value, metricName: 'accuracy', metricValue: value,
    optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: epoch,
  } as TrainMetric;
}

function makeAttempt(id: string, overrides: Partial<Attempt> = {}, provenanceOverrides: Partial<Attempt['provenance']> = {}): Attempt {
  return {
    id, protocolVersion: 1, experimentId: 'exp-a', runId: `run-${id}`, modelId: `model-${id}`,
    config: { epochs: 1, learningRate: 0.01, batchSize: 8, dataset: 'mnist', device: 'cpu', seed: 42, layers: [] } as Attempt['config'],
    ordinal: 1, parentAttemptId: null, restartCount: 0, resumeType: 'fresh',
    status: 'completed', startedAt: 1, endedAt: 2, executionMode: 'native',
    metrics: [strictMetric(1, 0.8)],
    artifacts: null,
    provenance: {
      source: 'controlled', executionTrust: 'trusted', witnessedByPipeline: true,
      environment: { applicationVersion: '0', torchVersion: null, pythonVersion: null, device: 'cpu', cudaVersion: null },
      datasetContentHash: 'sha256:data', splitHash: 'sha256:split', testSetHash: 'sha256:test', machineChecks: [],
      testSampleCount: 10, testLabelCounts: null, testTargetSummary: null,
      preprocessingHash: 'sha256:pre', configHash: 'sha256:config', modelWeightsHash: `sha256:${id}`,
      ...provenanceOverrides,
    },
    ...overrides,
  } as Attempt;
}

function makeLedger(studies: Study[], experiments: Experiment[], attempts: Attempt[], events: LedgerEvent[] = []): ExperimentLedgerV1 {
  return { protocolVersion: 1, ledgerId: 'ledger-1', studies, experiments, attempts, claims: [], events } as ExperimentLedgerV1;
}

/* ---------------- 作用域与资格 ---------------- */

describe('comparisonScope：证据作用域', () => {
  it('跨 Study Attempt 不进入当前结果；untrusted completed 不进入严格资格；paused/cancelled 进诊断区', () => {
    const study = makeStudy();
    const foreign = makeExperiment('exp-foreign', 'study-other');
    const attempts = [
      makeAttempt('att-ok'),
      makeAttempt('att-foreign', { experimentId: 'exp-foreign' }),
      makeAttempt('att-untrusted', {}, { executionTrust: 'unverified' }),
      makeAttempt('att-paused', { status: 'paused' }),
      makeAttempt('att-cancelled', { status: 'cancelled' }),
      makeAttempt('att-empty', { metrics: [] }),
    ];
    const scope = comparisonScope(
      makeLedger([study], [makeExperiment('exp-a'), foreign], attempts),
      'study-1',
    );
    expect(scope.studyAttempts.map(a => a.id)).not.toContain('att-foreign');
    expect(scope.eligibleAttempts.map(a => a.id)).toEqual(['att-ok']);
    expect(scope.partialAttempts.map(a => a.id).sort()).toEqual(['att-cancelled', 'att-paused']);
    // 无指标记录的空完成结果不进入任何展示组
    expect(scope.partialAttempts.map(a => a.id)).not.toContain('att-empty');
  });
});

describe('strictComparisonGroupKey：指标元数据失败关闭', () => {
  it('记录缺失 metricName 或多指标名时不进入严格组，不猜成 accuracy', () => {
    const study = makeStudy();
    const unnamed = makeAttempt('att-unnamed', { metrics: [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, timestamp: 1 } as TrainMetric] });
    const multi = makeAttempt('att-multi', { metrics: [strictMetric(1, 0.8), strictMetric(2, 0.3) as TrainMetric].map((m, i) => (i === 1 ? { ...m, metricName: 'mae' } : m)) as TrainMetric[] });
    const ledger = makeLedger([study], [makeExperiment('exp-a')], [unnamed, multi]);
    expect(strictComparisonGroupKey(ledger, 'att-unnamed')).toBeNull();
    expect(strictComparisonGroupKey(ledger, 'att-multi')).toBeNull();
  });
});

/* ---------------- 共同指标 ---------------- */

describe('commonMetricNames', () => {
  it('唯一共同指标直接返回；多个共同指标交由用户选择；无共同指标阻止严格展示', () => {
    const onlyAccuracy = makeAttempt('a');
    const onlyMae = makeAttempt('b', { metrics: [{ ...strictMetric(1, 0.2), metricName: 'mae', metricValue: 0.2, optimizationDirection: 'minimize' } as TrainMetric] });
    expect(commonMetricNames([onlyAccuracy, onlyAccuracy])).toEqual(['accuracy']);
    expect(commonMetricNames([onlyAccuracy, onlyMae])).toEqual([]);
    const both = makeAttempt('c', { metrics: [strictMetric(1, 0.8), { ...strictMetric(2, 0.1), metricName: 'mae', metricValue: 0.1, optimizationDirection: 'minimize' } as TrainMetric] });
    expect(commonMetricNames([both, onlyAccuracy])).toEqual(['accuracy']);
  });
});

/* ---------------- 默认选择 ---------------- */

describe('defaultSelection：确定且可复现', () => {
  it('已选候选优先，再取同严格组内最新合法对照', () => {
    const study = makeStudy({ selectedAttemptId: 'att-c1' });
    const attempts = [
      makeAttempt('att-c1', { ordinal: 1 }),
      makeAttempt('att-c2', { ordinal: 3, id: 'att-c2' }),
      makeAttempt('att-c3', { ordinal: 2 }),
    ];
    attempts[1].provenance.modelWeightsHash = 'sha256:att-c2';
    const scope = comparisonScope(makeLedger([study], [makeExperiment('exp-a')], attempts), 'study-1');
    const selection = defaultSelection(study, scope, makeLedger([study], [makeExperiment('exp-a')], attempts));
    expect(selection.basis).toBe('candidate');
    expect(selection.attemptIds[0]).toBe('att-c1');
    // 对照按 ordinal 降序（最新合法对照优先）
    expect(selection.attemptIds[1]).toBe('att-c2');
  });

  it('无候选时选择最大严格组，稳定排序不依赖插入顺序', () => {
    const study = makeStudy();
    const attempts = [
      makeAttempt('att-b'),
      makeAttempt('att-a'),
      makeAttempt('att-other', {}, { splitHash: 'sha256:other' }),
    ];
    const ledger = makeLedger([study], [makeExperiment('exp-a')], attempts);
    const scope = comparisonScope(ledger, 'study-1');
    const selection = defaultSelection(study, scope, ledger);
    expect(selection.basis).toBe('largest_strict_group');
    expect(selection.attemptIds.sort()).toEqual(['att-a', 'att-b']);
  });

  it('超过 4 条上限时截断并给出 overflowCount（不静默忽略）', () => {
    const study = makeStudy();
    const attempts = ['a', 'b', 'c', 'd', 'e'].map(name => makeAttempt(`att-${name}`));
    const ledger = makeLedger([study], [makeExperiment('exp-a')], attempts);
    const scope = comparisonScope(ledger, 'study-1');
    const selection = defaultSelection(study, scope, ledger);
    expect(selection.attemptIds).toHaveLength(MAX_COMPARISON_CURVES);
    expect(selection.overflowCount).toBe(1);
  });

  it('结构/超参不同不阻止进入同一严格组（控制变量一致即可）', () => {
    const study = makeStudy();
    const attempts = [
      makeAttempt('att-1'),
      makeAttempt('att-2', { config: { epochs: 9, learningRate: 0.5, batchSize: 64, dataset: 'mnist', device: 'cpu', seed: 42, layers: [] } as Attempt['config'] }),
    ];
    const ledger = makeLedger([study], [makeExperiment('exp-a')], attempts);
    const scope = comparisonScope(ledger, 'study-1');
    expect(defaultSelection(study, scope, ledger).attemptIds.sort()).toEqual(['att-1', 'att-2']);
  });

  it('对照消融默认选择直接使用配对证据内的精确 Attempt ID，不选同 seed 旧 Attempt', () => {
    const ablationStudy = makeStudy({ kind: 'controlled_ablation' });
    const expBase = makeExperiment('exp-base');
    const expCand = makeExperiment('exp-cand');
    // 基线同 seed=42 存在两个 Attempt：旧的在 ledger 中排前、ordinal 更低
    const baseOld = makeAttempt('base-old', { experimentId: 'exp-base', ordinal: 1 });
    const baseNew = makeAttempt('base-new', { experimentId: 'exp-base', ordinal: 2 });
    const cand42 = makeAttempt('cand-42', { experimentId: 'exp-cand', ordinal: 1 });
    const base43 = makeAttempt('base-43', { experimentId: 'exp-base', ordinal: 1, config: { seed: 43 } as Attempt['config'] });
    const cand43 = makeAttempt('cand-43', { experimentId: 'exp-cand', ordinal: 1, config: { seed: 43 } as Attempt['config'] });
    const ledger = makeLedger([ablationStudy], [expBase, expCand], [baseOld, baseNew, cand42, base43, cand43]);
    const scope = comparisonScope(ledger, 'study-1');

    // 配对证据按稳定规则选高 ordinal 的 base-new
    const evidence = pairedAblationEvidence(ledger, 'study-1');
    expect(evidence[0].pairs.map(pair => pair.baselineAttemptId)).toEqual(['base-new', 'base-43']);

    // 默认选择必须使用证据内的精确 ID：不得按 experiment+seed 模糊查到 base-old
    const selection = defaultSelection(ablationStudy, scope, ledger);
    expect(selection.basis).toBe('ablation_pair');
    expect(selection.attemptIds).toContain('base-new');
    expect(selection.attemptIds).not.toContain('base-old');
    expect(selection.attemptIds).toEqual(['base-new', 'cand-42', 'base-43', 'cand-43']);

    // varianceQualification 因此识别正确 pair（跨 2 个 seed）
    const selectedAttempts = selection.attemptIds
      .map(id => scope.eligibleAttempts.find(attempt => attempt.id === id))
      .filter((attempt): attempt is Attempt => Boolean(attempt));
    expect(varianceQualification(selectedAttempts, evidence)).toEqual({ kind: 'paired_ablation', pairCount: 2, seedCount: 2 });
  });
});

/* ---------------- 指标候选来源 ---------------- */

describe('strictMetricNames：候选只来自严格记录', () => {
  function record(overrides: Partial<TrainMetric>): TrainMetric {
    return {
      epoch: 1, step: 1, loss: 0.1, accuracy: 0.8, metricName: 'accuracy', metricValue: 0.8,
      optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 1,
      ...overrides,
    } as TrainMetric;
  }

  it('train/batch 名、全 NaN 名、同名混合方向名均不进入候选（无伪选项）', () => {
    const attempt = makeAttempt('a', { metrics: [
      record({}),
      // 仅存在于 train/batch 的指标名
      record({ metricName: 'batch_loss', split: 'train', scope: 'batch' }),
      // 全非有限值的指标名
      record({ metricName: 'mae', metricValue: Number.NaN, accuracy: Number.NaN, optimizationDirection: 'minimize' }),
      // 同名但方向不一致的指标名
      record({ metricName: 'recall' }),
      record({ metricName: 'recall', optimizationDirection: 'minimize' }),
    ] });
    expect(strictMetricNames(attempt)).toEqual(['accuracy']);
    // 候选中的每个名字都保证存在合法严格序列（选中即有曲线）
    expect(commonMetricNames([attempt])).toEqual(['accuracy']);
  });

  it('metricValue 缺失或 NaN 但 accuracy 有限：不进入候选（accuracy 不可替代，M07-002~015）', () => {
    // 旧缺陷：hasFinite 用 accuracy 兜底 → 产生“可选但永远无曲线”的伪候选
    const missingValue = makeAttempt('a', { metrics: [record({ metricValue: undefined, accuracy: 0.92 })] });
    expect(strictMetricNames(missingValue)).toEqual([]);
    const nanValue = makeAttempt('b', { metrics: [record({ metricValue: Number.NaN, accuracy: 0.92 })] });
    expect(strictMetricNames(nanValue)).toEqual([]);
    const infiniteValue = makeAttempt('c', { metrics: [record({ metricValue: Number.POSITIVE_INFINITY, accuracy: 0.92 })] });
    expect(strictMetricNames(infiniteValue)).toEqual([]);
    // 有限 metricValue → 正常候选（与 accuracy 字段取值无关）
    const finiteValue = makeAttempt('d', { metrics: [record({ metricValue: 0.72, accuracy: 0.99 })] });
    expect(strictMetricNames(finiteValue)).toEqual(['accuracy']);
  });
});

/* ---------------- 真实重合检测（M07-002~015） ---------------- */

describe('strictSeriesCoincidence：诚实重合检测，不伪造差异', () => {
  function strictAttemptWithValues(id: string, values: number[]) {
    return makeAttempt(id, {
      metrics: values.map((value, index) => ({
        epoch: index + 1, step: (index + 1) * 10, loss: 0.1, accuracy: value, metricName: 'accuracy',
        metricValue: value, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch',
        timestamp: 1000 + index,
      } as TrainMetric)),
    });
  }

  it('两条序列逐点相同 → 返回重合 Attempt ID 与点数（几何重叠不可避免，必须披露）', () => {
    const a = strictAttemptWithValues('a', [0.8, 0.85]);
    const b = strictAttemptWithValues('b', [0.8, 0.85]);
    const result = strictSeriesCoincidence(
      [a, b],
      [extractStrictSeries(a, 'accuracy'), extractStrictSeries(b, 'accuracy')],
    );
    expect(result).toEqual({ attemptIds: ['a', 'b'], pointCount: 2 });
  });

  it('部分点相同、部分不同 → null（不得把接近值误报为重合）', () => {
    const a = strictAttemptWithValues('a', [0.8, 0.85]);
    const b = strictAttemptWithValues('b', [0.8, 0.86]);
    expect(strictSeriesCoincidence(
      [a, b],
      [extractStrictSeries(a, 'accuracy'), extractStrictSeries(b, 'accuracy')],
    )).toBeNull();
  });

  it('任一序列不 ok 或选择不足两条 → null（失败关闭，不披露无意义重合）', () => {
    const a = strictAttemptWithValues('a', [0.8]);
    const broken = makeAttempt('broken', { metrics: [] });
    expect(strictSeriesCoincidence(
      [a, broken],
      [extractStrictSeries(a, 'accuracy'), extractStrictSeries(broken, 'accuracy')],
    )).toBeNull();
    expect(strictSeriesCoincidence([a], [extractStrictSeries(a, 'accuracy')])).toBeNull();
  });

  it('三条中两条重合 → 只报告重合的那两条', () => {
    const a = strictAttemptWithValues('a', [0.8, 0.85]);
    const b = strictAttemptWithValues('b', [0.8, 0.85]);
    const c = strictAttemptWithValues('c', [0.7, 0.75]);
    const result = strictSeriesCoincidence(
      [a, b, c],
      [extractStrictSeries(a, 'accuracy'), extractStrictSeries(b, 'accuracy'), extractStrictSeries(c, 'accuracy')],
    );
    expect(result).toEqual({ attemptIds: ['a', 'b'], pointCount: 2 });
  });
});

/* ---------------- 单点/共享点/真实差值/失败文案（M07-002~015 截图修复） ---------------- */

describe('单点披露、同 epoch 共享点、真实最终差值与失败解释', () => {
  function attemptWithValues(id: string, values: number[], ordinal = 1) {
    return makeAttempt(id, {
      ordinal,
      metrics: values.map((value, index) => ({
        epoch: index + 1, step: (index + 1) * 10, loss: 0.1, accuracy: value, metricName: 'accuracy',
        metricValue: value, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch',
        timestamp: 1000 + index,
      } as TrainMetric)),
    });
  }

  it('strictFinalDifference：截图场景 0.9542 vs 0.9527 → 真实差值 0.0015（含符号与端点身份）', () => {
    const a = attemptWithValues('a', [0.9542], 1);
    const b = attemptWithValues('b', [0.9527], 2);
    const diff = strictFinalDifference(
      [a, b],
      [extractStrictSeries(a, 'accuracy'), extractStrictSeries(b, 'accuracy')],
    );
    expect(diff).not.toBeNull();
    expect(diff?.metricName).toBe('accuracy');
    expect(diff?.left).toMatchObject({ attemptId: 'a', ordinal: 1, value: 0.9542, epoch: 1 });
    expect(diff?.right).toMatchObject({ attemptId: 'b', ordinal: 2, value: 0.9527, epoch: 1 });
    expect(diff?.difference).toBeCloseTo(-0.0015, 10);
    expect(diff?.absoluteDifference).toBeCloseTo(0.0015, 10);
    expect(diff?.absoluteDifference.toFixed(6)).toBe('0.001500');
  });

  it('strictFinalDifference：非两条/序列不 ok/指标名不同 → null（不硬凑差值）', () => {
    const a = attemptWithValues('a', [0.9]);
    const broken = makeAttempt('broken', { metrics: [] });
    expect(strictFinalDifference([a], [extractStrictSeries(a, 'accuracy')])).toBeNull();
    expect(strictFinalDifference(
      [a, broken],
      [extractStrictSeries(a, 'accuracy'), extractStrictSeries(broken, 'accuracy')],
    )).toBeNull();
    const maeAttempt = makeAttempt('mae', {
      metrics: [{
        epoch: 1, step: 1, loss: 0.1, accuracy: 0, metricName: 'mae', metricValue: 0.2,
        optimizationDirection: 'minimize', split: 'validation', scope: 'epoch', timestamp: 1,
      } as TrainMetric],
    });
    expect(strictFinalDifference(
      [a, maeAttempt],
      [extractStrictSeries(a, 'accuracy'), extractStrictSeries(maeAttempt, 'mae')],
    )).toBeNull();
  });

  it('singlePointSeries：只列单点 ok 序列，多点/不 ok 不入列', () => {
    const single = attemptWithValues('s', [0.9]);
    const multi = attemptWithValues('m', [0.8, 0.85]);
    const broken = makeAttempt('broken', { metrics: [] });
    expect(singlePointSeries(
      [single, multi, broken],
      [
        extractStrictSeries(single, 'accuracy'),
        extractStrictSeries(multi, 'accuracy'),
        extractStrictSeries(broken, 'accuracy'),
      ],
    )).toEqual([{ attemptId: 's', ordinal: 1 }]);
  });

  it('sharedEpochPoints：返回同 epoch 真实数值条目；独有 epoch 不入组；不 ok 序列被排除', () => {
    const a = attemptWithValues('a', [0.9542]);
    const b = attemptWithValues('b', [0.9527]);
    const groups = sharedEpochPoints(
      [a, b],
      [extractStrictSeries(a, 'accuracy'), extractStrictSeries(b, 'accuracy')],
    );
    expect(groups).toEqual([
      { epoch: 1, entries: [{ attemptId: 'a', value: 0.9542 }, { attemptId: 'b', value: 0.9527 }] },
    ]);
    const c = attemptWithValues('c', [0.8, 0.85]);
    const solo = sharedEpochPoints(
      [a, c],
      [extractStrictSeries(a, 'accuracy'), extractStrictSeries(c, 'accuracy')],
    );
    expect(solo).toEqual([{ epoch: 1, entries: [{ attemptId: 'a', value: 0.9542 }, { attemptId: 'c', value: 0.8 }] }]);
  });

  it('strictSeriesFailureText：ok → null；多指标名 → 选择指引；不可用 → 真实原因', () => {
    const ok = extractStrictSeries(attemptWithValues('a', [0.9]), 'accuracy');
    expect(strictSeriesFailureText(ok)).toBeNull();
    const conflicted = extractStrictSeries(makeAttempt('x', {
      metrics: [
        { epoch: 1, step: 1, loss: 0.1, accuracy: 0.8, metricName: 'accuracy', metricValue: 0.8, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 1 },
        { epoch: 1, step: 2, loss: 0.1, accuracy: 0.2, metricName: 'mae', metricValue: 0.2, optimizationDirection: 'minimize', split: 'validation', scope: 'epoch', timestamp: 2 },
      ],
    }));
    const conflictText = strictSeriesFailureText(conflicted);
    expect(conflictText).toContain('多个严格指标名');
    expect(conflictText).toContain('accuracy');
    expect(conflictText).toContain('mae');
    const unavailable = extractStrictSeries(makeAttempt('empty', { metrics: [] }));
    expect(strictSeriesFailureText(unavailable)).toBe('没有指标记录');
  });

  it('localObservationDomain：近值 ±15% 余量；全同值防零跨度；空值回退全量；标注局部观察', () => {
    const near = localObservationDomain([0.9405, 0.9455, 0.9542, 0.9527]);
    expect(near.scaleLabel).toBe('局部观察范围（已放大）');
    const span = 0.9542 - 0.9405;
    expect(near.min).toBeCloseTo(0.9405 - span * 0.15, 10);
    expect(near.max).toBeCloseTo(0.9542 + span * 0.15, 10);
    // 全同值：跨度为零时仍给最小余量，不产生除零/不可见域
    const same = localObservationDomain([0.95, 0.95]);
    expect(same.max).toBeGreaterThan(same.min);
    // 非有限值被排除；全非有限/空 → 回退全量尺度（诚实标注）
    expect(localObservationDomain([])).toEqual({ min: 0, max: 1, scaleLabel: '无有效数值（回退全量尺度）' });
    expect(localObservationDomain([Number.NaN, Number.POSITIVE_INFINITY])).toEqual({ min: 0, max: 1, scaleLabel: '无有效数值（回退全量尺度）' });
    const mixed = localObservationDomain([0.5, Number.NaN, 0.7]);
    expect(mixed.min).toBeLessThan(0.5);
    expect(mixed.max).toBeGreaterThan(0.7);
  });
});

/* ---------------- 可比性评估 ---------------- */

describe('assessSelection', () => {
  const study = makeStudy();
  it.each([
    ['数据集哈希不同', { datasetContentHash: 'sha256:other' }, '数据集内容不同'],
    ['splitHash 不同', { splitHash: 'sha256:other' }, '验证/测试集切分不同'],
    ['预处理不同', { preprocessingHash: 'sha256:other' }, '预处理不同'],
  ])('%s：阻止并给出人话原因', (_label, provenanceOverrides, reason) => {
    const attempts = [makeAttempt('a'), makeAttempt('b', {}, provenanceOverrides)];
    const ledger = makeLedger([study], [makeExperiment('exp-a')], attempts);
    const assessment = assessSelection(ledger, attempts);
    expect(assessment.strict).toBe(false);
    expect(assessment.reasons).toContain(reason);
  });

  it('任务类型不同：阻止', () => {
    const base = makeStudy();
    const regressionStudy = makeStudy({
      id: 'study-2',
      datasetContract: {
        ...base.datasetContract,
        identity: { ...base.datasetContract.identity, taskType: 'tabular_regression' },
      },
    });
    const expA = makeExperiment('exp-a', 'study-1');
    const expB = makeExperiment('exp-b', 'study-2');
    const attempts = [
      makeAttempt('a'),
      makeAttempt('b', { experimentId: 'exp-b' }),
    ];
    const ledger = makeLedger([makeStudy(), regressionStudy], [expA, expB], attempts);
    const assessment = assessSelection(ledger, attempts);
    expect(assessment.strict).toBe(false);
    expect(assessment.reasons).toContain('任务定义不同');
  });

  it('指标语义不同：阻止', () => {
    const attempts = [
      makeAttempt('a'),
      makeAttempt('b', { metrics: [{ ...strictMetric(1, 0.2), metricName: 'mae', metricValue: 0.2, optimizationDirection: 'minimize' } as TrainMetric] }),
    ];
    const ledger = makeLedger([study], [makeExperiment('exp-a')], attempts);
    expect(assessSelection(ledger, attempts).reasons).toContain('指标语义不同');
  });
});

/* ---------------- 方差资格与方向解释 ---------------- */

describe('varianceQualification / interpretDifference', () => {
  it('单 seed：未验证方差', () => {
    const qualification = varianceQualification([makeAttempt('a')], []);
    expect(qualification).toEqual({ kind: 'single_seed', seed: 42 });
  });

  it('多 seed 未配对：显示真实 seed 数', () => {
    const attempts = [
      makeAttempt('a', { config: { seed: 42 } as Attempt['config'] }),
      makeAttempt('b', { config: { seed: 43 } as Attempt['config'] }),
    ];
    const qualification = varianceQualification(attempts, []);
    expect(qualification?.kind).toBe('multi_seed_unpaired');
    if (qualification?.kind === 'multi_seed_unpaired') {
      expect(qualification.seedCount).toBe(2);
      expect(qualification.seeds).toEqual([42, 43]);
    }
  });

  it('配对消融：只计入基线与候选同时在当前选择中的 pair（跨 2 个 seed）', () => {
    const evidence = [{
      experimentId: 'exp-b', experimentName: 'B', diffPaths: ['layers.1.type'],
      metricName: 'accuracy', optimizationDirection: 'maximize' as const,
      pairs: [
        { seed: 42, baselineAttemptId: 'base-42', candidateAttemptId: 'cand-42', metricName: 'accuracy', optimizationDirection: 'maximize' as const, baseline: 0.8, candidate: 0.85, difference: 0.05 },
        { seed: 43, baselineAttemptId: 'base-43', candidateAttemptId: 'cand-43', metricName: 'accuracy', optimizationDirection: 'maximize' as const, baseline: 0.79, candidate: 0.84, difference: 0.05 },
      ],
      meanDifference: 0.05, interval95: [0.04, 0.06] as [number, number],
    }];
    const selected = [
      makeAttempt('base-42', { config: { seed: 42 } as Attempt['config'] }),
      makeAttempt('cand-42', { config: { seed: 42 } as Attempt['config'] }),
      makeAttempt('base-43', { config: { seed: 43 } as Attempt['config'] }),
      makeAttempt('cand-43', { config: { seed: 43 } as Attempt['config'] }),
    ];
    expect(varianceQualification(selected, evidence)).toEqual({ kind: 'paired_ablation', pairCount: 2, seedCount: 2 });
  });

  it('选择外的配对证据不影响当前方差徽章：仍显示单 seed 未验证方差', () => {
    const evidence = [{
      experimentId: 'exp-b', experimentName: 'B', diffPaths: ['layers.1.type'],
      metricName: 'accuracy', optimizationDirection: 'maximize' as const,
      pairs: [
        { seed: 42, baselineAttemptId: 'other-base', candidateAttemptId: 'other-cand', metricName: 'accuracy', optimizationDirection: 'maximize' as const, baseline: 0.8, candidate: 0.85, difference: 0.05 },
        { seed: 43, baselineAttemptId: 'other-base-2', candidateAttemptId: 'other-cand-2', metricName: 'accuracy', optimizationDirection: 'maximize' as const, baseline: 0.79, candidate: 0.84, difference: 0.05 },
      ],
      meanDifference: 0.05, interval95: null,
    }];
    // 当前选择只有两个不在 pair 中的 Attempt（同 seed 42）
    const qualification = varianceQualification([makeAttempt('a'), makeAttempt('b')], evidence);
    expect(qualification).toEqual({ kind: 'single_seed', seed: 42 });
  });

  it('只选中 pair 一侧（基线或候选）时不计入配对资格', () => {
    const evidence = [{
      experimentId: 'exp-b', experimentName: 'B', diffPaths: [],
      metricName: 'accuracy', optimizationDirection: 'maximize' as const,
      pairs: [
        { seed: 42, baselineAttemptId: 'base-42', candidateAttemptId: 'cand-42', metricName: 'accuracy', optimizationDirection: 'maximize' as const, baseline: 0.8, candidate: 0.85, difference: 0.05 },
        { seed: 43, baselineAttemptId: 'base-43', candidateAttemptId: 'cand-43', metricName: 'accuracy', optimizationDirection: 'maximize' as const, baseline: 0.79, candidate: 0.84, difference: 0.05 },
      ],
      meanDifference: 0.05, interval95: null,
    }];
    const qualification = varianceQualification(
      [makeAttempt('base-42', { config: { seed: 42 } as Attempt['config'] }), makeAttempt('base-43', { config: { seed: 43 } as Attempt['config'] })],
      evidence,
    );
    expect(qualification).toEqual({ kind: 'multi_seed_unpaired', seedCount: 2, seeds: [42, 43] });
  });

  it('方向参与差值解释：maximize 提高为正向；minimize 降低为正向', () => {
    expect(interpretDifference('maximize', 0.05)).toBe('正向改善');
    expect(interpretDifference('maximize', -0.05)).toBe('负向变化');
    expect(interpretDifference('minimize', -0.05)).toBe('正向改善');
    expect(interpretDifference('minimize', 0.05)).toBe('负向变化');
    expect(interpretDifference('maximize', 0)).toBe('无差异');
    expect(interpretDifference('maximize', Number.NaN)).toBe('差值不可用');
  });
});

/* ---------------- override 指纹与恢复 ---------------- */

function overrideEvent(overrides: Partial<LedgerEvent> & { payload: Record<string, unknown> }): LedgerEvent {
  return {
    eventId: 'event-o1', protocolVersion: 1, sequence: 10, occurredAt: 100,
    entityType: 'study', entityId: 'study-1', eventType: 'comparison_override',
    ...overrides,
  } as LedgerEvent;
}

/** 完整合法上下文：指纹覆盖集合+原因+完整指标视图（含逐 Attempt 方向）。 */
const baseContext: OverrideContext = {
  studyId: 'study-1',
  attemptIds: ['att-a', 'att-b'],
  reasons: ['验证/测试集切分不同'],
  metricSemantics: 'accuracy',
  metricView: {
    metricName: 'accuracy',
    split: 'validation',
    scope: 'epoch',
    directions: [
      { attemptId: 'att-a', optimizationDirection: 'maximize' },
      { attemptId: 'att-b', optimizationDirection: 'maximize' },
    ],
  },
};

function fullPayload(overrides: Record<string, unknown> = {}) {
  return {
    attemptIds: baseContext.attemptIds,
    reasons: baseContext.reasons,
    watermark: COMPARISON_WATERMARK,
    metricSemantics: baseContext.metricSemantics,
    metricView: baseContext.metricView,
    fingerprint: overrideFingerprint(baseContext),
    ...overrides,
  };
}

describe('restoreOverrides：精确作用域恢复（全部失败关闭）', () => {
  const study = makeStudy();
  const studyAttemptIds = new Set(['att-a', 'att-b', 'att-c']);

  it('合法事件恢复：集合、原因、指标视图与指纹保留', () => {
    const { valid, anomalies } = restoreOverrides([overrideEvent({ payload: fullPayload() })], study, studyAttemptIds);
    expect(anomalies).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0].attemptIds).toEqual(['att-a', 'att-b']);
    expect(valid[0].metricSemantics).toBe('accuracy');
    expect(valid[0].metricView.directions).toHaveLength(2);
    expect(valid[0].fingerprint).toBe(overrideFingerprint(baseContext));
  });

  it('错 entityType 或 entityId 的历史事件被拒绝', () => {
    const wrongType = restoreOverrides([overrideEvent({ entityType: 'attempt', payload: fullPayload() })], study, studyAttemptIds);
    expect(wrongType.valid).toHaveLength(0);
    expect(wrongType.anomalies).toHaveLength(0); // 非本 Study 事件不进入恢复范围
    const wrongId = restoreOverrides([overrideEvent({ entityId: 'study-other', payload: fullPayload() })], study, studyAttemptIds);
    expect(wrongId.valid).toHaveLength(0);
  });

  it('payload Attempt 不属于当前 Study 时被拒绝并提示档案异常', () => {
    const { valid, anomalies } = restoreOverrides(
      [overrideEvent({ payload: fullPayload({ attemptIds: ['att-a', 'att-foreign'] }) })],
      study, studyAttemptIds,
    );
    expect(valid).toHaveLength(0);
    expect(anomalies.join('')).toContain('不属于当前 Study');
  });

  it('重复 Attempt ID 被拒绝，不去重后采信', () => {
    const { valid, anomalies } = restoreOverrides(
      [overrideEvent({ payload: fullPayload({ attemptIds: ['att-a', 'att-a'] }) })],
      study, studyAttemptIds,
    );
    expect(valid).toHaveLength(0);
    expect(anomalies.join('')).toContain('含重复 Attempt ID');
  });

  it('未按协议排序的 Attempt ID 被拒绝，不静默修正后采信', () => {
    const { valid, anomalies } = restoreOverrides(
      [overrideEvent({ payload: fullPayload({ attemptIds: ['att-b', 'att-a'] }) })],
      study, studyAttemptIds,
    );
    expect(valid).toHaveLength(0);
    expect(anomalies.join('')).toContain('未按协议规范排序');
  });

  it('空/单 Attempt 集合与非法结构被拒绝', () => {
    const single = restoreOverrides([overrideEvent({ payload: fullPayload({ attemptIds: ['att-a'] }) })], study, studyAttemptIds);
    expect(single.valid).toHaveLength(0);
    expect(single.anomalies.join('')).toContain('少于两个');
    const empty = restoreOverrides([overrideEvent({ payload: fullPayload({ attemptIds: [] }) })], study, studyAttemptIds);
    expect(empty.valid).toHaveLength(0);
    const malformed = restoreOverrides([overrideEvent({ payload: fullPayload({ attemptIds: 'att-a,att-b' }) })], study, studyAttemptIds);
    expect(malformed.valid).toHaveLength(0);
    expect(malformed.anomalies.join('')).toContain('缺少精确 Attempt 集合');
  });

  it('缺少协议水印的事件被拒绝', () => {
    const { valid, anomalies } = restoreOverrides(
      [overrideEvent({ payload: fullPayload({ watermark: '随便看看' }) })], study, studyAttemptIds,
    );
    expect(valid).toHaveLength(0);
    expect(anomalies.join('')).toContain('水印');
  });

  it('缺 fingerprint / metricSemantics / metricView 均被拒绝，无兼容放行', () => {
    const noFingerprint = restoreOverrides([overrideEvent({ payload: fullPayload({ fingerprint: undefined }) })], study, studyAttemptIds);
    expect(noFingerprint.valid).toHaveLength(0);
    expect(noFingerprint.anomalies.join('')).toContain('缺少比较指纹');

    const noSemantics = restoreOverrides([overrideEvent({ payload: fullPayload({ metricSemantics: undefined }) })], study, studyAttemptIds);
    expect(noSemantics.valid).toHaveLength(0);
    expect(noSemantics.anomalies.join('')).toContain('缺少明确指标语义');

    const noView = restoreOverrides([overrideEvent({ payload: fullPayload({ metricView: undefined }) })], study, studyAttemptIds);
    expect(noView.valid).toHaveLength(0);
    expect(noView.anomalies.join('')).toContain('缺少完整指标视图');
  });

  it('payload fingerprint 与事件内容不一致时被拒绝', () => {
    const { valid, anomalies } = restoreOverrides(
      [overrideEvent({ payload: fullPayload({ fingerprint: 'fnv1a64-v1:stale' }) })],
      study, studyAttemptIds,
    );
    expect(valid).toHaveLength(0);
    expect(anomalies.join('')).toContain('指纹与事件内容不一致');
  });

  it('findMatchingOverride：指纹必须与当前上下文完全相等；旧 override 不污染其他集合', () => {
    const { valid } = restoreOverrides([overrideEvent({ payload: fullPayload() })], study, studyAttemptIds);
    expect(findMatchingOverride(valid, baseContext)?.eventId).toBe('event-o1');
    // 增删一个 Attempt → 指纹不同 → 不匹配
    expect(findMatchingOverride(valid, { ...baseContext, attemptIds: ['att-a', 'att-b', 'att-c'] })).toBeNull();
    // att-a 与 att-c 的另一个对比不受 att-a 历史 override 影响
    expect(findMatchingOverride(valid, {
      ...baseContext,
      attemptIds: ['att-a', 'att-c'],
      metricView: { ...baseContext.metricView, directions: [{ attemptId: 'att-a', optimizationDirection: 'maximize' }, { attemptId: 'att-c', optimizationDirection: 'maximize' }] },
    })).toBeNull();
    // 指标视图变化（方向不同）→ 指纹不同 → 旧确认失效
    expect(findMatchingOverride(valid, {
      ...baseContext,
      metricView: { ...baseContext.metricView, directions: [{ attemptId: 'att-a', optimizationDirection: 'maximize' }, { attemptId: 'att-b', optimizationDirection: 'minimize' }] },
    })).toBeNull();
  });

  it('overrideFingerprint：集合顺序不敏感，指标名/方向/split/scope 敏感', () => {
    expect(overrideFingerprint({ ...baseContext, attemptIds: ['att-b', 'att-a'] })).toBe(overrideFingerprint(baseContext));
    expect(overrideFingerprint({ ...baseContext, metricSemantics: 'mae', metricView: { ...baseContext.metricView, metricName: 'mae' } })).not.toBe(overrideFingerprint(baseContext));
    expect(overrideFingerprint({
      ...baseContext,
      metricView: { ...baseContext.metricView, directions: [{ attemptId: 'att-a', optimizationDirection: 'minimize' }, { attemptId: 'att-b', optimizationDirection: 'maximize' }] },
    })).not.toBe(overrideFingerprint(baseContext));
  });

  it('metricView 与 Attempt 集合结构不一致：即使指纹自洽也被拒绝', () => {
    const study = makeStudy();
    const studyAttemptIds = new Set(['att-a', 'att-b', 'att-c']);

    // 构造自洽指纹：指纹由篡改后的上下文重算，结构校验必须独立拦截
    const tamper = (view: typeof baseContext.metricView, semantics = 'accuracy') => {
      const context = { ...baseContext, metricSemantics: semantics, metricView: view };
      return restoreOverrides(
        [overrideEvent({ payload: fullPayload({ metricSemantics: semantics, metricView: view, fingerprint: overrideFingerprint(context) }) })],
        study, studyAttemptIds,
      );
    };

    // directions 缺一个 Attempt
    const missing = tamper({ ...baseContext.metricView, directions: [{ attemptId: 'att-a', optimizationDirection: 'maximize' }] });
    expect(missing.valid).toHaveLength(0);
    expect(missing.anomalies.join('')).toContain('方向记录数量与 Attempt 集合不一致');

    // directions 多一个 Attempt
    const extra = tamper({ ...baseContext.metricView, directions: [...baseContext.metricView.directions, { attemptId: 'att-c', optimizationDirection: 'maximize' }] });
    expect(extra.valid).toHaveLength(0);
    expect(extra.anomalies.join('')).toContain('方向记录数量与 Attempt 集合不一致');

    // directions 重复（长度仍为 2）
    const duplicate = tamper({ ...baseContext.metricView, directions: [{ attemptId: 'att-a', optimizationDirection: 'maximize' }, { attemptId: 'att-a', optimizationDirection: 'maximize' }] });
    expect(duplicate.valid).toHaveLength(0);
    expect(duplicate.anomalies.join('')).toContain('方向记录含重复 Attempt');

    // directions 未排序
    const unsorted = tamper({ ...baseContext.metricView, directions: [{ attemptId: 'att-b', optimizationDirection: 'maximize' }, { attemptId: 'att-a', optimizationDirection: 'maximize' }] });
    expect(unsorted.valid).toHaveLength(0);
    expect(unsorted.anomalies.join('')).toContain('方向记录未按 attemptId 排序');

    // directions 集合与 attemptIds 不完全相等（等长、已排序、无重复）
    const mismatched = tamper({ ...baseContext.metricView, directions: [{ attemptId: 'att-a', optimizationDirection: 'maximize' }, { attemptId: 'att-c', optimizationDirection: 'maximize' }] });
    expect(mismatched.valid).toHaveLength(0);
    expect(mismatched.anomalies.join('')).toContain('方向记录与 Attempt 集合不完全一致');

    // metricSemantics 与 metricView.metricName 不一致
    const semanticsMismatch = tamper(baseContext.metricView, 'mae');
    expect(semanticsMismatch.valid).toHaveLength(0);
    expect(semanticsMismatch.anomalies.join('')).toContain('metricView 与指标语义不一致');
  });
});

/* ---------------- 诚实尺度与语言纪律 ---------------- */

describe('axisDomain：诚实尺度', () => {
  it('比例指标默认 0～1，不用极窄动态轴夸大差异', () => {
    expect(axisDomain('accuracy', [0.801, 0.802])).toEqual({ min: 0, max: 1, scaleLabel: '0～1 全量尺度' });
  });

  it('MAE 等非负指标包含 0 基线', () => {
    const domain = axisDomain('mae', [0.2, 0.4]);
    expect(domain.min).toBe(0);
    expect(domain.scaleLabel).toBe('含 0 基线');
  });
});

describe('observationLanguage：三类 Study 表达纪律', () => {
  const attempt = makeAttempt('att-a');
  const experiments = [makeExperiment('exp-a')];

  it('自由探索：描述观察，不生成排序裁决或因果语言', () => {
    const text = observationLanguage(makeStudy({ kind: 'free_exploration' }), attempt, experiments);
    expect(text).toContain('观察到');
    expect(text).toContain('不构成排序裁决或因果归因');
    expect(text).not.toContain('更好是因为');
  });

  it('候选选择：只说候选集/预算/规则下被选中，不产生因果解释', () => {
    const text = observationLanguage(makeStudy({ kind: 'candidate_selection' }), attempt, experiments);
    expect(text).toContain('既定选择规则');
    expect(text).not.toContain('因为');
    expect(text).not.toContain('更好');
  });

  it('对照消融：bundle 表述为改动组合，不单独归因组件', () => {
    const text = observationLanguage(makeStudy({ kind: 'controlled_ablation' }), attempt, experiments);
    expect(text).toContain('该改动组合');
    expect(text).not.toContain('BatchNorm');
  });
});

/* ---------------- 最佳方案门控与刻度去重 ---------------- */

import { extractStrictSeries } from '@/utils/metricSeries';

describe('bestStrictAttempt：方向来自实际记录，语义不一致失败关闭', () => {
  function metricRecord(epoch: number, value: number, overrides: Partial<TrainMetric> = {}): TrainMetric {
    return {
      epoch, step: epoch, loss: 0.1, accuracy: value, metricName: 'accuracy', metricValue: value,
      optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: epoch,
      ...overrides,
    } as TrainMetric;
  }

  it('maximize：取最终值更高者；minimize：取最终值更低者（不用第一条方向代表全部）', () => {
    const high = makeAttempt('a', { metrics: [metricRecord(1, 0.7), metricRecord(2, 0.9)] });
    const low = makeAttempt('b', { metrics: [metricRecord(1, 0.8), metricRecord(2, 0.85)] });
    expect(bestStrictAttempt([high, low], [extractStrictSeries(high), extractStrictSeries(low)])?.id).toBe('a');

    const maeA = makeAttempt('a', { metrics: [metricRecord(1, 0.3, { metricName: 'mae', optimizationDirection: 'minimize' })] });
    const maeB = makeAttempt('b', { metrics: [metricRecord(1, 0.2, { metricName: 'mae', optimizationDirection: 'minimize' })] });
    expect(bestStrictAttempt([maeA, maeB], [extractStrictSeries(maeA), extractStrictSeries(maeB)])?.id).toBe('b');
  });

  it('任一系列不可用或方向/指标名不一致：返回 null，不生成排名', () => {
    const ok = makeAttempt('a', { metrics: [metricRecord(1, 0.7)] });
    const empty = makeAttempt('b', { metrics: [] });
    expect(bestStrictAttempt([ok, empty], [extractStrictSeries(ok), extractStrictSeries(empty)])).toBeNull();

    const maximize = makeAttempt('a', { metrics: [metricRecord(1, 0.7)] });
    const minimize = makeAttempt('b', { metrics: [metricRecord(1, 0.6, { optimizationDirection: 'minimize' })] });
    expect(bestStrictAttempt([maximize, minimize], [extractStrictSeries(maximize), extractStrictSeries(minimize)])).toBeNull();
  });
});

describe('uniqueTicks：刻度去重', () => {
  it('短 epoch 区间四舍五入后去重：不产生重复值与重复 key', () => {
    // epoch 1～2：插值四舍五入产生 [1,1,2,2,2] → 去重后只剩唯一刻度
    const ticks = uniqueTicks([0, 0.25, 0.5, 0.75, 1].map(f => Math.round(1 + f * 1)), value => String(value));
    expect(ticks.map(tick => tick.key)).toEqual(['1', '2']);
    expect(new Set(ticks.map(tick => tick.key)).size).toBe(ticks.length);
  });

  it('Y 轴退化域（全部同值）同样去重', () => {
    const ticks = uniqueTicks([0, 0.25, 0.5, 0.75, 1].map(f => 0.5 + f * 0), value => value.toFixed(3));
    expect(ticks).toHaveLength(1);
    expect(ticks[0].key).toBe('0.500');
  });
});
