import { describe, expect, it } from 'vitest';
import type { Attempt, ExperimentLedgerV1, Study } from '@/types/experiment';
import { TRUST_PROTOCOL_VERSION } from '@/types/experiment';
import type { TrainMetric } from '@/types/training';
import {
  assessStrictComparability,
  environmentDifferences,
  findCrossSplitExactDuplicates,
  forceComparison,
  groupStrictComparableAttempts,
  strictComparisonGroupKey,
} from '@/utils/comparability';
import { createEmptyExperimentLedger } from '@/utils/experimentProtocol';

function makeStudy(id: string, taskType: Study['datasetContract']['identity']['taskType']): Study {
  return {
    id,
    protocolVersion: TRUST_PROTOCOL_VERSION,
    name: id,
    kind: 'candidate_selection',
    status: 'active',
    question: 'select',
    datasetContract: {
      identity: {
        id: 'dataset', name: 'data', taskType, contentHash: 'sha256:data',
        fingerprintAlgorithm: 'sha256-v1', sampleCount: 100, importedAt: 1,
      },
      split: {
        strategy: 'random', seed: 42, validationRatio: 0.2, testRatio: 0.1,
        sampleUnit: 'image', independence: 'user_declared', machineChecks: [], splitHash: 'sha256:split',
      },
      preprocessing: { configHash: 'sha256:pre', summary: 'resize' },
    },
    comparisonKey: 'key',
    selectionRule: 'best',
    budget: { maxExperiments: 3, maxGpuMinutes: 60 },
    createdAt: 1,
    updatedAt: 2,
    lockedAt: 2,
  };
}

function strictMetricRecord(overrides: Partial<TrainMetric> = {}): TrainMetric {
  // 模块 07 验收补丁：正向夹具必须携带完整 validation/epoch 元数据；
  // 旧夹具用 metrics=[] 期待严格可比表达了错误协议（空指标不得严格可比）。
  return {
    epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, metricName: 'accuracy', metricValue: 0.8,
    optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 1,
    ...overrides,
  } as TrainMetric;
}

function makeAttempt(id: string, experimentId: string, splitHash = 'sha256:split'): Attempt {
  return {
    id,
    protocolVersion: 1,
    experimentId,
    runId: `run-${id}`,
    modelId: `model-${id}`,
    config: { epochs: 1, learningRate: 0.001, batchSize: 32, dataset: 'mnist', device: 'cpu', layers: [] },
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
        applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cpu', cudaVersion: null,
      },
      datasetContentHash: 'sha256:data',
      splitHash,
      testSetHash: 'sha256:test',
      machineChecks: [],
      testSampleCount: 20,
      testLabelCounts: { '0': 10, '1': 10 },
      preprocessingHash: 'sha256:pre',
      configHash: `sha256:config-${id}`,
      modelWeightsHash: `sha256:model-${id}`,
      witnessedByPipeline: true,
    },
    metrics: [strictMetricRecord()],
    artifacts: { weights: true, fullModel: true, numpy: true, perModel: true },
    executionMode: 'native',
  };
}

function ledgerFixture(): ExperimentLedgerV1 {
  const ledger = createEmptyExperimentLedger();
  ledger.studies = [makeStudy('study-1', 'image_classification')];
  ledger.experiments = [
    { id: 'exp-a', protocolVersion: 1, studyId: 'study-1', name: 'A', config: {} as never, configHash: 'a', createdAt: 1 },
    { id: 'exp-b', protocolVersion: 1, studyId: 'study-1', name: 'B', config: {} as never, configHash: 'b', createdAt: 1 },
  ];
  ledger.attempts = [makeAttempt('a', 'exp-a'), makeAttempt('b', 'exp-b')];
  return ledger;
}

describe('strict comparability', () => {
  it('allows structure/config differences when the comparability dimensions match', () => {
    expect(assessStrictComparability(ledgerFixture(), 'a', 'b')).toEqual({
      relation: 'strict', reasons: [], watermark: null,
    });
  });

  it('blocks a different split and explains the reason in plain language', () => {
    const ledger = ledgerFixture();
    ledger.attempts[1].provenance.splitHash = 'sha256:other-split';
    const assessment = assessStrictComparability(ledger, 'a', 'b');
    expect(assessment.relation).toBe('incomparable');
    expect(assessment.reasons).toContain('验证/测试集切分不同');
    expect(forceComparison(assessment)).toMatchObject({ relation: 'override', watermark: '非严格可比' });
  });

  it('treats missing metadata and unverified execution as incomparable', () => {
    const ledger = ledgerFixture();
    ledger.attempts[1].provenance.datasetContentHash = null;
    expect(assessStrictComparability(ledger, 'a', 'b').reasons[0]).toContain('元数据缺失');
  });

  it('finds exact duplicate bytes assigned across different splits', () => {
    expect(findCrossSplitExactDuplicates([
      { sampleId: 'a.jpg', contentHash: 'same', split: 'train' },
      { sampleId: 'b.jpg', contentHash: 'same', split: 'test' },
      { sampleId: 'c.jpg', contentHash: 'unique', split: 'validation' },
    ])).toEqual([{ contentHash: 'same', sampleIds: ['a.jpg', 'b.jpg'], splits: ['test', 'train'] }]);
  });

  it('groups only complete trusted attempts with the same strict comparison key', () => {
    const ledger = ledgerFixture();
    const groups = groupStrictComparableAttempts(ledger, ledger.attempts.map(attempt => attempt.id));
    expect(groups).toHaveLength(1);
    expect(groups[0].key).not.toBeNull();
    expect(groups[0].attemptIds).toEqual(['a', 'b']);

    ledger.attempts[1] = { ...ledger.attempts[1], provenance: { ...ledger.attempts[1].provenance, executionTrust: 'unverified' } };
    expect(groupStrictComparableAttempts(ledger, ledger.attempts.map(attempt => attempt.id))).toHaveLength(2);
  });

  it('reports environment drift without blocking an otherwise strict comparison', () => {
    const ledger = ledgerFixture();
    ledger.attempts[1] = {
      ...ledger.attempts[1],
      provenance: {
        ...ledger.attempts[1].provenance,
        environment: { ...ledger.attempts[1].provenance.environment, device: 'cuda:0' },
      },
    };
    expect(assessStrictComparability(ledger, 'a', 'b').relation).toBe('strict');
    expect(environmentDifferences(ledger.attempts[0], ledger.attempts[1])).toEqual(['device']);
  });

  /* ---------- 模块 07 验收补丁：指标语义失败关闭 ---------- */

  it('空 metrics 不得严格可比，也不得进入严格组（不猜 accuracy）', () => {
    const ledger = ledgerFixture();
    ledger.attempts[1] = { ...ledger.attempts[1], metrics: [] };
    const assessment = assessStrictComparability(ledger, 'a', 'b');
    expect(assessment.relation).toBe('incomparable');
    expect(assessment.reasons.join('')).toContain('指标元数据不完整');
    expect(assessment.reasons.join('')).toContain('没有指标记录');
    expect(strictComparisonGroupKey(ledger, 'b')).toBeNull();
  });

  it('只有 train/batch 记录的 Attempt 各自孤立，不进入严格组', () => {
    const ledger = ledgerFixture();
    ledger.attempts[1] = { ...ledger.attempts[1], metrics: [strictMetricRecord({ split: 'train', scope: 'batch' })] };
    expect(strictComparisonGroupKey(ledger, 'b')).toBeNull();
    expect(assessStrictComparability(ledger, 'a', 'b').reasons.join('')).toContain('train/batch');
  });

  it('相同 metricName、不同 optimizationDirection：不可比且不同组', () => {
    const ledger = ledgerFixture();
    ledger.attempts[1] = { ...ledger.attempts[1], metrics: [strictMetricRecord({ optimizationDirection: 'minimize' })] };
    const assessment = assessStrictComparability(ledger, 'a', 'b');
    expect(assessment.relation).toBe('incomparable');
    expect(assessment.reasons).toContain('优化方向不同');
    const keyA = strictComparisonGroupKey(ledger, 'a');
    const keyB = strictComparisonGroupKey(ledger, 'b');
    expect(keyA).not.toBeNull();
    expect(keyB).not.toBeNull();
    expect(keyA).not.toBe(keyB);
  });

  it('direction 缺失或未知：失败关闭，不按 maximize 处理', () => {
    const ledger = ledgerFixture();
    ledger.attempts[1] = { ...ledger.attempts[1], metrics: [strictMetricRecord({ optimizationDirection: undefined })] };
    expect(strictComparisonGroupKey(ledger, 'b')).toBeNull();
    expect(assessStrictComparability(ledger, 'a', 'b').reasons.join('')).toContain('优化方向');

    ledger.attempts[1] = { ...ledger.attempts[1], metrics: [strictMetricRecord({ optimizationDirection: 'up' as never })] };
    expect(strictComparisonGroupKey(ledger, 'b')).toBeNull();
  });

  it('严格可比键覆盖完整指标口径：同名同向同 split/scope 才同组', () => {
    const ledger = ledgerFixture();
    const keyA = strictComparisonGroupKey(ledger, 'a');
    const keyB = strictComparisonGroupKey(ledger, 'b');
    expect(keyA).not.toBeNull();
    expect(keyA).toBe(keyB);
  });

  it('全 NaN/Infinity 指标的 Attempt 不进入默认严格组，并给出中文原因', () => {
    const ledger = ledgerFixture();
    ledger.attempts[1] = {
      ...ledger.attempts[1],
      metrics: [strictMetricRecord({ accuracy: Number.NaN, metricValue: Number.NaN })],
    };
    expect(strictComparisonGroupKey(ledger, 'b')).toBeNull();
    const assessment = assessStrictComparability(ledger, 'a', 'b');
    expect(assessment.relation).toBe('incomparable');
    // 原因文案随最终指标语义补丁更新：严格值只认有限 metricValue
    expect(assessment.reasons.join('')).toContain('有限 metricValue');
  });

  it('paused/interrupted/cancelled/failed 即便 trusted、哈希齐全也不得 strict（与 groupKey 同一资格投影）', () => {
    for (const status of ['paused', 'interrupted', 'cancelled', 'failed'] as const) {
      const ledger = ledgerFixture();
      ledger.attempts[1] = { ...ledger.attempts[1], status };
      const assessment = assessStrictComparability(ledger, 'a', 'b');
      expect(assessment.relation).toBe('incomparable');
      expect(assessment.reasons.join('')).toContain('不是已完成运行');
      expect(strictComparisonGroupKey(ledger, 'b')).toBeNull();
    }
  });
});
