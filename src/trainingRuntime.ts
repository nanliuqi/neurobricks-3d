import { useTrainingStore, type TrainingRunSnapshot } from '@/stores/useTrainingStore';
import type {
  TrainConfig,
  TrainMetric,
  TrainingArtifacts,
  TrainingCompletionProvenance,
  TrainingErrorKind,
  TrainingExecutionMode,
} from '@/types/training';
import {
  checkpointRuntimeAttemptMetrics,
  finishRuntimeAttempt,
  prepareTrainingAttempt,
  terminateRuntimeAttempt,
  transitionRuntimeAttempt,
} from '@/experimentRuntime';

type RuntimeWindow = Window & { __TAURI_IPC__?: unknown };

interface SimulationJob {
  runId: string;
  timer: ReturnType<typeof setInterval>;
}

const NO_TRAINING_ARTIFACTS: TrainingArtifacts = {
  weights: false,
  fullModel: false,
  numpy: false,
  perModel: false,
};

let simulationJob: SimulationJob | null = null;
let nativeEventBridgePromise: Promise<void> | null = null;
let nativeEventUnlisteners: Array<() => void> = [];

export type TrainingRuntimeEventSubscriber = (result: TrainingEventResult) => void;
const runtimeEventSubscribers = new Set<TrainingRuntimeEventSubscriber>();

function createRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tauri v1 注入 __TAURI_IPC__。只以这个明确能力判断原生环境：
 * 动态 import 失败或 invoke 失败都属于桌面端故障，绝不能降级为假训练。
 */
export function isNativeTrainingRuntime(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as RuntimeWindow).__TAURI_IPC__ === 'function';
}

function clearSimulation(runId?: string): void {
  if (!simulationJob || (runId && simulationJob.runId !== runId)) return;
  clearInterval(simulationJob.timer);
  simulationJob = null;
}

function notifyRuntimeEvent(result: TrainingEventResult): void {
  runtimeEventSubscribers.forEach(subscriber => {
    try {
      subscriber(result);
    } catch (error) {
      console.error('Training runtime subscriber failed:', error);
    }
  });
}

/**
 * 原生事件桥是进程级单例，并在启动 sidecar 前完成注册，避免极短训练在 React effect
 * 尚未装好监听器时丢失 done/error，令界面永久停在 training。
 */
export async function ensureTrainingEventBridge(): Promise<void> {
  if (!isNativeTrainingRuntime()) return;
  if (nativeEventBridgePromise) return nativeEventBridgePromise;

  nativeEventBridgePromise = (async () => {
    const { listen } = await import('@tauri-apps/api/event');
    const progressUnlisten = await listen<unknown>('training-progress', event => {
      notifyRuntimeEvent(handleTrainingProgressEvent(event.payload));
    });
    try {
      const errorUnlisten = await listen<unknown>('training-error', event => {
        notifyRuntimeEvent(handleTrainingErrorEvent(event.payload));
      });
      nativeEventUnlisteners = [progressUnlisten, errorUnlisten];
    } catch (error) {
      progressUnlisten();
      throw error;
    }
  })().catch(error => {
    nativeEventBridgePromise = null;
    throw error;
  });

  return nativeEventBridgePromise;
}

export function subscribeTrainingRuntimeEvents(subscriber: TrainingRuntimeEventSubscriber): () => void {
  runtimeEventSubscribers.add(subscriber);
  return () => runtimeEventSubscribers.delete(subscriber);
}

function disposeTrainingEventBridge(): void {
  nativeEventUnlisteners.forEach(unlisten => unlisten());
  nativeEventUnlisteners = [];
  nativeEventBridgePromise = null;
}

function startSimulation(config: TrainConfig & { runId: string }): void {
  clearSimulation();
  const runId = config.runId;
  const totalEpochs = config.epochs;
  let epoch = 0;

  useTrainingStore.getState().markTrainingStarted(runId);
  transitionRuntimeAttempt(config.attemptId, 'running');
  useTrainingStore.getState().addLog(
    'warn',
    '浏览器演示模式：以下 Loss/Accuracy 为模拟数据，不会生成模型或权重。',
    runId,
  );

  const timer = setInterval(() => {
    const state = useTrainingStore.getState();
    if (state.activeRunId !== runId || !state.isTraining) {
      clearSimulation(runId);
      return;
    }
    if (state.isPaused || state.status === 'stopping') return;

    epoch += 1;
    const loss = Math.max(0.01, 2 * Math.exp(-epoch * 0.3) + Math.random() * 0.1);
    const accuracy = Math.min(0.99, 0.3 + 0.6 * (1 - Math.exp(-epoch * 0.3)) + Math.random() * 0.05);
    const metric: TrainMetric = {
      recordId: `${runId}:simulation:${epoch}`,
      epoch,
      step: epoch * 10,
      globalStep: epoch * 10,
      split: 'validation',
      scope: 'epoch',
      loss,
      lossName: 'cross_entropy',
      lossValue: loss,
      accuracy,
      metricName: 'accuracy',
      metricValue: accuracy,
      optimizationDirection: 'maximize',
      timestamp: Date.now(),
    };
    state.updateProgress(metric, runId);

    if (epoch >= totalEpochs) {
      clearSimulation(runId);
      finishRuntimeAttempt(
        config.attemptId,
        useTrainingStore.getState().metrics,
        NO_TRAINING_ARTIFACTS,
        {
          attemptId: config.attemptId ?? null,
          modelWeightsHash: null,
          environment: {
            applicationVersion: '0.1.0',
            torchVersion: '',
            pythonVersion: '',
            device: 'browser-simulation',
            cudaVersion: null,
          },
        },
      );
      useTrainingStore.getState().finishTraining(accuracy, 'accuracy', runId, NO_TRAINING_ARTIFACTS);
    }
  }, 800);

  simulationJob = { runId, timer };
}

export async function startTrainingRun(
  config: TrainConfig,
  snapshotOverride?: TrainingRunSnapshot,
): Promise<boolean> {
  const before = useTrainingStore.getState();
  if (before.isTraining || before.activeRunId) return false;

  const initialRunConfig: TrainConfig & { runId: string } = {
    ...config,
    runId: createRunId(),
    modelId: config.modelId ?? createRunId(),
  };
  const mode: TrainingExecutionMode = isNativeTrainingRuntime() ? 'native' : 'simulation';
  let runConfig: TrainConfig & { runId: string; attemptId: string; experimentId: string; studyId: string };
  try {
    runConfig = await prepareTrainingAttempt(initialRunConfig, mode);
  } catch (error) {
    console.error('Failed to prepare trusted attempt:', error);
    useTrainingStore.getState().setPreflightError(errorMessage(error));
    return false;
  }
  useTrainingStore.getState().startTraining(runConfig, mode, snapshotOverride);

  if (mode === 'simulation') {
    startSimulation(runConfig);
    return true;
  }

  try {
    // 必须先确认终态事件不会丢，再启动可能很快结束的训练进程。
    await ensureTrainingEventBridge();
    const { invoke } = await import('@tauri-apps/api/tauri');
    await invoke('start_training', { config: runConfig });
    transitionRuntimeAttempt(runConfig.attemptId, 'running');
    useTrainingStore.getState().markTrainingStarted(runConfig.runId);
    return true;
  } catch (error) {
    terminateRuntimeAttempt(
      runConfig.attemptId,
      'failed',
      useTrainingStore.getState().metrics,
      `训练进程启动失败：${errorMessage(error)}`,
    );
    useTrainingStore.getState().setError(
      `训练进程启动失败：${errorMessage(error)}`,
      'startup',
      runConfig.runId,
    );
    return false;
  }
}

export async function restartLastTrainingRun(): Promise<boolean> {
  const state = useTrainingStore.getState();
  if (!state.lastTrainConfig || !state.lastRunSnapshot) return false;
  const config: TrainConfig = {
    ...state.lastTrainConfig,
    runId: undefined,
    attemptId: undefined,
    parentAttemptId: state.lastAttemptId ?? undefined,
    restartCount: state.lastRestartCount + 1,
    resumeType: 'fresh',
    modelId: createRunId(),
  };
  return startTrainingRun(config, state.lastRunSnapshot);
}

export async function stopTrainingRun(): Promise<boolean> {
  const state = useTrainingStore.getState();
  const runId = state.activeRunId;
  if (!runId) return true;

  state.markStopping(runId);
  if (state.executionMode === 'simulation') {
    clearSimulation(runId);
    terminateRuntimeAttempt(state.activeAttemptId ?? undefined, 'cancelled', state.metrics, '用户停止训练');
    useTrainingStore.getState().cancelTraining(runId);
    return true;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    await invoke('stop_training', { runId });
    const stoppedState = useTrainingStore.getState();
    terminateRuntimeAttempt(stoppedState.activeAttemptId ?? undefined, 'cancelled', stoppedState.metrics, '用户停止训练');
    useTrainingStore.getState().cancelTraining(runId);
    return true;
  } catch (error) {
    useTrainingStore.getState().setControlError(
      `停止训练失败，进程状态未知：${errorMessage(error)}。请重试停止；若仍失败，请关闭应用以强制清理训练进程。`,
      runId,
    );
    return false;
  }
}

export async function pauseTrainingRun(): Promise<boolean> {
  const state = useTrainingStore.getState();
  const runId = state.activeRunId;
  if (!runId || !state.isTraining || state.isPaused) return false;

  if (state.executionMode === 'simulation') {
    checkpointRuntimeAttemptMetrics(state.activeAttemptId ?? undefined, state.metrics);
    transitionRuntimeAttempt(state.activeAttemptId ?? undefined, 'paused');
    state.pauseTraining(runId);
    return true;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    await invoke('pause_training', { runId });
    const latestState = useTrainingStore.getState();
    checkpointRuntimeAttemptMetrics(latestState.activeAttemptId ?? undefined, latestState.metrics);
    transitionRuntimeAttempt(latestState.activeAttemptId ?? undefined, 'paused');
    latestState.pauseTraining(runId);
    return true;
  } catch (error) {
    useTrainingStore.getState().setControlError(`暂停训练失败：${errorMessage(error)}`, runId);
    return false;
  }
}

export async function resumeTrainingRun(): Promise<boolean> {
  const state = useTrainingStore.getState();
  const runId = state.activeRunId;
  if (!runId || !state.isTraining || !state.isPaused) return false;

  if (state.executionMode === 'simulation') {
    transitionRuntimeAttempt(state.activeAttemptId ?? undefined, 'running');
    state.resumeTraining(runId);
    return true;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    await invoke('step_training', { runId });
    transitionRuntimeAttempt(state.activeAttemptId ?? undefined, 'running');
    useTrainingStore.getState().resumeTraining(runId);
    return true;
  } catch (error) {
    useTrainingStore.getState().setControlError(`恢复训练失败：${errorMessage(error)}`, runId);
    return false;
  }
}

function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload !== null && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseTrainingArtifacts(value: unknown): TrainingArtifacts | null {
  // 兼容尚未携带 artifacts 的旧 sidecar；新 sidecar 必须逐项回传真正的保存结果。
  if (value === undefined) {
    return { weights: true, fullModel: true, numpy: true, perModel: true };
  }
  const artifacts = asRecord(value);
  if (!artifacts) return null;
  const keys: Array<keyof TrainingArtifacts> = ['weights', 'fullModel', 'numpy', 'perModel'];
  if (!keys.every(key => typeof artifacts[key] === 'boolean')) return null;
  return {
    weights: artifacts.weights as boolean,
    fullModel: artifacts.fullModel as boolean,
    numpy: artifacts.numpy as boolean,
    perModel: artifacts.perModel as boolean,
  };
}

function isLabelCountRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([key, count]) => (
    key.length > 0 && typeof count === 'number' && Number.isInteger(count) && count >= 0
  ));
}

function parseCompletionProvenance(
  value: unknown,
  attemptId: string | null,
): TrainingCompletionProvenance | null {
  // 旧 sidecar 没有 provenance：允许结果留档，但字段缺失使其只能保持 unverified。
  if (value === undefined) {
    return {
      attemptId,
      modelWeightsHash: null,
      environment: {
        applicationVersion: '0.1.0',
        torchVersion: '',
        pythonVersion: '',
        device: '',
        cudaVersion: null,
      },
    };
  }
  const provenance = asRecord(value);
  const environment = asRecord(provenance?.environment);
  if (!provenance || !environment) return null;
  const payloadAttemptId = provenance.attemptId;
  const modelWeightsHash = provenance.modelWeightsHash;
  const datasetContentHash = provenance.datasetContentHash;
  const splitPolicyHash = provenance.splitPolicyHash;
  const splitAssignmentHash = provenance.splitAssignmentHash;
  const preprocessingPolicyHash = provenance.preprocessingPolicyHash;
  const fittedPreprocessingHash = provenance.fittedPreprocessingHash;
  const artifactsVerified = provenance.artifactsVerified;
  const splitHash = provenance.splitHash;
  const preprocessingHash = provenance.preprocessingHash;
  const preprocessingParameters = provenance.preprocessingParameters;
  const testSetHash = provenance.testSetHash;
  const testSampleCount = provenance.testSampleCount;
  const splitSampleCounts = asRecord(provenance.splitSampleCounts);
  const testLabelCounts = provenance.testLabelCounts;
  const testTargetSummary = provenance.testTargetSummary;
  const testTargetSummaryRecord = asRecord(testTargetSummary);
  const machineChecks = provenance.machineChecks;
  if (
    !(payloadAttemptId === null || typeof payloadAttemptId === 'string')
    || !(modelWeightsHash === null || typeof modelWeightsHash === 'string')
    || !(datasetContentHash === undefined || datasetContentHash === null || typeof datasetContentHash === 'string')
    || !(splitPolicyHash === undefined || splitPolicyHash === null || typeof splitPolicyHash === 'string')
    || !(splitAssignmentHash === undefined || splitAssignmentHash === null || typeof splitAssignmentHash === 'string')
    || !(preprocessingPolicyHash === undefined || preprocessingPolicyHash === null || typeof preprocessingPolicyHash === 'string')
    || !(fittedPreprocessingHash === undefined || fittedPreprocessingHash === null || typeof fittedPreprocessingHash === 'string')
    || !(artifactsVerified === undefined || typeof artifactsVerified === 'boolean')
    || !(splitHash === undefined || splitHash === null || typeof splitHash === 'string')
    || !(preprocessingHash === undefined || preprocessingHash === null || typeof preprocessingHash === 'string')
    || !(preprocessingParameters === undefined || preprocessingParameters === null || asRecord(preprocessingParameters))
    || !(testSetHash === undefined || testSetHash === null || typeof testSetHash === 'string')
    || !(testSampleCount === undefined || testSampleCount === null || (typeof testSampleCount === 'number' && Number.isInteger(testSampleCount) && testSampleCount >= 0))
    || !(provenance.splitSampleCounts === undefined || provenance.splitSampleCounts === null || (
      splitSampleCounts
      && ['train', 'validation', 'test'].every(key => (
        typeof splitSampleCounts[key] === 'number'
        && Number.isInteger(splitSampleCounts[key])
        && (splitSampleCounts[key] as number) >= 0
      ))
    ))
    || !(testLabelCounts === undefined || testLabelCounts === null || isLabelCountRecord(testLabelCounts))
    || !(testTargetSummary === undefined || testTargetSummary === null || (
      testTargetSummaryRecord
      && Number.isInteger(testTargetSummaryRecord.count) && (testTargetSummaryRecord.count as number) > 0
      && ['mean', 'variance', 'min', 'max'].every(key => typeof testTargetSummaryRecord[key] === 'number' && Number.isFinite(testTargetSummaryRecord[key]))
      && (testTargetSummaryRecord.variance as number) >= 0
      && (testTargetSummaryRecord.min as number) <= (testTargetSummaryRecord.max as number)
    ))
    || !(machineChecks === undefined || Array.isArray(machineChecks))
    || typeof environment.torchVersion !== 'string'
    || typeof environment.pythonVersion !== 'string'
    || typeof environment.device !== 'string'
    || !(environment.cudaVersion === null || typeof environment.cudaVersion === 'string')
  ) return null;
  if (payloadAttemptId !== null && attemptId !== null && payloadAttemptId !== attemptId) return null;
  return {
    attemptId: payloadAttemptId as string | null,
    modelWeightsHash: modelWeightsHash as string | null,
    datasetContentHash: datasetContentHash as string | null | undefined,
    splitPolicyHash: splitPolicyHash as string | null | undefined,
    splitAssignmentHash: splitAssignmentHash as string | null | undefined,
    preprocessingPolicyHash: preprocessingPolicyHash as string | null | undefined,
    fittedPreprocessingHash: fittedPreprocessingHash as string | null | undefined,
    artifactsVerified: artifactsVerified as boolean | undefined,
    splitHash: splitHash as string | null | undefined,
    preprocessingHash: preprocessingHash as string | null | undefined,
    preprocessingParameters: preprocessingParameters as Record<string, unknown> | null | undefined,
    testSetHash: testSetHash as string | null | undefined,
    testSampleCount: testSampleCount as number | null | undefined,
    splitSampleCounts: splitSampleCounts as TrainingCompletionProvenance['splitSampleCounts'],
    testLabelCounts: testLabelCounts as Record<string, number> | null | undefined,
    testTargetSummary: testTargetSummary as TrainingCompletionProvenance['testTargetSummary'],
    machineChecks: machineChecks as TrainingCompletionProvenance['machineChecks'],
    environment: {
      applicationVersion: typeof environment.applicationVersion === 'string'
        ? environment.applicationVersion
        : '0.1.0',
      torchVersion: environment.torchVersion,
      pythonVersion: environment.pythonVersion,
      device: environment.device,
      cudaVersion: environment.cudaVersion as string | null,
    },
  };
}

function activeRunPayload(payload: unknown): Record<string, unknown> | null {
  const data = asRecord(payload);
  if (!data || typeof data.runId !== 'string') return null;
  return useTrainingStore.getState().activeRunId === data.runId ? data : null;
}

function failProtocolAndTerminate(runId: string, message: string): void {
  const state = useTrainingStore.getState();
  terminateRuntimeAttempt(state.activeAttemptId ?? undefined, 'failed', state.metrics, message);
  if (state.executionMode === 'native' && isNativeTrainingRuntime()) {
    // UI 立即进入错误态，但仍用捕获到的 runId 直接请求后端清理，避免无效协议下
    // sidecar 继续静默占用 GPU。清理失败由应用退出兜底。
    void import('@tauri-apps/api/tauri')
      .then(({ invoke }) => invoke('stop_training', { runId }))
      .catch(error => console.error('Failed to stop trainer after protocol error:', error));
  } else {
    clearSimulation(runId);
  }
  state.setError(message, 'runtime', runId);
}

export type TrainingEventResult = 'ignored' | 'log' | 'metric' | 'done' | 'error';

/** 处理 Rust 转发的 sidecar 消息。返回值用于调用方决定是否同步曲线窗口。 */
export function handleTrainingProgressEvent(payload: unknown): TrainingEventResult {
  const data = activeRunPayload(payload);
  if (!data) return 'ignored';
  const runId = data.runId as string;
  const type = data.type;
  const store = useTrainingStore.getState();

  if (type === 'log') {
    const message = typeof data.message === 'string' ? data.message : '';
    const level = data.level === 'error' ? 'error' : data.level === 'warning' || data.level === 'warn' ? 'warn' : 'info';
    store.addLog(level, message, runId);
    return 'log';
  }

  if (type === 'progress' || type === 'epoch_end') {
    const epoch = finiteNumber(data.epoch);
    const payloadStep = finiteNumber(data.step);
    // epoch_end 协议不携带 step，必须保留累计步数；不能在每轮结束时把 UI 重置为 0。
    const step = payloadStep ?? (type === 'epoch_end' ? store.currentStep : null);
    const loss = finiteNumber(data.lossValue ?? (type === 'progress'
      ? data.loss
      : (data.valLoss ?? data.val_loss ?? data.trainLoss ?? data.train_loss)));
    const metricNameValue = data.metricName ?? (type === 'progress' ? data.metricName : data.valMetricName);
    const metricName = metricNameValue === 'mae' ? 'mae' : 'accuracy';
    const accuracy = finiteNumber(type === 'progress'
      ? (data.metricValue ?? data.accuracy)
      : (data.valMetric ?? data.valAccuracy ?? data.val_accuracy));
    if (
      epoch === null || !Number.isInteger(epoch) || epoch < 1 ||
      step === null || !Number.isInteger(step) || step < 0 ||
      loss === null || loss < 0 ||
      accuracy === null || accuracy < 0 || (metricName === 'accuracy' && accuracy > 1)
    ) {
      failProtocolAndTerminate(runId, '训练后端返回了无效的进度数据，已终止本次训练且不会保存结果。');
      return 'error';
    }
    const split = data.split === 'train' || data.split === 'validation'
      ? data.split
      : type === 'progress' ? 'train' : 'validation';
    const scope = data.scope === 'batch' || data.scope === 'epoch'
      ? data.scope
      : type === 'progress' ? 'batch' : 'epoch';
    const sampleCount = finiteNumber(data.sampleCount);
    const timestamp = finiteNumber(data.timestamp) ?? Date.now();
    const recordId = typeof data.recordId === 'string' && data.recordId.trim()
      ? data.recordId
      : `${store.activeAttemptId ?? runId}:${split}:${epoch}:${step}`;
    store.updateProgress({
      recordId,
      epoch,
      step,
      globalStep: step,
      split,
      scope,
      loss,
      lossName: data.lossName === 'mse' || metricName === 'mae' ? 'mse' : 'cross_entropy',
      lossValue: loss,
      accuracy,
      metricName,
      metricValue: accuracy,
      optimizationDirection: metricName === 'mae' ? 'minimize' : 'maximize',
      sampleCount: sampleCount !== null && Number.isInteger(sampleCount) && sampleCount >= 0 ? sampleCount : undefined,
      timestamp,
    }, runId);
    return 'metric';
  }

  if (type === 'done') {
    const finalMetricName = data.finalMetricName === 'mae' ? 'mae' : 'accuracy';
    const accuracy = finiteNumber(data.finalMetric ?? data.finalAccuracy ?? data.final_accuracy);
    const artifacts = parseTrainingArtifacts(data.artifacts);
    const completion = parseCompletionProvenance(data.provenance, store.activeAttemptId);
    if (accuracy === null || accuracy < 0 || (finalMetricName === 'accuracy' && accuracy > 1) || artifacts === null || completion === null) {
      failProtocolAndTerminate(runId, '训练后端返回了无效的完成结果，已终止本次训练且未生成训练记录或推理模型。');
      return 'error';
    }
    finishRuntimeAttempt(store.activeAttemptId ?? undefined, store.metrics, artifacts, completion);
    store.finishTraining(accuracy, finalMetricName, runId, artifacts);
    return 'done';
  }

  return 'ignored';
}

export function handleTrainingErrorEvent(payload: unknown): TrainingEventResult {
  const data = activeRunPayload(payload);
  if (!data) return 'ignored';
  const runId = data.runId as string;
  const allowedKinds: TrainingErrorKind[] = ['startup', 'runtime', 'crashed', 'hung', 'control'];
  const kind = allowedKinds.includes(data.errorKind as TrainingErrorKind)
    ? data.errorKind as TrainingErrorKind
    : 'runtime';
  const baseMessage = typeof data.message === 'string' && data.message.trim()
    ? data.message
    : '训练进程报告了未知错误';
  const errorCode = typeof data.errorCode === 'string' && data.errorCode.trim() ? data.errorCode : null;
  const details = asRecord(data.details);
  const locations = Array.isArray(details?.locations) ? details.locations : [];
  const locationText = locations.slice(0, 3).map(value => {
    const location = asRecord(value);
    if (!location) return null;
    const row = finiteNumber(location.row);
    const column = typeof location.column === 'string' ? location.column : '?';
    const reason = typeof location.reason === 'string' ? location.reason : 'invalid';
    return row !== null ? `第 ${row} 行 / ${column} / ${reason}` : null;
  }).filter((value): value is string => Boolean(value));
  const totalErrors = finiteNumber(details?.totalErrors);
  const message = [
    errorCode ? `[${errorCode}] ${baseMessage}` : baseMessage,
    locationText.length > 0
      ? `问题位置：${locationText.join('；')}${totalErrors !== null && totalErrors > locationText.length ? `；另有 ${totalErrors - locationText.length} 处` : ''}`
      : null,
  ].filter(Boolean).join('\n');
  terminateRuntimeAttempt(
    useTrainingStore.getState().activeAttemptId ?? undefined,
    kind === 'crashed' || kind === 'hung' ? 'interrupted' : 'failed',
    useTrainingStore.getState().metrics,
    message,
  );
  useTrainingStore.getState().setError(message, kind, runId);
  return 'error';
}

/** 仅供测试清理模块级计时器。 */
export function resetTrainingRuntimeForTests(): void {
  clearSimulation();
  disposeTrainingEventBridge();
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeTrainingEventBridge);
}
