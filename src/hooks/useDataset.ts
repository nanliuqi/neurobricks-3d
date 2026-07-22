import { useCallback } from 'react';
import { useDatasetStore } from '@/stores/useDatasetStore';
import type { DatasetType, DatasetInfo } from '@/types/dataset';

// Tauri API 动态导入（不使用 isTauri 守卫，直接 try/catch）

interface DatasetResult {
  importDataset: (type: DatasetType, path: string) => Promise<void>;
  loadBuiltin: (name: string) => Promise<void>;
  clearDataset: () => void;
}

export function useDataset(): DatasetResult {
  const setDataset = useDatasetStore(state => state.setDataset);
  const clearDatasetStore = useDatasetStore(state => state.clearDataset);

  // 导入数据集
  const importDataset = useCallback(async (type: DatasetType, path: string): Promise<void> => {
    try {
      let result: DatasetInfo;

      const { invoke } = await import('@tauri-apps/api/tauri');

      // 根据类型调用不同的 Tauri 命令
      switch (type) {
        case 'local_image':
          result = await invoke<DatasetInfo>('import_local_images', { dirPath: path });
          break;
        case 'csv':
          result = await invoke<DatasetInfo>('import_csv', { filePath: path });
          break;
        case 'excel':
          result = await invoke<DatasetInfo>('import_excel', { filePath: path });
          break;
        default:
          throw new Error(`不支持的数据集类型: ${type}`);
      }

      // 保存数据集信息到 Store
      setDataset(result);
    } catch (error) {
      console.error('Failed to import dataset:', error);
      throw error;
    }
  }, [setDataset]);

  // 加载内置数据集
  const loadBuiltin = useCallback(async (name: string): Promise<void> => {
    // 定义内置数据集的预设信息
    const builtinDatasets: Record<string, DatasetInfo> = {
      mnist: {
        type: 'mnist',
        name: 'MNIST',
        sampleCount: 70000,
        classCount: 10,
        imageWidth: 28,
        imageHeight: 28,
        channels: 1,
      },
      cifar10: {
        type: 'cifar10',
        name: 'CIFAR-10',
        sampleCount: 60000,
        classCount: 10,
        imageWidth: 32,
        imageHeight: 32,
        channels: 3,
      },
    };

    const datasetInfo = builtinDatasets[name.toLowerCase()];

    if (!datasetInfo) {
      throw new Error(`未知的内置数据集: ${name}`);
    }

    // 直接设置到 Store
    setDataset(datasetInfo);
  }, [setDataset]);

  // 清除数据集
  const clearDataset = useCallback((): void => {
    clearDatasetStore();
  }, [clearDatasetStore]);

  return {
    importDataset,
    loadBuiltin,
    clearDataset,
  };
}
