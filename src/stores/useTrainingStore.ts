import { create } from 'zustand';
import type { TrainConfig, TrainMetric, TrainStatus, LogEntry, TrainRecord } from '@/types/training';
import type { LayerType, LayerParams } from '@/types/layer';
import { useLayerStore } from './useLayerStore';
import { useDatasetStore } from './useDatasetStore';
import { usePredictCardsStore, inferModelType } from './usePredictCardsStore';

interface TrainingState {
  isTraining: boolean;
  isPaused: boolean;
  status: TrainStatus;
  currentEpoch: number;
  totalEpochs: number;
  currentStep: number;
  currentLoss: number;
  currentAccuracy: number;
  finalAccuracy: number | null;
  metrics: TrainMetric[];
  logs: LogEntry[];
  history: TrainRecord[];
  error: string | null;
  trainStartTime: number | null;
  // 训练开始时的快照（用于完成后生成推理卡片，避免训练期间场景被修改导致不一致）
  currentModelId: string | null;
  currentLayersSnapshot: Array<{ type: LayerType; params: LayerParams }> | null;
  currentInputShape: number[] | null;
}

interface TrainingActions {
  startTraining: (config: TrainConfig) => void;
  updateProgress: (metric: TrainMetric) => void;
  finishTraining: (accuracy: number) => void;
  setError: (message: string) => void;
  resetTraining: () => void;
  pauseTraining: () => void;
  resumeTraining: () => void;
  addLog: (level: 'info' | 'warn' | 'error', message: string) => void;
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
  finalAccuracy: null,
  metrics: [],
  logs: [],
  history: [],
  error: null,
  trainStartTime: null,
  currentModelId: null,
  currentLayersSnapshot: null,
  currentInputShape: null,

  // 开始训练
  startTraining: (config: TrainConfig) => {
    set({
      isTraining: true,
      isPaused: false,
      status: 'training',
      trainStartTime: Date.now(),
      totalEpochs: config.epochs,
      currentEpoch: 0,
      currentStep: 0,
      currentLoss: 0,
      currentAccuracy: 0,
      finalAccuracy: null,
      metrics: [],
      logs: [],
      error: null,
      // 快照 modelId / 层配置 / 输入形状，供完成后生成推理卡片
      currentModelId: config.modelId ?? null,
      currentLayersSnapshot: config.layers ? config.layers.map(l => ({ type: l.type, params: { ...l.params } })) : null,
      currentInputShape: config.inputShape ? [...config.inputShape] : null,
    });
  },

  // 更新训练进度
  updateProgress: (metric: TrainMetric) => {
    set(state => {
      // 限制 metrics 数组长度不超过 10000 条
      let updatedMetrics = [...state.metrics, metric];
      if (updatedMetrics.length > 10000) {
        // 删除前 5000 条，保留后 5000 + 1 条
        updatedMetrics = updatedMetrics.slice(5000);
      }

      return {
        currentEpoch: metric.epoch,
        currentStep: metric.step,
        currentLoss: metric.loss,
        currentAccuracy: metric.accuracy,
        metrics: updatedMetrics,
      };
    });
  },

  // 完成训练（保存历史记录 + 生成推理卡片）
  finishTraining: (accuracy: number) => {
    set(state => {
      const layerStore = useLayerStore.getState();
      const datasetStore = useDatasetStore.getState();
      const summary = layerStore.layers.map(l => l.type).slice(0, 8).join(' → ');
      const totalParams = layerStore.totalParams;
      const duration = state.trainStartTime ? Date.now() - state.trainStartTime : 0;

      const record: TrainRecord = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        networkSummary: summary || '未命名网络',
        totalParams,
        finalAccuracy: accuracy,
        finalLoss: state.currentLoss,
        epochs: state.totalEpochs,
        duration,
        dataset: datasetStore.datasetInfo?.name ?? '',
        metrics: [...state.metrics],
        modelId: state.currentModelId ?? undefined,
        layers: state.currentLayersSnapshot ?? undefined,
        inputShape: state.currentInputShape ?? undefined,
      };

      const history = [record, ...state.history].slice(0, 5);

      // 生成推理卡片（仅在真实 Tauri 环境且存在 modelId + 层快照时，浏览器模拟训练无权重文件）
      const isTauri = typeof window !== 'undefined' && typeof (window as any).__TAURI_IPC__ === 'function';
      if (isTauri && state.currentModelId && state.currentLayersSnapshot && state.currentLayersSnapshot.length > 0) {
        const layersSnap = state.currentLayersSnapshot;
        const modelType = inferModelType(layersSnap);
        const datasetName = datasetStore.datasetInfo?.name ?? '';
        const cardName = datasetName ? `${modelType} · ${datasetName}` : modelType;
        usePredictCardsStore.getState().addCard({
          id: state.currentModelId,
          name: cardName,
          modelType,
          layers: layersSnap,
          inputShape: state.currentInputShape ?? [1, 28, 28],
          finalAccuracy: accuracy,
          dataset: datasetName,
          epochs: state.totalEpochs,
          timestamp: Date.now(),
        });
      }

      return {
        isTraining: false,
        isPaused: false,
        status: 'done' as TrainStatus,
        finalAccuracy: accuracy,
        trainStartTime: null,
        history,
      };
    });
  },

  // 设置错误
  setError: (message: string) => {
    set({
      isTraining: false,
      isPaused: false,
      status: 'error',
      error: message,
      trainStartTime: null,
    });
  },

  // 重置训练状态（保留 finalAccuracy：模型文件仍在磁盘上，推理功能仍可用）
  resetTraining: () => {
    set({
      isTraining: false,
      isPaused: false,
      status: 'idle',
      currentEpoch: 0,
      totalEpochs: 0,
      currentStep: 0,
      currentLoss: 0,
      currentAccuracy: 0,
      metrics: [],
      logs: [],
      error: null,
      trainStartTime: null,
    });
  },

  // 添加日志（最多保留 200 条）
  addLog: (level, message) => {
    set(state => ({
      logs: [...state.logs, { timestamp: Date.now(), level, message }].slice(-200),
    }));
  },

  // 暂停训练
  pauseTraining: () => {
    set({ isPaused: true });
  },

  // 恢复训练
  resumeTraining: () => {
    set({ isPaused: false });
  },
}));
