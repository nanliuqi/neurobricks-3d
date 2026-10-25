import { describe, expect, it } from 'vitest';
import { strictMetricDisplay } from '@/components/panels/study/StudyExperimentList';
import { TRUST_PROTOCOL_VERSION, type Attempt } from '@/types/experiment';
import type { TrainMetric } from '@/types/training';

function makeAttempt(metrics: TrainMetric[]): Attempt {
  return {
    id: 'attempt-metric-display',
    protocolVersion: TRUST_PROTOCOL_VERSION,
    experimentId: 'experiment-a',
    runId: 'run-a',
    modelId: null,
    config: { seed: 42, learningRate: 0.001, weightDecay: 0 } as Attempt['config'],
    ordinal: 1,
    parentAttemptId: null,
    restartCount: 0,
    resumeType: 'fresh',
    status: 'completed',
    startedAt: 1,
    endedAt: 2,
    provenance: {
      source: 'controlled',
      executionTrust: 'trusted',
      environment: {
        applicationVersion: '0.1.0',
        torchVersion: null,
        pythonVersion: null,
        device: 'cpu',
        cudaVersion: null,
      },
      datasetContentHash: null,
      splitHash: null,
      testSetHash: null,
      machineChecks: [],
      testSampleCount: null,
      testLabelCounts: null,
      testTargetSummary: null,
      preprocessingHash: null,
      configHash: 'config-a',
      modelWeightsHash: null,
      witnessedByPipeline: true,
    },
    metrics,
    artifacts: null,
    executionMode: 'native',
  };
}

describe('StudyExperimentList 严格指标摘要', () => {
  it('忽略数组尾部的 train/batch 记录，只显示最后一个严格 validation/epoch 点', () => {
    const attempt = makeAttempt([
      {
        epoch: 1,
        step: 10,
        loss: 0.3,
        accuracy: 0.8,
        metricName: 'accuracy',
        metricValue: 0.8,
        optimizationDirection: 'maximize',
        split: 'validation',
        scope: 'epoch',
        timestamp: 1,
      },
      {
        epoch: 2,
        step: 20,
        loss: 0.1,
        accuracy: 0.99,
        metricName: 'accuracy',
        metricValue: 0.99,
        optimizationDirection: 'maximize',
        split: 'train',
        scope: 'batch',
        timestamp: 2,
      },
    ]);

    expect(strictMetricDisplay(attempt, 'image_classification')).toBe('Accuracy 80.0% · epoch 1');
  });

  it('保留回归指标的原始数值单位，并披露被排除的严格候选记录', () => {
    const attempt = makeAttempt([
      {
        epoch: 1,
        step: 10,
        loss: 0.2,
        accuracy: 0,
        metricName: 'mae',
        metricValue: 0.2,
        optimizationDirection: 'minimize',
        split: 'validation',
        scope: 'epoch',
        timestamp: 1,
      },
      {
        epoch: 2,
        step: 20,
        loss: 0.1,
        accuracy: 0.99,
        metricName: 'mae',
        metricValue: Number.NaN,
        optimizationDirection: 'minimize',
        split: 'validation',
        scope: 'epoch',
        timestamp: 2,
      },
    ]);

    expect(strictMetricDisplay(attempt, 'csv_regression')).toBe('MAE 0.200000 · epoch 1 · 排除 1 条异常记录');
  });

  it('严格元数据缺失时失败关闭，不用旧 accuracy 字段伪造摘要', () => {
    const attempt = makeAttempt([
      {
        epoch: 1,
        step: 10,
        loss: 0.2,
        accuracy: 0.92,
        metricName: 'accuracy',
        timestamp: 1,
      },
    ]);

    expect(strictMetricDisplay(attempt, 'image_classification')).toBe('严格验证指标不可用');
  });
});
