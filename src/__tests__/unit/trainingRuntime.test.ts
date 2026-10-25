import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { usePredictCardsStore } from '@/stores/usePredictCardsStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import type { TrainConfig } from '@/types/training';
import type { Attempt } from '@/types/experiment';
import { createEmptyExperimentLedger } from '@/utils/experimentProtocol';
import { createStudyFromCurrentContext } from '@/studyRuntime';
import {
  handleTrainingErrorEvent,
  handleTrainingProgressEvent,
  pauseTrainingRun,
  resetTrainingRuntimeForTests,
  startTrainingRun,
  stopTrainingRun,
} from '@/trainingRuntime';

const baseConfig: TrainConfig = {
  epochs: 2,
  learningRate: 0.001,
  batchSize: 32,
  dataset: 'mnist',
  device: 'cpu',
  layers: [
    { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
    { type: 'Flatten', params: {} },
    { type: 'Linear', params: { inFeatures: 784, outFeatures: 10 } },
  ],
  inputShape: [1, 28, 28],
  modelId: 'model-original',
};

function beginNativeRun(runId = 'run-current') {
  useTrainingStore.getState().startTraining({ ...baseConfig, runId }, 'native');
  useTrainingStore.getState().markTrainingStarted(runId);
}

describe('training runtime truthfulness and run isolation', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetTrainingRuntimeForTests();
    useTrainingStore.setState({
      ...useTrainingStore.getInitialState(),
      history: [],
    });
    usePredictCardsStore.getState().clearCards();
    useExperimentStore.getState().resetLedgerForTests();
    useLayerStore.setState({
      ...useLayerStore.getInitialState(),
      totalParams: 7_850,
    });
    useDatasetStore.setState({
      ...useDatasetStore.getInitialState(),
      datasetType: 'mnist',
      datasetInfo: {
        name: 'MNIST snapshot',
        type: 'mnist',
        sampleCount: 60_000,
        classCount: 10,
      },
    });
    Object.defineProperty(window, '__TAURI_IPC__', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    resetTrainingRuntimeForTests();
    vi.useRealTimers();
  });

  it('ignores every stale event from a previous run', () => {
    beginNativeRun();

    expect(handleTrainingProgressEvent({
      runId: 'run-old',
      type: 'progress',
      epoch: 99,
      step: 99,
      loss: 0,
      accuracy: 1,
    })).toBe('ignored');
    expect(handleTrainingErrorEvent({
      runId: 'run-old',
      type: 'error',
      errorKind: 'crashed',
      message: 'old process crashed',
    })).toBe('ignored');

    const state = useTrainingStore.getState();
    expect(state.status).toBe('training');
    expect(state.currentEpoch).toBe(0);
    expect(state.error).toBeNull();
  });

  it('keeps stable backend error codes and actionable CSV cell locations in the monitor', () => {
    beginNativeRun();
    expect(handleTrainingErrorEvent({
      runId: 'run-current',
      type: 'error',
      errorKind: 'runtime',
      errorCode: 'CSV_INVALID_CELL',
      message: 'CSV 特征包含无效值',
      details: {
        totalErrors: 4,
        locations: [
          { row: 6, column: 'feature_b', reason: 'missing_value' },
          { row: 10, column: 'feature_c', reason: 'non_finite' },
        ],
      },
    })).toBe('error');
    expect(useTrainingStore.getState().error).toContain('[CSV_INVALID_CELL]');
    expect(useTrainingStore.getState().error).toContain('第 6 行 / feature_b / missing_value');
    expect(useTrainingStore.getState().error).toContain('另有 2 处');
  });

  it('accepts a valid legacy done event once but does not invent an image preprocessing contract', () => {
    beginNativeRun();
    handleTrainingProgressEvent({
      runId: 'run-current',
      type: 'progress',
      epoch: 1,
      step: 10,
      loss: 0.5,
      accuracy: 0.8,
    });

    // 用户在训练期间修改当前场景和数据集；结果必须仍对应启动时快照。
    useLayerStore.setState({ totalParams: 999_999 });
    useDatasetStore.setState({ datasetInfo: null, datasetType: null });

    expect(handleTrainingProgressEvent({
      runId: 'run-current',
      type: 'done',
      finalAccuracy: 0.91,
    })).toBe('done');
    expect(handleTrainingProgressEvent({
      runId: 'run-current',
      type: 'done',
      finalAccuracy: 0.99,
    })).toBe('ignored');

    const state = useTrainingStore.getState();
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({
      finalAccuracy: 0.91,
      totalParams: 7_850,
      dataset: 'MNIST snapshot',
      executionMode: 'native',
    });
    expect(usePredictCardsStore.getState().cards).toHaveLength(0);
  });

  it('records a successful run but creates no prediction card when per-model weights failed', () => {
    beginNativeRun();

    expect(handleTrainingProgressEvent({
      runId: 'run-current',
      type: 'done',
      finalAccuracy: 0.88,
      artifacts: {
        weights: true,
        fullModel: true,
        numpy: false,
        perModel: false,
      },
    })).toBe('done');

    const state = useTrainingStore.getState();
    expect(state.status).toBe('done');
    expect(state.artifacts).toEqual({
      weights: true,
      fullModel: true,
      numpy: false,
      perModel: false,
    });
    expect(state.history[0].artifacts?.perModel).toBe(false);
    expect(usePredictCardsStore.getState().cards).toHaveLength(0);
  });

  it('creates a regression prediction card with witnessed train-only preprocessing', () => {
    const runId = 'run-regression';
    const attemptId = 'attempt-regression';
    const regressionLayers: TrainConfig['layers'] = [
      { type: 'Input', params: { inChannels: 1, inputHeight: 1, inputWidth: 2 } },
      { type: 'Flatten', params: {} },
      { type: 'Linear', params: { inFeatures: 2, outFeatures: 1 } },
    ];
    const ledger = createEmptyExperimentLedger();
    ledger.attempts = [{
      id: attemptId,
      provenance: {
        preprocessingParameters: {
          algorithm: 'standard-scaler-fit-train-only-v1',
          featureColumns: ['age', 'income'],
          mean: [30, 100],
          std: [5, 20],
        },
      },
    } as Attempt];
    useExperimentStore.setState({ ledger });
    useTrainingStore.getState().startTraining({
      ...baseConfig,
      dataset: 'csv',
      runId,
      attemptId,
      modelId: 'model-regression',
      inputShape: [1, 1, 2],
      layers: regressionLayers,
    }, 'native');
    useTrainingStore.getState().markTrainingStarted(runId);
    expect(handleTrainingProgressEvent({
      runId,
      type: 'progress',
      epoch: 1,
      step: 1,
      loss: 4,
      metricName: 'mae',
      metricValue: 1.75,
      accuracy: 1.75,
    })).toBe('metric');
    useTrainingStore.getState().finishTraining(1.5, 'mae', runId, {
      weights: true,
      fullModel: true,
      numpy: true,
      perModel: true,
    });

    const state = useTrainingStore.getState();
    expect(state.finalMetricName).toBe('mae');
    expect(state.finalAccuracy).toBe(1.5);
    expect(state.history[0]).toMatchObject({ finalMetricName: 'mae', finalAccuracy: 1.5 });
    expect(usePredictCardsStore.getState().cards).toHaveLength(1);
    expect(usePredictCardsStore.getState().cards[0]).toMatchObject({
      id: 'model-regression',
      taskType: 'tabular_regression',
      finalMetricName: 'mae',
      finalAccuracy: 1.5,
      featureColumns: ['age', 'income'],
      preprocessing: { mean: [30, 100], std: [5, 20] },
    });
  });

  it('rejects a tampered prediction card whose model id escapes the model directory', () => {
    usePredictCardsStore.getState().addCard({
      id: '../outside',
      name: 'tampered',
      modelType: 'MLP',
      layers: baseConfig.layers,
      inputShape: [1, 28, 28],
      finalAccuracy: 0.9,
      dataset: 'MNIST',
      epochs: 1,
      timestamp: Date.now(),
    });

    expect(usePredictCardsStore.getState().cards).toHaveLength(0);
  });

  it('rejects malformed completion data instead of fabricating a zero result', () => {
    beginNativeRun();

    expect(handleTrainingProgressEvent({
      runId: 'run-current',
      type: 'done',
      finalAccuracy: 'not-a-number',
    })).toBe('error');

    const state = useTrainingStore.getState();
    expect(state.status).toBe('error');
    expect(state.errorKind).toBe('runtime');
    expect(state.history).toHaveLength(0);
    expect(usePredictCardsStore.getState().cards).toHaveLength(0);
  });

  it('rejects out-of-range progress and never persists poisoned metrics', () => {
    beginNativeRun();

    expect(handleTrainingProgressEvent({
      runId: 'run-current',
      type: 'progress',
      epoch: 1,
      step: 10,
      loss: -1,
      accuracy: 1.5,
    })).toBe('error');

    const state = useTrainingStore.getState();
    expect(state.status).toBe('error');
    expect(state.metrics).toHaveLength(0);
    expect(state.history).toHaveLength(0);
  });

  it('keeps the accumulated step when epoch_end omits step', () => {
    beginNativeRun();
    handleTrainingProgressEvent({
      runId: 'run-current',
      type: 'progress',
      epoch: 1,
      step: 20,
      loss: 0.5,
      accuracy: 0.7,
    });

    expect(handleTrainingProgressEvent({
      runId: 'run-current',
      type: 'epoch_end',
      epoch: 1,
      trainLoss: 0.4,
      valAccuracy: 0.8,
    })).toBe('metric');
    expect(useTrainingStore.getState().currentStep).toBe(20);
  });

  it('refuses to reset an active process and keeps completed logs exportable after closing', () => {
    beginNativeRun();
    useTrainingStore.getState().addLog('info', 'exportable completion log', 'run-current');
    useTrainingStore.getState().resetTraining();
    expect(useTrainingStore.getState()).toMatchObject({
      activeRunId: 'run-current',
      isTraining: true,
      status: 'training',
    });

    handleTrainingProgressEvent({
      runId: 'run-current',
      type: 'done',
      finalAccuracy: 0.9,
    });
    useTrainingStore.getState().resetTraining();
    expect(useTrainingStore.getState()).toMatchObject({
      activeRunId: null,
      isTraining: false,
      status: 'idle',
      finalAccuracy: null,
      executionMode: null,
    });
    expect(useTrainingStore.getState().logs.map(log => log.message)).toEqual(['exportable completion log']);
  });

  it('labels browser simulation and never creates a prediction card', async () => {
    vi.useFakeTimers();

    expect(await startTrainingRun({ ...baseConfig, epochs: 1 })).toBe(true);
    expect(useTrainingStore.getState().executionMode).toBe('simulation');
    expect(useTrainingStore.getState().logs[0].message).toContain('模拟数据');

    await vi.advanceTimersByTimeAsync(800);

    const state = useTrainingStore.getState();
    expect(state.status).toBe('done');
    expect(state.history[0].executionMode).toBe('simulation');
    expect(usePredictCardsStore.getState().cards).toHaveLength(0);
  });

  it('preserves partial metrics when a simulation is paused and cancelled', async () => {
    vi.useFakeTimers();
    expect(await startTrainingRun({ ...baseConfig, epochs: 5 })).toBe(true);
    await vi.advanceTimersByTimeAsync(800);

    expect(await pauseTrainingRun()).toBe(true);
    let attempt = useExperimentStore.getState().ledger.attempts[0];
    expect(attempt.status).toBe('paused');
    expect(attempt.metrics).toHaveLength(1);

    expect(await stopTrainingRun()).toBe(true);
    const state = useTrainingStore.getState();
    attempt = useExperimentStore.getState().ledger.attempts[0];
    expect(state.status).toBe('cancelled');
    expect(state.metrics).toHaveLength(1);
    expect(attempt.status).toBe('cancelled');
    expect(attempt.metrics).toHaveLength(1);
    expect(useExperimentStore.getState().ledger.events.some(event => (
      event.entityId === attempt.id && event.eventType === 'attempt_partial_metrics_recorded'
    ))).toBe(true);
  });

  it('treats native invoke failure as startup failure and never starts simulation', async () => {
    Object.defineProperty(window, '__TAURI_IPC__', {
      value: () => { throw new Error('sidecar missing'); },
      writable: true,
      configurable: true,
    });

    expect(await startTrainingRun(baseConfig)).toBe(false);

    const state = useTrainingStore.getState();
    expect(state.executionMode).toBe('native');
    expect(state.status).toBe('error');
    expect(state.errorKind).toBe('startup');
    expect(state.error).toContain('sidecar missing');
    expect(state.history).toHaveLength(0);
  });

  it('publishes Study protocol rejection to the training monitor as a preflight error', async () => {
    const study = await createStudyFromCurrentContext({
      name: '预算阻断', question: '预算用尽后不得启动', kind: 'candidate_selection', maxExperiments: 2,
    });
    useExperimentStore.getState().registerStudy({
      ...study,
      budget: { ...study.budget, maxGpuMinutes: 0 },
    });

    expect(await startTrainingRun(baseConfig)).toBe(false);
    expect(useTrainingStore.getState()).toMatchObject({
      status: 'error',
      errorKind: 'preflight',
    });
    expect(useTrainingStore.getState().error).toContain('Study');
    expect(useExperimentStore.getState().ledger.attempts).toHaveLength(0);
  });

  it('resets split fields when switching datasets so stale contracts cannot leak', () => {
    useDatasetStore.setState({
      splitStrategy: 'group',
      groupField: 'customer_id',
      timeField: 'captured_at',
    });

    useDatasetStore.getState().setDataset({
      name: 'nested-images',
      type: 'local_image',
      sampleCount: 400,
      classCount: 2,
    }, 'D:/dataset');

    expect(useDatasetStore.getState()).toMatchObject({
      splitStrategy: 'random',
      groupField: null,
      timeField: null,
    });
  });
});
