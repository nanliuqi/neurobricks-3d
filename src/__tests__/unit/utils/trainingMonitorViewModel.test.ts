import { describe, expect, it } from 'vitest';
import { TRUST_PROTOCOL_VERSION, type Attempt, type ExperimentLedgerV1, type Study } from '@/types/experiment';
import type { TrainMetric, TrainRecord } from '@/types/training';
import {
  attemptStatusView,
  clampProgress,
  matchingTrainRecord,
  projectAttemptMetricEvidence,
  projectLatestDiagnosticMetric,
  projectLatestTrainingDiagnostics,
  projectTrainingChart,
  projectTrainingStatus,
  resumeTypeLabel,
  scopeAttemptsToActiveStudy,
} from '@/utils/trainingMonitorViewModel';

function metric(overrides: Partial<TrainMetric> = {}): TrainMetric {
  return {
    epoch: 1,
    step: 1,
    split: 'validation',
    scope: 'epoch',
    loss: 0.5,
    lossValue: 0.5,
    accuracy: 0.8,
    metricName: 'accuracy',
    metricValue: 0.8,
    optimizationDirection: 'maximize',
    timestamp: 1,
    ...overrides,
  };
}

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'attempt-a',
    protocolVersion: TRUST_PROTOCOL_VERSION,
    experimentId: 'experiment-a',
    runId: 'run-a',
    modelId: 'model-a',
    config: { epochs: 2, learningRate: 0.001, batchSize: 8, dataset: 'demo', device: 'cpu', layers: [] },
    ordinal: 1,
    parentAttemptId: null,
    restartCount: 0,
    resumeType: 'fresh',
    status: 'completed',
    startedAt: 100,
    endedAt: 200,
    provenance: {
      source: 'controlled',
      executionTrust: 'trusted',
      environment: { applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cpu', cudaVersion: null },
      datasetContentHash: 'data',
      splitHash: 'split',
      testSetHash: null,
      machineChecks: [],
      testSampleCount: null,
      testLabelCounts: null,
      testTargetSummary: null,
      preprocessingHash: 'prep',
      preprocessingParameters: {},
      configHash: 'config',
      modelWeightsHash: 'weights',
      witnessedByPipeline: true,
    },
    metrics: [metric()],
    artifacts: { weights: true, fullModel: true, numpy: true, perModel: true },
    executionMode: 'native',
    ...overrides,
  };
}

function study(id: string): Study {
  return {
    id,
    protocolVersion: TRUST_PROTOCOL_VERSION,
    name: id,
    kind: 'candidate_selection',
    status: 'active',
    question: '选择候选',
    datasetContract: {
      identity: { id: 'dataset', name: 'dataset', taskType: 'image_classification', contentHash: 'data', fingerprintAlgorithm: 'sha256-v1', sampleCount: 10, importedAt: 1 },
      split: { strategy: 'random', seed: 42, validationRatio: 0.2, testRatio: 0, sampleUnit: '图片', independence: 'iid_assumed', machineChecks: [], splitHash: 'split' },
      preprocessing: { configHash: 'prep', summary: 'resize' },
    },
    comparisonKey: 'key',
    selectionRule: null,
    budget: { maxExperiments: null, maxGpuMinutes: null },
    createdAt: 1,
    updatedAt: 1,
    lockedAt: null,
  };
}

describe('trainingMonitorViewModel', () => {
  it('未知训练状态失败关闭，不伪装为空闲', () => {
    expect(projectTrainingStatus('future-status')).toMatchObject({ known: false, tone: 'danger', terminal: true });
  });

  it('进度钳制到 0..100，并拒绝非法总轮数', () => {
    expect(clampProgress(-1, 10)).toBe(0);
    expect(clampProgress(15, 10)).toBe(100);
    expect(clampProgress(1, 0)).toBe(0);
  });

  it('曲线把 train/batch 与 validation/epoch 分开', () => {
    const chart = projectTrainingChart([
      metric({ split: 'train', scope: 'batch', step: 1, metricValue: 0.7 }),
      metric({ split: 'validation', scope: 'epoch', step: 2, metricValue: 0.8 }),
    ]);
    expect(chart.series.find(item => item.key === 'train_metric')?.points).toHaveLength(1);
    expect(chart.series.find(item => item.key === 'validation_metric')?.points).toHaveLength(1);
  });

  it('缺少 metricName 时不猜成 Accuracy', () => {
    const chart = projectTrainingChart([metric({ metricName: undefined })]);
    expect(chart.metricName).toBeNull();
    expect(chart.series.some(item => item.axis === 'metric')).toBe(false);
    expect(chart.warnings.join(' ')).toContain('未猜测为 Accuracy');
  });

  it('多个指标名时不混成一条曲线', () => {
    const chart = projectTrainingChart([
      metric({ metricName: 'accuracy' }),
      metric({ metricName: 'mae', metricValue: 0.2, optimizationDirection: 'minimize' }),
    ]);
    expect(chart.metricName).toBeNull();
    expect(chart.series.some(item => item.axis === 'metric')).toBe(false);
    expect(chart.warnings.join(' ')).toContain('多个主指标');
  });

  it('缺失 split/scope 与非有限值不会进入坐标', () => {
    const chart = projectTrainingChart([
      metric({ split: undefined, scope: undefined }),
      metric({ metricValue: Number.NaN }),
    ]);
    expect(chart.excludedRecordCount).toBeGreaterThanOrEqual(2);
    expect(chart.series.find(item => item.axis === 'metric')).toBeUndefined();
  });

  it('显式非法 lossValue 不会被旧 loss 字段静默覆盖', () => {
    const chart = projectTrainingChart([metric({ lossValue: Number.NaN, loss: 0.5 })]);
    expect(chart.series.some(item => item.axis === 'loss')).toBe(false);
    expect(chart.series.some(item => item.axis === 'metric')).toBe(true);
  });

  it('最新诊断指标要求显式名称，但旧 accuracy 字段只在诊断路径兼容', () => {
    expect(projectLatestDiagnosticMetric([metric({ metricValue: undefined, accuracy: 0.75 })])).toMatchObject({
      available: true,
      label: 'Accuracy',
      valueText: '75.0%',
    });
    expect(projectLatestDiagnosticMetric([metric({ metricName: undefined })]).available).toBe(false);
  });

  it('严格曲线拒绝只存在旧 accuracy 兼容字段的记录', () => {
    const strictChart = projectTrainingChart([metric({ metricValue: undefined, accuracy: 0.9 })], 'strict');
    expect(strictChart.metricValueMode).toBe('strict');
    expect(strictChart.series.some(item => item.axis === 'metric')).toBe(false);
    expect(strictChart.warnings.join(' ')).toContain('未进入严格主指标曲线');
    const diagnosticChart = projectTrainingChart([metric({ metricValue: undefined, accuracy: 0.9 })]);
    expect(diagnosticChart.series.some(item => item.axis === 'metric')).toBe(true);
  });

  it('任务卡片优先展示明确的 validation/epoch，而不是数组尾项', () => {
    const summary = projectLatestTrainingDiagnostics([
      metric({ epoch: 2, split: 'validation', scope: 'epoch', lossValue: 0.4, metricValue: 0.8 }),
      metric({ epoch: 3, split: 'train', scope: 'batch', lossValue: 0.1, metricValue: 0.99 }),
    ]);
    expect(summary.loss).toMatchObject({ context: '验证轮次', epoch: 2, valueText: '0.400000' });
    expect(summary.metric).toMatchObject({ context: '验证轮次', epoch: 2, valueText: '80.0%' });
  });

  it('任务卡片不把 MAE 乘成百分比，也不写死 Accuracy 标签', () => {
    const summary = projectLatestTrainingDiagnostics([
      metric({ metricName: 'mae', metricValue: 0.2, optimizationDirection: 'minimize' }),
    ]);
    expect(summary.metric).toMatchObject({ label: 'MAE', valueText: '0.200000' });
  });

  it('任务记录缺少 split/scope 时失败关闭，不猜测尾项指标', () => {
    const summary = projectLatestTrainingDiagnostics([
      metric({ split: undefined, scope: undefined, loss: 0.1, accuracy: 0.99 }),
    ]);
    expect(summary.loss).toBeNull();
    expect(summary.metric).toBeNull();
    expect(summary.warnings.length).toBeGreaterThan(0);
  });

  it('可信完成 Attempt 只从 validation/epoch 取最终和最佳指标', () => {
    const evidence = projectAttemptMetricEvidence(attempt({ metrics: [
      metric({ epoch: 1, split: 'train', scope: 'batch', metricValue: 0.99 }),
      metric({ epoch: 1, metricValue: 0.8 }),
      metric({ epoch: 2, metricValue: 0.82, timestamp: 2 }),
    ] }));
    expect(evidence.authoritative).toBe(true);
    expect(evidence.finalPoint).toMatchObject({ epoch: 2, text: '82.0%' });
    expect(evidence.bestPoint).toMatchObject({ epoch: 2, text: '82.0%' });
  });

  it('最小化指标按较小值选最佳 epoch，且不乘百分比', () => {
    const evidence = projectAttemptMetricEvidence(attempt({ metrics: [
      metric({ epoch: 1, metricName: 'mae', metricValue: 0.3, optimizationDirection: 'minimize' }),
      metric({ epoch: 2, metricName: 'mae', metricValue: 0.2, optimizationDirection: 'minimize', timestamp: 2 }),
    ] }));
    expect(evidence.bestPoint).toMatchObject({ epoch: 2, text: '0.200000' });
  });

  it.each(['paused', 'interrupted', 'failed', 'cancelled'] as const)('%s Attempt 的部分轨迹不具备权威性', status => {
    const evidence = projectAttemptMetricEvidence(attempt({ status }));
    expect(evidence.authoritative).toBe(false);
    expect(evidence.label).toContain('诊断');
  });

  it('演示 Attempt 永远不是实验结果', () => {
    const evidence = projectAttemptMetricEvidence(attempt({ executionMode: 'simulation' }));
    expect(evidence.authoritative).toBe(false);
    expect(evidence.label).toContain('演示数据');
  });

  it('仅权重恢复保留执行可信但明确披露轨迹改变', () => {
    const evidence = projectAttemptMetricEvidence(attempt({ resumeType: 'weights_only' }));
    expect(evidence.authoritative).toBe(true);
    expect(evidence.label).toContain('非完整状态恢复');
    expect(resumeTypeLabel('weights_only')).toContain('轨迹已改变');
  });

  it('未知恢复语义失败关闭', () => {
    const evidence = projectAttemptMetricEvidence(attempt({ resumeType: 'future' as Attempt['resumeType'] }));
    expect(evidence.authoritative).toBe(false);
    expect(evidence.tone).toBe('danger');
  });

  it('未知 Attempt 状态失败关闭', () => {
    const broken = attempt({ status: 'future' as Attempt['status'] });
    expect(attemptStatusView(broken.status).known).toBe(false);
    expect(projectAttemptMetricEvidence(broken).tone).toBe('danger');
  });

  it('Attempt 历史严格限定在当前活动 Study', () => {
    const ledger: ExperimentLedgerV1 = {
      protocolVersion: TRUST_PROTOCOL_VERSION,
      ledgerId: 'ledger',
      studies: [study('study-a'), study('study-b')],
      experiments: [
        { id: 'experiment-a', protocolVersion: TRUST_PROTOCOL_VERSION, studyId: 'study-a', name: 'A', config: attempt().config, configHash: 'a', createdAt: 1 },
        { id: 'experiment-b', protocolVersion: TRUST_PROTOCOL_VERSION, studyId: 'study-b', name: 'B', config: attempt().config, configHash: 'b', createdAt: 1 },
      ],
      attempts: [attempt(), attempt({ id: 'attempt-b', experimentId: 'experiment-b' })],
      claims: [],
      events: [],
    };
    expect(scopeAttemptsToActiveStudy(ledger, 'study-a').map(item => item.attempt.id)).toEqual(['attempt-a']);
    expect(scopeAttemptsToActiveStudy(ledger, null)).toEqual([]);
  });

  it('完成记录必须按 attemptId 精确匹配', () => {
    const records = [
      { id: 'newer', attemptId: 'other' },
      { id: 'target', attemptId: 'attempt-a' },
    ] as TrainRecord[];
    expect(matchingTrainRecord(records, 'attempt-a')?.id).toBe('target');
    expect(matchingTrainRecord(records, null)).toBeNull();
  });
});
