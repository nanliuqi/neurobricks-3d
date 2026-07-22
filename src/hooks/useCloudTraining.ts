import { useCallback } from 'react';
import { useCloudStore } from '@/stores/useCloudStore';
import type { TrainConfig, TrainMetric } from '@/types/training';
import type { CloudTask, CloudTaskStatus, CloudResultFile } from '@/types/cloud';

// Tauri API 动态导入（不使用 isTauri 守卫，直接 try/catch）

interface CloudTrainingResult {
  submitTask: (serverId: string, trainConfig: TrainConfig) => Promise<void>;
  pollTask: (taskId: string) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  downloadResults: (taskId: string) => Promise<void>;
}

export function useCloudTraining(): CloudTrainingResult {
  const addTask = useCloudStore(state => state.addTask);
  const updateTask = useCloudStore(state => state.updateTask);

  // 提交云端训练任务
  const submitTask = useCallback(async (serverId: string, trainConfig: TrainConfig): Promise<void> => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      // 调用 Tauri 后端提交任务，返回 taskId
      const taskId = await invoke<string>('submit_cloud_training', { serverId, trainConfig });

      // 创建新任务并添加到 Store
      const newTask: CloudTask = {
        id: taskId,
        serverId,
        serverName: '', // TODO: 需要从服务器列表获取 serverName
        status: 'pending',
        trainConfig,
        remoteScriptPath: '',
        remoteLogPath: '',
        metrics: [],
        createdAt: Date.now(),
      };

      addTask(newTask);
    } catch (error) {
      console.error('Failed to submit cloud training task:', error);
      throw error;
    }
  }, [addTask]);

  // 轮询任务状态和指标
  const pollTask = useCallback(async (taskId: string): Promise<void> => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      
      // 从 store 获取任务和服务配置
      const task = useCloudStore.getState().tasks.find(t => t.id === taskId);
      if (!task) return;
      
      const server = useCloudStore.getState().servers.find(s => s.id === task.serverId);
      if (!server) return;

      const result = await invoke<{
        status: CloudTaskStatus;
        metrics: TrainMetric[];
      }>('poll_cloud_training', {
        serverConfig: server,
        remotePid: task.remoteScriptPath,  // remoteScriptPath 存的是 PID
      });
      
      // 更新 Store 中的任务状态
      updateTask(taskId, {
        status: result.status,
        metrics: result.metrics,
      });
    } catch (error) {
      console.error('Failed to poll cloud training task:', error);
      throw error;
    }
  }, [updateTask]);

  // 停止云端训练任务
  const stopTask = useCallback(async (taskId: string): Promise<void> => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      
      // 从 store 获取任务和服务配置
      const task = useCloudStore.getState().tasks.find(t => t.id === taskId);
      if (!task) return;
      
      const server = useCloudStore.getState().servers.find(s => s.id === task.serverId);
      if (!server) return;

      await invoke('stop_cloud_training', {
        serverConfig: server,
        remotePid: task.remoteScriptPath,
      });
      
      updateTask(taskId, { status: 'stopped' });
    } catch (error) {
      console.error('Failed to stop cloud training task:', error);
      throw error;
    }
  }, [updateTask]);

  // 下载训练结果
  const downloadResults = useCallback(async (taskId: string): Promise<void> => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      // 调用 Tauri 后端下载结果文件
      const resultFiles = await invoke<CloudResultFile[]>('download_results', { taskId });

      // 更新任务的结果文件列表
      updateTask(taskId, {
        resultFiles,
      });
    } catch (error) {
      console.error('Failed to download results:', error);
      throw error;
    }
  }, [updateTask]);

  return {
    submitTask,
    pollTask,
    stopTask,
    downloadResults,
  };
}
