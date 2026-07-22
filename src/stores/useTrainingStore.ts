import { create } from 'zustand';
import type { TrainConfig, TrainMetric, TrainStatus, LogEntry, TrainRecord } from '@/types/training';
import { useLayerStore } from './useLayerStore';
import { useDatasetStore } from './useDatasetStore';

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

  // 完成训练（保存历史记录）
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
      };

      const history = [record, ...state.history].slice(0, 5);

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

  // 重置训练状态
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
      finalAccuracy: null,
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
