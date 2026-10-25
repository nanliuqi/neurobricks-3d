import { beforeEach, describe, expect, it } from 'vitest';
import {
  finishRuntimeAttempt,
  prepareTrainingAttempt,
  terminateRuntimeAttempt,
  transitionRuntimeAttempt,
} from '@/experimentRuntime';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import type { TrainConfig } from '@/types/training';

const CONFIG: TrainConfig = {
  epochs: 2,
  learningRate: 0.001,
  batchSize: 32,
  dataset: 'mnist',
  device: 'cuda:0',
  seed: 42,
  valSplit: 0.2,
  layers: [
    { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
    { type: 'Flatten', params: {} },
    { type: 'Linear', params: { inFeatures: 784, outFeatures: 10 } },
  ],
};

describe('experiment runtime attempt lineage', () => {
  beforeEach(() => {
    useExperimentStore.getState().resetLedgerForTests();
    useDatasetStore.setState({
      ...useDatasetStore.getInitialState(),
      datasetType: 'mnist',
      datasetInfo: {
        datasetId: 'builtin-mnist',
        name: 'MNIST',
        type: 'mnist',
        sampleCount: 70_000,
        classCount: 10,
        importedAt: 1,
        sampleUnit: 'image',
        sampleIndependence: 'machine_verified',
      },
    });
  });

  it('creates Study, Experiment and a starting Attempt as one controlled context', async () => {
    const prepared = await prepareTrainingAttempt({ ...CONFIG, runId: 'run-1' }, 'native');
    const ledger = useExperimentStore.getState().ledger;
    expect(ledger.studies).toHaveLength(1);
    expect(ledger.experiments).toHaveLength(1);
    expect(ledger.attempts).toHaveLength(1);
    expect(ledger.attempts[0]).toMatchObject({
      id: prepared.attemptId,
      runId: 'run-1',
      status: 'starting',
      restartCount: 0,
      resumeType: 'fresh',
      provenance: { source: 'controlled', executionTrust: 'unverified' },
    });
    expect(ledger.studies[0].lockedAt).not.toBeNull();
  });

  it('upgrades only complete native provenance to trusted', async () => {
    const prepared = await prepareTrainingAttempt({ ...CONFIG, runId: 'run-1' }, 'native');
    transitionRuntimeAttempt(prepared.attemptId, 'running');
    finishRuntimeAttempt(
      prepared.attemptId,
      [{ epoch: 1, step: 1, loss: 0.5, accuracy: 0.8, timestamp: 1 }],
      { weights: true, fullModel: true, numpy: true, perModel: true },
      {
        attemptId: prepared.attemptId,
        modelWeightsHash: 'sha256:model',
        datasetContentHash: prepared.datasetContentHash,
        splitPolicyHash: prepared.splitPolicyHash,
        splitAssignmentHash: 'sha256:split-assignment',
        preprocessingPolicyHash: prepared.preprocessingPolicyHash,
        fittedPreprocessingHash: 'sha256:fitted-preprocessing',
        artifactsVerified: true,
        splitHash: prepared.splitHash,
        preprocessingHash: prepared.preprocessingHash,
        preprocessingParameters: { algorithm: 'test-v1' },
        machineChecks: [
          { check: 'cross_split_exact_duplicate', status: 'passed', details: 'fixture' },
        ],
        environment: {
          applicationVersion: '0.1.0',
          torchVersion: '2.5.0',
          pythonVersion: '3.12.0',
          device: 'cuda:0',
          cudaVersion: '12.8',
        },
      },
    );
    expect(useExperimentStore.getState().ledger.attempts[0].provenance.executionTrust).toBe('trusted');
  });

  it('keeps the interrupted curve and creates a distinct fresh retry attempt', async () => {
    const first = await prepareTrainingAttempt({ ...CONFIG, runId: 'run-1' }, 'native');
    transitionRuntimeAttempt(first.attemptId, 'running');
    terminateRuntimeAttempt(
      first.attemptId,
      'interrupted',
      [{ epoch: 1, step: 5, loss: 1, accuracy: 0.5, timestamp: 1 }],
      'watchdog timeout',
    );

    const retry = await prepareTrainingAttempt({
      ...CONFIG,
      runId: 'run-2',
      experimentId: first.experimentId,
      studyId: first.studyId,
      parentAttemptId: first.attemptId,
      restartCount: 1,
      resumeType: 'fresh',
    }, 'native');

    const attempts = useExperimentStore.getState().ledger.attempts;
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(attempts[0]).toMatchObject({ status: 'interrupted', metrics: [{ step: 5 }] });
    expect(attempts[1]).toMatchObject({
      status: 'starting',
      parentAttemptId: first.attemptId,
      restartCount: 1,
      resumeType: 'fresh',
      metrics: [],
    });
  });
});

describe('experiment runtime CSV featureFields fallback（与 datasetContract 单一来源一致）', () => {
  const CSV_COLUMNS = ['customer_id', 'captured_at', 'feature_a', 'target'];

  function setCsvStore(extra: Record<string, unknown> = {}) {
    useExperimentStore.getState().resetLedgerForTests();
    useDatasetStore.setState({
      ...useDatasetStore.getInitialState(),
      datasetType: 'csv',
      datasetPath: 'D:/data.csv',
      datasetInfo: {
        datasetId: 'ds-csv',
        contentHash: 'hash-csv',
        name: 'regression',
        type: 'csv',
        sampleCount: 100,
        classCount: 0,
        columns: CSV_COLUMNS,
        importedAt: 1,
      },
      ...extra,
    });
  }

  const CSV_CONFIG: TrainConfig = {
    epochs: 2,
    learningRate: 0.001,
    batchSize: 32,
    dataset: 'csv',
    device: 'cpu',
    seed: 42,
    valSplit: 0.2,
    targetField: 'target',
    inputShape: [1, 1, 2],
    modelId: 'model-1',
    layers: [
      { type: 'Input', params: { inChannels: 1, inputHeight: 1, inputWidth: 2 } },
      { type: 'Flatten', params: {} },
      { type: 'Linear', params: { inFeatures: 2, outFeatures: 1 } },
    ],
  };

  async function fallbackFeatureFields(split: Record<string, unknown>): Promise<string[] | undefined> {
    // config.featureFields 缺失 → 必须走与 Preflight/UI 同源的策略感知回退。
    await prepareTrainingAttempt({ ...CSV_CONFIG, runId: 'run-csv', ...split } as TrainConfig & { runId: string }, 'native');
    return useExperimentStore.getState().ledger.studies[0].datasetContract.identity.featureFields;
  }

  it('config.featureFields 缺失时回退规则与单一来源一致（random）', async () => {
    setCsvStore({ splitStrategy: 'random' });
    expect(await fallbackFeatureFields({ splitStrategy: 'random' }))
      .toEqual(['customer_id', 'captured_at', 'feature_a']);
  });

  it('group 策略回退只排除激活的 groupField，不错误排除未激活的 timeField', async () => {
    setCsvStore({ splitStrategy: 'group', groupField: 'customer_id' });
    expect(await fallbackFeatureFields({
      splitStrategy: 'group', groupField: 'customer_id', timeField: 'captured_at',
    })).toEqual(['captured_at', 'feature_a']);
  });

  it('temporal 策略回退只排除激活的 timeField，不错误排除未激活的 groupField', async () => {
    setCsvStore({ splitStrategy: 'temporal', timeField: 'captured_at' });
    expect(await fallbackFeatureFields({
      splitStrategy: 'temporal', groupField: 'customer_id', timeField: 'captured_at',
    })).toEqual(['customer_id', 'feature_a']);
  });

  it('config.featureFields 显式提供时优先使用（不触发回退）', async () => {
    setCsvStore({ splitStrategy: 'random' });
    await prepareTrainingAttempt({
      ...CSV_CONFIG, runId: 'run-csv-2', featureFields: ['feature_a'],
    } as TrainConfig & { runId: string }, 'native');
    expect(useExperimentStore.getState().ledger.studies[0].datasetContract.identity.featureFields)
      .toEqual(['feature_a']);
  });

  it('目标列缺失时不生成伪 featureFields（契约未成立）', async () => {
    setCsvStore({ splitStrategy: 'random' });
    const { targetField: _ignored, ...configWithoutTarget } = CSV_CONFIG;
    await prepareTrainingAttempt(
      { ...configWithoutTarget, runId: 'run-csv-no-target' } as TrainConfig & { runId: string },
      'native',
    );
    const identity = useExperimentStore.getState().ledger.studies[0].datasetContract.identity;
    // 不得把全部列当成特征，也不得伪造目标列。
    expect(identity.featureFields).toBeUndefined();
    expect(identity.targetField).toBeUndefined();
  });
});
