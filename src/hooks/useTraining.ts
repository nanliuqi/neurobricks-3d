import { useCallback } from 'react';
import { useTrainingStore } from '../stores/useTrainingStore';
import type { TrainConfig } from '../types/training';
import {
  pauseTrainingRun,
  resumeTrainingRun,
  startTrainingRun,
  stopTrainingRun,
} from '../trainingRuntime';

export function useTraining() {
  const { 
    status, 
    isTraining,
    currentEpoch,
    totalEpochs,
    currentLoss,
    currentAccuracy,
    metrics,
    error,
    resetTraining 
  } = useTrainingStore();

  // 计算训练进度百分比
  const progress = totalEpochs > 0 ? (currentEpoch / totalEpochs) * 100 : 0;

  const train = useCallback(async (config: TrainConfig) => {
    return startTrainingRun(config);
  }, []);

  const stop = useCallback(async () => {
    return stopTrainingRun();
  }, []);

  const pause = useCallback(async () => pauseTrainingRun(), []);

  const resume = useCallback(async () => resumeTrainingRun(), []);

  const reset = useCallback(() => {
    resetTraining();
  }, [resetTraining]);

  return {
    status,
    isTraining,
    progress,
    currentEpoch,
    totalEpochs,
    currentLoss,
    currentAccuracy,
    metrics,
    error,
    train,
    stop,
    pause,
    resume,
    reset,
  };
}
