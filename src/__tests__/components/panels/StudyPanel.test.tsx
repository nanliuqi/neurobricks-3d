import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import StudyPanel from '@/components/panels/StudyPanel';
import { finishRuntimeAttempt, prepareTrainingAttempt, transitionRuntimeAttempt } from '@/experimentRuntime';
import { createStudyFromCurrentContext } from '@/studyRuntime';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useLayerStore } from '@/stores/useLayerStore';
import type { TrainConfig } from '@/types/training';

const LAYERS: TrainConfig['layers'] = [
  { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
  { type: 'Flatten', params: {} },
  { type: 'Linear', params: { inFeatures: 784, outFeatures: 10 } },
];

const CONFIG: TrainConfig = {
  epochs: 1,
  learningRate: 0.001,
  batchSize: 32,
  dataset: 'mnist',
  device: 'cuda',
  layers: LAYERS,
  optimizer: 'adam',
  lrScheduler: 'none',
  seed: 42,
  valSplit: 0.2,
  weightDecay: 0,
  trainRatio: 0.8,
  inputShape: [1, 28, 28],
  splitStrategy: 'random',
};

describe('StudyPanel candidate confirmation', () => {
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

  it('requires confirmation before selection and supports an audited rollback', async () => {
    const study = await createStudyFromCurrentContext({
      name: '候选交互测试',
      question: '候选是否经过明确确认？',
      kind: 'candidate_selection',
      maxExperiments: 2,
    });
    const config = await prepareTrainingAttempt({ ...CONFIG, runId: 'run-ui-candidate' }, 'native');
    transitionRuntimeAttempt(config.attemptId, 'running');
    finishRuntimeAttempt(
      config.attemptId,
      [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, metricName: 'accuracy', timestamp: 1 }],
      { weights: true, fullModel: true, numpy: true, perModel: true },
      {
        attemptId: config.attemptId,
        modelWeightsHash: 'sha256:ui-candidate',
        datasetContentHash: config.datasetContentHash,
        splitPolicyHash: config.splitPolicyHash,
        splitAssignmentHash: 'sha256:ui-candidate-split',
        preprocessingPolicyHash: config.preprocessingPolicyHash,
        fittedPreprocessingHash: 'sha256:ui-candidate-preprocessing',
        artifactsVerified: true,
        splitHash: config.splitHash,
        preprocessingHash: config.preprocessingHash,
        preprocessingParameters: { algorithm: 'test-v1' },
        testSetHash: 'sha256:test',
        testSampleCount: 10,
        testLabelCounts: { '0': 5, '1': 5 },
        machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'passed' }],
        environment: {
          applicationVersion: '0.1.0',
          torchVersion: '2',
          pythonVersion: '3',
          device: 'cuda',
          cudaVersion: '12',
        },
      },
    );
    render(<StudyPanel />);
    fireEvent.click(screen.getByRole('button', { name: /选择方案 1/ }));
    expect(screen.getByRole('alertdialog', { name: '确认选择这个候选？' })).toHaveTextContent('主张建立后');
    expect(useExperimentStore.getState().ledger.studies.find(item => item.id === study.id)?.selectedAttemptId).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
    expect(useExperimentStore.getState().ledger.studies.find(item => item.id === study.id)?.selectedAttemptId).toBe(config.attemptId);

    let replacement!: Awaited<ReturnType<typeof prepareTrainingAttempt>>;
    await act(async () => {
      // 同一个 Experiment 产生新 Attempt 后，旧候选仍必须留在界面中供用户撤回。
      replacement = await prepareTrainingAttempt({ ...CONFIG, runId: 'run-ui-replacement' }, 'native');
      transitionRuntimeAttempt(replacement.attemptId, 'running');
      finishRuntimeAttempt(
        replacement.attemptId,
        [{ epoch: 1, step: 1, loss: 0.18, accuracy: 0.82, metricName: 'accuracy', timestamp: 2 }],
        { weights: true, fullModel: true, numpy: true, perModel: true },
        {
          attemptId: replacement.attemptId,
          modelWeightsHash: 'sha256:ui-replacement',
          datasetContentHash: replacement.datasetContentHash,
          splitPolicyHash: replacement.splitPolicyHash,
          splitAssignmentHash: 'sha256:ui-replacement-split',
          preprocessingPolicyHash: replacement.preprocessingPolicyHash,
          fittedPreprocessingHash: 'sha256:ui-replacement-preprocessing',
          artifactsVerified: true,
          splitHash: replacement.splitHash,
          preprocessingHash: replacement.preprocessingHash,
          preprocessingParameters: { algorithm: 'test-v1' },
          testSetHash: 'sha256:test',
          testSampleCount: 10,
          testLabelCounts: { '0': 5, '1': 5 },
          machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'passed' }],
          environment: {
            applicationVersion: '0.1.0',
            torchVersion: '2',
            pythonVersion: '3',
            device: 'cuda',
            cudaVersion: '12',
          },
        },
      );
    });

    expect(screen.getByRole('button', { name: /当前候选.*Attempt #1.*点击撤回/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /选择方案 1.*Attempt #2/ }));
    expect(screen.getByRole('alertdialog', { name: '更换当前候选？' })).toHaveTextContent('前后候选身份都会留痕');
    expect(useExperimentStore.getState().ledger.studies.find(item => item.id === study.id)?.selectedAttemptId).toBe(config.attemptId);
    fireEvent.click(screen.getByRole('button', { name: '确认更换' }));
    expect(useExperimentStore.getState().ledger.studies.find(item => item.id === study.id)?.selectedAttemptId).toBe(replacement.attemptId);
    expect(useExperimentStore.getState().ledger.events.at(-1)?.eventType).toBe('candidate_replaced');

    fireEvent.click(screen.getByRole('button', { name: /当前候选.*点击撤回/ }));
    expect(screen.getByRole('alertdialog', { name: '撤回当前候选？' })).toHaveTextContent('不会删除');
    fireEvent.click(screen.getByRole('button', { name: '确认撤回' }));

    expect(useExperimentStore.getState().ledger.studies.find(item => item.id === study.id)?.selectedAttemptId).toBeNull();
    expect(useExperimentStore.getState().ledger.events.at(-1)?.eventType).toBe('candidate_selection_revoked');
  });
});
