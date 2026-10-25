import { create } from 'zustand';
import type {
  TrainConfig,
  TrainMetric,
  TrainStatus,
  LogEntry,
  TrainRecord,
  TrainingErrorKind,
  TrainingExecutionMode,
  TrainingArtifacts,
  TrainingMetricName,
} from '@/types/training';
import type { LayerType, LayerParams } from '@/types/layer';
import { useLayerStore } from './useLayerStore';
import { useDatasetStore } from './useDatasetStore';
import { usePredictCardsStore, inferModelType } from './usePredictCardsStore';
import { useExperimentStore } from './useExperimentStore';

export interface TrainingRunSnapshot {
  networkSummary: string;
  totalParams: number;
  datasetName: string;
  modelId: string | null;
  layers: Array<{ type: LayerType; params: LayerParams }>;
  inputShape: number[] | null;
  executionMode: TrainingExecutionMode;
}

interface TrainingState {
  isTraining: boolean;
  isPaused: boolean;
  status: TrainStatus;
  currentEpoch: number;
  totalEpochs: number;
  currentStep: number;
  currentLoss: number;
  currentAccuracy: number;
  currentMetricName: TrainingMetricName;
  finalAccuracy: number | null;
  finalMetricName: TrainingMetricName | null;
  metrics: TrainMetric[];
  logs: LogEntry[];
  history: TrainRecord[];
  error: string | null;
  trainStartTime: number | null;
  /** 当前运行标识。所有进度/完成/错误事件必须匹配它。 */
  activeRunId: string | null;
  activeAttemptId: string | null;
  lastAttemptId: string | null;
  lastRestartCount: number;
  /** 当前运行是真实 sidecar 还是浏览器演示。 */
  executionMode: TrainingExecutionMode | null;
  /** 训练启动瞬间的不可变业务快照，完成报告只允许读取这里。 */
  currentRunSnapshot: TrainingRunSnapshot | null;
  /** 崩溃/挂起时的完整训练配置（“重新开始训练”用同一 config 重启） */
  lastTrainConfig: TrainConfig | null;
  /** 上一次启动所使用的快照，重试时复用，避免读取已被修改的场景。 */
  lastRunSnapshot: TrainingRunSnapshot | null;
  errorKind: TrainingErrorKind | null;
  /** 最近一次完成运行实际保存成功的产物。 */
  artifacts: TrainingArtifacts | null;
}

interface TrainingActions {
  startTraining: (
    config: TrainConfig,
    mode: TrainingExecutionMode,
    snapshotOverride?: TrainingRunSnapshot,
  ) => void;
  markTrainingStarted: (runId: string) => void;
  updateProgress: (metric: TrainMetric, runId: string) => void;
  finishTraining: (value: number, metricName: TrainingMetricName, runId: string, artifacts: TrainingArtifacts) => void;
  setError: (message: string, kind: TrainingErrorKind, runId: string) => void;
  /** 尚未创建 run 时的校验/Study 协议错误，也必须在训练监控中可见。 */
  setPreflightError: (message: string) => void;
  setControlError: (message: string, runId: string) => void;
  clearError: () => void;
  markStopping: (runId: string) => void;
  cancelTraining: (runId: string) => void;
  resetTraining: () => void;
  pauseTraining: (runId: string) => void;
  resumeTraining: (runId: string) => void;
  addLog: (level: 'info' | 'warn' | 'error', message: string, runId: string) => void;
}

function copyLayers(config: TrainConfig): Array<{ type: LayerType; params: LayerParams }> {
  return config.layers.map(layer => ({ type: layer.type, params: { ...layer.params } }));
}

function makeRunSnapshot(config: TrainConfig, mode: TrainingExecutionMode): TrainingRunSnapshot {
  const layers = copyLayers(config);
  const layerState = useLayerStore.getState();
  const datasetState = useDatasetStore.getState();
  return {
    networkSummary: layers.map(layer => layer.type).slice(0, 8).join(' → ') || '未命名网络',
    totalParams: layerState.totalParams,
    datasetName: datasetState.datasetInfo?.name ?? config.dataset,
    modelId: config.modelId ?? null,
    layers,
    inputShape: config.inputShape ? [...config.inputShape] : null,
    executionMode: mode,
  };
}

export const useTrainingStore = create<TrainingState & TrainingActions>()((set) => ({
  // 初始状态
  isTraining: false,
  isPaused: false,
  status: 'idle',
  currentEpoch: 0,
  totalEpochs: 0,
  currentStep: 0,
  currentLoss: 0,
  currentAccuracy: 0,
  currentMetricName: 'accuracy',
  finalAccuracy: null,
  finalMetricName: null,
  metrics: [],
  logs: [],
  history: [],
  error: null,
  trainStartTime: null,
  activeRunId: null,
  activeAttemptId: null,
  lastAttemptId: null,
  lastRestartCount: 0,
  executionMode: null,
  currentRunSnapshot: null,
  lastTrainConfig: null,
  lastRunSnapshot: null,
  errorKind: null,
  artifacts: null,

  // 开始训练：这里只建立运行快照；后端 invoke 成功后再进入 training 状态。
  startTraining: (config, mode, snapshotOverride) => {
    if (!config.runId) {
      throw new Error('训练配置缺少 runId');
    }
    const snapshot = snapshotOverride
      ? {
          ...snapshotOverride,
          modelId: config.modelId ?? snapshotOverride.modelId,
          executionMode: mode,
          layers: snapshotOverride.layers.map(layer => ({ type: layer.type, params: { ...layer.params } })),
          inputShape: snapshotOverride.inputShape ? [...snapshotOverride.inputShape] : null,
        }
      : makeRunSnapshot(config, mode);

    set({
      isTraining: true,
      isPaused: false,
      status: 'starting',
      trainStartTime: Date.now(),
      totalEpochs: config.epochs,
      currentEpoch: 0,
      currentStep: 0,
      currentLoss: 0,
      currentAccuracy: 0,
      currentMetricName: config.dataset === 'csv' ? 'mae' : 'accuracy',
      finalAccuracy: null,
      finalMetricName: null,
      metrics: [],
      logs: [],
      error: null,
      activeRunId: config.runId,
      activeAttemptId: config.attemptId ?? null,
      lastAttemptId: config.attemptId ?? null,
      lastRestartCount: config.restartCount ?? 0,
      executionMode: mode,
      currentRunSnapshot: snapshot,
      lastTrainConfig: JSON.parse(JSON.stringify(config)),
      lastRunSnapshot: snapshot,
      errorKind: null,
      artifacts: null,
    });
  },

  markTrainingStarted: (runId) => {
    set(state => state.activeRunId === runId && state.status === 'starting'
      ? { status: 'training', error: null, errorKind: null }
      : {});
  },

  // 更新训练进度
  updateProgress: (metric, runId) => {
    set(state => {
      if (
        state.activeRunId !== runId ||
        !['starting', 'training', 'paused'].includes(state.status)
      ) {
        return {};
      }
      // 限制 metrics 数组长度不超过 10000 条
      let updatedMetrics = [...state.metrics, metric];
      if (updatedMetrics.length > 10000) {
        // 删除前 5000 条，保留后 5000 + 1 条
        updatedMetrics = updatedMetrics.slice(5000);
      }

      return {
        status: state.status === 'starting' ? 'training' as TrainStatus : state.status,
        currentEpoch: metric.epoch,
        currentStep: metric.step,
        currentLoss: metric.loss,
        currentAccuracy: metric.accuracy,
        currentMetricName: metric.metricName ?? 'accuracy',
        metrics: updatedMetrics,
      };
    });
  },

  // 完成训练（保存历史记录 + 生成推理卡片）
  finishTraining: (accuracy, metricName, runId, artifacts) => {
    set(state => {
      if (
        state.activeRunId !== runId ||
        !['starting', 'training', 'paused'].includes(state.status) ||
        !state.currentRunSnapshot
      ) {
        return {};
      }
      const snapshot = state.currentRunSnapshot;
      const duration = state.trainStartTime ? Date.now() - state.trainStartTime : 0;

      const record: TrainRecord = {
        id: crypto.randomUUID(),
        attemptId: state.activeAttemptId ?? undefined,
        parentAttemptId: state.lastTrainConfig?.parentAttemptId,
        restartCount: state.lastTrainConfig?.restartCount ?? 0,
        resumeType: state.lastTrainConfig?.resumeType ?? 'fresh',
        executionTrust: state.activeAttemptId
          ? useExperimentStore.getState().ledger.attempts.find(item => item.id === state.activeAttemptId)?.provenance.executionTrust
          : 'unverified',
        timestamp: Date.now(),
        networkSummary: snapshot.networkSummary,
        totalParams: snapshot.totalParams,
        finalAccuracy: accuracy,
        finalMetricName: metricName,
        finalLoss: state.currentLoss,
        epochs: state.totalEpochs,
        duration,
        dataset: snapshot.datasetName,
        metrics: [...state.metrics],
        modelId: snapshot.modelId ?? undefined,
        layers: snapshot.layers,
        inputShape: snapshot.inputShape ?? undefined,
        executionMode: snapshot.executionMode,
        artifacts: { ...artifacts },
      };

      const history = [record, ...state.history].slice(0, 5);

      // 生成推理卡片（仅在真实 Tauri 环境且存在 modelId + 独立权重时）。
      // CSV 回归还必须携带训练集拟合的特征顺序与标准化参数，否则不能复现训练时输入。
      if (
        snapshot.executionMode === 'native'
        && artifacts.perModel
        && snapshot.modelId
        && snapshot.layers.length > 0
      ) {
        const layersSnap = snapshot.layers;
        const modelType = inferModelType(layersSnap);
        const datasetName = snapshot.datasetName;
        const cardName = datasetName ? `${modelType} · ${datasetName}` : modelType;
        const commonCard = {
          id: snapshot.modelId,
          name: cardName,
          modelType,
          layers: layersSnap,
          inputShape: snapshot.inputShape ?? [1, 28, 28],
          finalAccuracy: accuracy,
          dataset: datasetName,
          epochs: state.totalEpochs,
          timestamp: Date.now(),
        };
        if (metricName === 'accuracy') {
          const attempt = state.activeAttemptId
            ? useExperimentStore.getState().ledger.attempts.find(item => item.id === state.activeAttemptId)
            : null;
          const parameters = attempt?.provenance.preprocessingParameters;
          const resize = parameters?.resize;
          const mean = parameters?.normalizationMean;
          const std = parameters?.normalizationStd;
          const channels = parameters?.channels;
          const colorMode = parameters?.colorMode;
          if (
            (parameters?.algorithm === 'vision-fixed-v1' || parameters?.algorithm === 'vision-resize-normalize-v1')
            && (resize === null || (Array.isArray(resize) && resize.length === 2 && resize.every(value => Number.isInteger(value) && (value as number) > 0)))
            && (colorMode === 'grayscale' || colorMode === 'rgb')
            && typeof channels === 'number' && Number.isInteger(channels) && channels > 0
            && parameters?.interpolation === 'bilinear'
            && Array.isArray(mean) && mean.length === channels && mean.every(value => typeof value === 'number' && Number.isFinite(value))
            && Array.isArray(std) && std.length === channels && std.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
          ) {
            usePredictCardsStore.getState().addCard({
              ...commonCard,
              taskType: 'image_classification',
              finalMetricName: 'accuracy',
              imagePreprocessing: {
                algorithm: parameters.algorithm,
                resize: resize === null ? null : [...resize] as number[],
                colorMode,
                channels,
                interpolation: 'bilinear',
                normalizationMean: [...mean] as number[],
                normalizationStd: [...std] as number[],
              },
            });
          }
        } else {
          const attempt = state.activeAttemptId
            ? useExperimentStore.getState().ledger.attempts.find(item => item.id === state.activeAttemptId)
            : null;
          const parameters = attempt?.provenance.preprocessingParameters;
          const featureColumns = parameters?.featureColumns;
          const mean = parameters?.mean;
          const std = parameters?.std;
          if (
            parameters?.algorithm === 'standard-scaler-fit-train-only-v1'
            && Array.isArray(featureColumns)
            && featureColumns.every(column => typeof column === 'string' && column.trim().length > 0)
            && Array.isArray(mean)
            && mean.every(value => typeof value === 'number' && Number.isFinite(value))
            && Array.isArray(std)
            && std.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
            && featureColumns.length === mean.length
            && featureColumns.length === std.length
          ) {
            usePredictCardsStore.getState().addCard({
              ...commonCard,
              taskType: 'tabular_regression',
              finalMetricName: 'mae',
              featureColumns: [...featureColumns],
              preprocessing: {
                algorithm: 'standard-scaler-fit-train-only-v1',
                mean: [...mean] as number[],
                std: [...std] as number[],
              },
            });
          }
        }
      }

      return {
        isTraining: false,
        isPaused: false,
        status: 'done' as TrainStatus,
        finalAccuracy: accuracy,
        finalMetricName: metricName,
        trainStartTime: null,
        activeRunId: null,
        activeAttemptId: null,
        currentRunSnapshot: null,
        history,
        artifacts: { ...artifacts },
      };
    });
  },

  // 终止性错误：只有当前 runId 可以结束当前训练。
  setError: (message, kind, runId) => {
    set(state => state.activeRunId === runId ? {
      isTraining: false,
      isPaused: false,
      status: kind === 'crashed' || kind === 'hung' ? 'crashed' : 'error',
      error: message,
      errorKind: kind,
      trainStartTime: null,
      activeRunId: null,
      activeAttemptId: null,
      currentRunSnapshot: null,
      artifacts: null,
    } : {});
  },

  setPreflightError: message => {
    set(state => state.activeRunId || state.isTraining ? {} : {
      status: 'error',
      error: message,
      errorKind: 'preflight',
    });
  },

  // 控制命令失败时不能假装训练已停止；保留活动态，让用户仍可重试停止。
  setControlError: (message, runId) => {
    set(state => state.activeRunId === runId ? {
      status: state.isPaused ? 'paused' : 'training',
      error: message,
      errorKind: 'control',
    } : {});
  },

  // 清除错误（重试前调用）
  clearError: () => {
    set(state => state.activeRunId
      ? { error: null, errorKind: null }
      : { status: 'idle', error: null, errorKind: null });
  },

  markStopping: (runId) => {
    set(state => state.activeRunId === runId
      ? { status: 'stopping', error: null, errorKind: null }
      : {});
  },

  cancelTraining: (runId) => {
    set(state => state.activeRunId === runId ? {
      isTraining: false,
      isPaused: false,
      status: 'cancelled',
      finalAccuracy: null,
      finalMetricName: null,
      error: null,
      errorKind: null,
      trainStartTime: null,
      activeRunId: null,
      activeAttemptId: null,
      executionMode: null,
      currentRunSnapshot: null,
      artifacts: null,
    } : {});
  },

  // 重置只负责关闭已结束的结果视图；活动进程必须先通过 stopTrainingRun 清理。
  // 原始文本日志保留到下一次训练开始，确保关闭结果卡片后仍能手动导出排障记录；
  // 指标和产物权限则由持久化 Attempt 提供。
  resetTraining: () => {
    set(state => state.activeRunId || state.isTraining ? {} : {
      isTraining: false,
      isPaused: false,
      status: 'idle',
      currentEpoch: 0,
      totalEpochs: 0,
      currentStep: 0,
      currentLoss: 0,
      currentAccuracy: 0,
      currentMetricName: 'accuracy',
      finalAccuracy: null,
      finalMetricName: null,
      metrics: [],
      error: null,
      errorKind: null,
      trainStartTime: null,
      activeRunId: null,
      activeAttemptId: null,
      executionMode: null,
      currentRunSnapshot: null,
      artifacts: null,
    });
  },

  // 添加日志（最多保留 200 条）
  addLog: (level, message, runId) => {
    set(state => state.activeRunId === runId ? {
      logs: [...state.logs, { timestamp: Date.now(), level, message }].slice(-200),
    } : {});
  },

  // 暂停训练
  pauseTraining: (runId) => {
    set(state => state.activeRunId === runId ? {
      isPaused: true,
      status: 'paused',
      error: null,
      errorKind: null,
    } : {});
  },

  // 恢复训练
  resumeTraining: (runId) => {
    set(state => state.activeRunId === runId ? {
      isPaused: false,
      status: 'training',
      error: null,
      errorKind: null,
    } : {});
  },
}));
