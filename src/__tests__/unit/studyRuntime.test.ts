import { beforeEach, describe, expect, it } from 'vitest';
import { saveClaimDraft } from '@/claimRuntime';
import { finishRuntimeAttempt, prepareTrainingAttempt, transitionRuntimeAttempt } from '@/experimentRuntime';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useLayerStore } from '@/stores/useLayerStore';
import type { TrainConfig } from '@/types/training';
import {
  archiveStudy,
  createStudyFromCurrentContext,
  revokeStudyCandidate,
  selectStudyCandidate,
} from '@/studyRuntime';
import { allowedStudyConclusion, diffTrainingConfigs, pairedAblationEvidence } from '@/utils/studyProtocol';

const LAYERS: TrainConfig['layers'] = [
  { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
  { type: 'Flatten', params: {} },
  { type: 'Linear', params: { inFeatures: 784, outFeatures: 10 } },
];

const CONFIG: TrainConfig = {
  epochs: 5,
  learningRate: 0.001,
  batchSize: 32,
  dataset: 'mnist',
  device: 'cuda',
  optimizer: 'adam',
  lrScheduler: 'none',
  seed: 42,
  valSplit: 0.2,
  weightDecay: 0,
  trainRatio: 0.8,
  inputShape: [1, 28, 28],
  splitStrategy: 'random',
  layers: LAYERS,
};

describe('Study workflow', () => {
  beforeEach(() => {
    localStorage.clear();
    useExperimentStore.getState().resetLedgerForTests();
    useDatasetStore.setState({
      ...useDatasetStore.getInitialState(),
      datasetType: 'mnist',
      datasetInfo: {
        datasetId: 'builtin-mnist-torchvision-v1',
        name: 'MNIST',
        type: 'mnist',
        contentHash: 'builtin:mnist:torchvision-v1',
        importedAt: 1,
        sampleUnit: 'image',
        sampleIndependence: 'machine_verified',
        sampleCount: 70_000,
        classCount: 10,
      },
    });
    useLayerStore.setState({
      ...useLayerStore.getInitialState(),
      layers: LAYERS.map((layer, order) => ({
        id: `layer-${order}`,
        type: layer.type,
        params: layer.params,
        order,
        position: [0, 0, 0],
        outputShape: null,
        paramCount: 0,
        validationError: null,
      })),
    });
  });

  it('creates and activates a formal Study bound to the current dataset contract', async () => {
    const study = await createStudyFromCurrentContext({
      name: '结构候选',
      question: '哪个结构在固定预算下最好？',
      kind: 'candidate_selection',
      selectionRule: 'val macro-F1 最高',
      maxExperiments: 3,
    });
    expect(useExperimentStore.getState().activeStudyId).toBe(study.id);
    expect(study).toMatchObject({
      status: 'draft',
      kind: 'candidate_selection',
      budget: { maxExperiments: 3 },
      datasetContract: { identity: { contentHash: 'builtin:mnist:torchvision-v1' } },
    });
  });

  it('removes an archived Study from the active list without deleting its evidence', async () => {
    const study = await createStudyFromCurrentContext({
      name: '待归档课题', question: '完成后隐藏', kind: 'candidate_selection', maxExperiments: 2,
    });
    const prepared = await prepareTrainingAttempt({ ...CONFIG, runId: 'run-archive' }, 'native');
    transitionRuntimeAttempt(prepared.attemptId, 'running');
    useExperimentStore.getState().transitionAttemptStatus(prepared.attemptId, 'cancelled', Date.now());

    const archived = archiveStudy(study.id);
    const state = useExperimentStore.getState();
    expect(archived.archivedAt).not.toBeNull();
    expect(state.activeStudyId).toBeNull();
    expect(state.ledger.experiments.some(item => item.studyId === study.id)).toBe(true);
    expect(state.ledger.attempts.some(item => item.id === prepared.attemptId)).toBe(true);
    expect(state.ledger.events.at(-1)?.eventType).toBe('study_archived');
    expect(() => state.setActiveStudy(study.id)).toThrow(/Study 不存在/);
  });

  it('generates an actual field-level diff and labels bundles honestly', async () => {
    const candidate: TrainConfig = {
      ...CONFIG,
      learningRate: 0.01,
      layers: CONFIG.layers.map((layer, index) => index === 2
        ? { ...layer, params: { ...layer.params, outFeatures: 2 } }
        : layer),
    };
    const diff = diffTrainingConfigs(CONFIG, candidate);
    expect(diff).toContain('learningRate');
    expect(diff).toContain('layers[2].params.outFeatures');

    const study = await createStudyFromCurrentContext({
      name: '消融',
      question: '哪些改动带来变化？',
      kind: 'controlled_ablation',
      maxExperiments: 3,
    });
    expect(allowedStudyConclusion(study, undefined, diff)).toContain('改动组合');
  });

  it('enforces the Study experiment-count budget before starting another design', async () => {
    await createStudyFromCurrentContext({
      name: '一晚预算',
      question: '只允许一个候选',
      kind: 'candidate_selection',
      maxExperiments: 1,
    });
    await prepareTrainingAttempt({ ...CONFIG, runId: 'run-1' }, 'native');
    await expect(prepareTrainingAttempt({ ...CONFIG, epochs: 6, runId: 'run-2' }, 'native'))
      .rejects.toThrow(/预算上限/);
  });

  it('enforces elapsed GPU-time budget before a new Attempt starts', async () => {
    await createStudyFromCurrentContext({
      name: 'GPU 时间预算',
      question: '到点停止继续尝试',
      kind: 'candidate_selection',
      maxExperiments: 3,
      maxGpuMinutes: 0.5,
    });
    const first = await prepareTrainingAttempt({ ...CONFIG, runId: 'run-budget-1' }, 'native');
    const startedAt = useExperimentStore.getState().ledger.attempts[0].startedAt!;
    useExperimentStore.getState().transitionAttemptStatus(first.attemptId, 'running', startedAt + 1);
    useExperimentStore.getState().transitionAttemptStatus(first.attemptId, 'completed', startedAt + 60_001);
    await expect(prepareTrainingAttempt({ ...CONFIG, runId: 'run-budget-2' }, 'native'))
      .rejects.toThrow(/GPU 分钟/);
  });

  it('records manual candidate selection against one trusted completed weight', async () => {
    const study = await createStudyFromCurrentContext({
      name: '候选留痕',
      question: '选择哪个具体权重？',
      kind: 'candidate_selection',
      maxExperiments: 3,
    });
    const config = await prepareTrainingAttempt({ ...CONFIG, runId: 'run-selected', modelId: 'model-selected' }, 'native');
    transitionRuntimeAttempt(config.attemptId, 'running');
    finishRuntimeAttempt(
      config.attemptId,
      [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, metricName: 'accuracy', timestamp: 1 }],
      { weights: true, fullModel: true, numpy: true, perModel: true },
      {
        attemptId: config.attemptId,
        modelWeightsHash: 'sha256:selected',
        datasetContentHash: config.datasetContentHash,
        splitPolicyHash: config.splitPolicyHash,
        splitAssignmentHash: 'sha256:selected-split',
        preprocessingPolicyHash: config.preprocessingPolicyHash,
        fittedPreprocessingHash: 'sha256:selected-preprocessing',
        artifactsVerified: true,
        splitHash: config.splitHash,
        preprocessingHash: config.preprocessingHash,
        preprocessingParameters: { algorithm: 'test-v1' },
        testSetHash: 'sha256:test',
        testSampleCount: 10,
        testLabelCounts: { '0': 5, '1': 5 },
        machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'not_run' }],
        environment: { applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cuda', cudaVersion: '12' },
      },
    );
    const selected = selectStudyCandidate(study.id, config.attemptId);
    expect(selected.selectedAttemptId).toBe(config.attemptId);
    expect(selected.selectedExperimentId).toBe(config.experimentId);
    expect(useExperimentStore.getState().ledger.events.at(-1)).toMatchObject({
      eventType: 'candidate_selected',
      payload: { selectionMechanism: 'manual', attemptId: config.attemptId },
    });

    const revoked = revokeStudyCandidate(study.id);
    expect(revoked.selectedAttemptId).toBeNull();
    expect(revoked.selectedExperimentId).toBeNull();
    expect(useExperimentStore.getState().ledger.events.at(-1)).toMatchObject({
      eventType: 'candidate_selection_revoked',
      payload: {
        previousExperimentId: config.experimentId,
        previousAttemptId: config.attemptId,
      },
    });

    selectStudyCandidate(study.id, config.attemptId);
    saveClaimDraft(config.attemptId, [{
      id: 'primary',
      role: 'primary',
      metric: 'accuracy',
      operator: 'gte',
      threshold: 0.8,
      confidenceLevel: 0.95,
      intervalMethod: 'wilson',
      minimumEffectiveSampleSize: 1,
    }]);
    expect(() => revokeStudyCandidate(study.id)).toThrow(/已被评估主张引用/);
    expect(useExperimentStore.getState().ledger.studies.find(item => item.id === study.id)?.selectedAttemptId)
      .toBe(config.attemptId);
  });

  it('requires a completed trusted baseline with the same seed before an ablation candidate', async () => {
    await createStudyFromCurrentContext({
      name: '配对消融',
      question: '学习率改动是否带来配对改善？',
      kind: 'controlled_ablation',
      maxExperiments: 3,
    });
    const baseline = await prepareTrainingAttempt({ ...CONFIG, runId: 'run-base', modelId: 'model-base' }, 'native');
    await expect(prepareTrainingAttempt({ ...CONFIG, learningRate: 0.01, runId: 'run-too-early' }, 'native'))
      .rejects.toThrow(/可信基线/);
    expect(useExperimentStore.getState().ledger.experiments).toHaveLength(1);

    transitionRuntimeAttempt(baseline.attemptId, 'running');
    finishRuntimeAttempt(
      baseline.attemptId,
      // 模块 07 验收补丁：配对证据只消费严格 validation/epoch 指标，夹具携带完整元数据
      [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, metricName: 'accuracy', metricValue: 0.8, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 1 }],
      { weights: true, fullModel: true, numpy: true, perModel: true },
      {
        attemptId: baseline.attemptId,
        modelWeightsHash: 'sha256:base',
        datasetContentHash: baseline.datasetContentHash,
        splitPolicyHash: baseline.splitPolicyHash,
        splitAssignmentHash: 'sha256:paired-split',
        preprocessingPolicyHash: baseline.preprocessingPolicyHash,
        fittedPreprocessingHash: 'sha256:paired-preprocessing',
        artifactsVerified: true,
        splitHash: baseline.splitHash,
        preprocessingHash: baseline.preprocessingHash,
        preprocessingParameters: { algorithm: 'test-v1' },
        testSetHash: 'sha256:test',
        testSampleCount: 10,
        testLabelCounts: { '0': 5, '1': 5 },
        machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'not_run' }],
        environment: { applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cuda', cudaVersion: '12' },
      },
    );

    const candidate = await prepareTrainingAttempt({ ...CONFIG, learningRate: 0.01, runId: 'run-candidate', modelId: 'model-candidate' }, 'native');
    transitionRuntimeAttempt(candidate.attemptId, 'running');
    finishRuntimeAttempt(
      candidate.attemptId,
      [{ epoch: 1, step: 1, loss: 0.1, accuracy: 0.85, metricName: 'accuracy', metricValue: 0.85, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 2 }],
      { weights: true, fullModel: true, numpy: true, perModel: true },
      {
        attemptId: candidate.attemptId,
        modelWeightsHash: 'sha256:candidate',
        datasetContentHash: candidate.datasetContentHash,
        splitPolicyHash: candidate.splitPolicyHash,
        splitAssignmentHash: 'sha256:paired-split',
        preprocessingPolicyHash: candidate.preprocessingPolicyHash,
        fittedPreprocessingHash: 'sha256:paired-preprocessing',
        artifactsVerified: true,
        splitHash: candidate.splitHash,
        preprocessingHash: candidate.preprocessingHash,
        preprocessingParameters: { algorithm: 'test-v1' },
        testSetHash: 'sha256:test',
        testSampleCount: 10,
        testLabelCounts: { '0': 5, '1': 5 },
        machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'not_run' }],
        environment: { applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cuda', cudaVersion: '12' },
      },
    );

    const studyId = useExperimentStore.getState().activeStudyId!;
    const evidence = pairedAblationEvidence(useExperimentStore.getState().ledger, studyId)[0];
    expect(evidence.pairs[0]).toMatchObject({ seed: 42, baseline: 0.8, candidate: 0.85 });
    expect(evidence.pairs[0].difference).toBeCloseTo(0.05);
    // 严格口径：指标语义与方向来自实际记录，pair 携带双方 Attempt 身份
    expect(evidence.metricName).toBe('accuracy');
    expect(evidence.optimizationDirection).toBe('maximize');
    expect(evidence.pairs[0].baselineAttemptId).toBe(baseline.attemptId);
    expect(evidence.pairs[0].candidateAttemptId).toBe(candidate.attemptId);
    expect(evidence.meanDifference).toBeCloseTo(0.05);
    expect(evidence.interval95).toBeNull();
    await expect(prepareTrainingAttempt({ ...CONFIG, seed: 43, learningRate: 0.01, runId: 'run-unpaired' }, 'native'))
      .rejects.toThrow(/seed=43/);
  });
});
