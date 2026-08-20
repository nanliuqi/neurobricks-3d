import { useEffect, useCallback } from 'react';
import { useTrainingStore } from '../stores/useTrainingStore';
import type { TrainConfig } from '../types/training';

// Tauri API 动态导入（不使用 isTauri 守卫，直接 try/catch）

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
    startTraining: storeStartTraining, 
    resetTraining 
  } = useTrainingStore();

  // 计算训练进度百分比
  const progress = totalEpochs > 0 ? (currentEpoch / totalEpochs) * 100 : 0;

  const train = useCallback(async (config: TrainConfig) => {
    // 更新前端 Store 状态
    storeStartTraining(config);

    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('start_training', { config });
    } catch (e) {
      // 真实 Tauri 环境（存在 __TAURI_IPC__）：invoke 失败 = 训练后端启动失败，
      // 必须把真实错误展示给用户，而不是静默等待 60 秒超时
      if (typeof (window as any).__TAURI_IPC__ === 'function') {
        const msg = e instanceof Error ? e.message : String(e);
        useTrainingStore.getState().setError(`训练进程启动失败：${msg}`);
      }
      // 浏览器演示模式（无 Tauri 运行时）：静默降级到模拟训练
    }
  }, [storeStartTraining]);

  const stop = useCallback(async () => {
    try {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        await invoke('stop_training');
      } catch {
        // Tauri 后端不可用
      }

      // 重置前端 Store 状态
      resetTraining();
    } catch (error) {
      console.error('Failed to stop training:', error);
      throw error;
    }
  }, [resetTraining]);

  // 暂停训练（v1 不支持，仅重置状态）
  const pause = useCallback(() => {
    console.warn('Pause training is not supported in v1, use stop instead');
    // 在 v1 中，暂停功能未实现，建议直接停止
  }, []);

  // 恢复训练（v1 不支持）
  const resume = useCallback(() => {
    console.warn('Resume training is not supported in v1');
    // 在 v1 中，恢复功能未实现
  }, []);

  const reset = useCallback(() => {
    resetTraining();
  }, [resetTraining]);

  useEffect(() => {
    return () => {
      // 组件卸载时清理
      if (isTraining) {
        // 触发停止训练（不等待完成）
        stop();
      }
    };
  }, [isTraining, stop]);

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
