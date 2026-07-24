import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DatasetType, DatasetInfo } from '@/types/dataset';

interface DatasetState {
  datasetType: DatasetType | null;
  datasetPath: string | null;
  datasetInfo: DatasetInfo | null;
  trainRatio: number;
}

interface DatasetActions {
  setDataset: (info: DatasetInfo, path?: string | null) => void;
  setTrainRatio: (ratio: number) => void;
  clearDataset: () => void;
}

export const useDatasetStore = create<DatasetState & DatasetActions>()(
  persist(
    (set) => ({
      // 初始状态
      datasetType: null,
      datasetPath: null,
      datasetInfo: null,
      trainRatio: 0.8,

      // 设置数据集（从 DatasetInfo 中提取 type）
      setDataset: (info: DatasetInfo, path: string | null = null) => {
        set({
          datasetType: info.type,
          datasetPath: path,
          datasetInfo: info,
        });
      },

      // 设置训练集比例
      setTrainRatio: (ratio: number) => {
        const clampedRatio = Math.max(0.1, Math.min(0.9, ratio));
        set({
          trainRatio: clampedRatio,
        });
      },

      // 清除数据集
      clearDataset: () => {
        set({
          datasetType: null,
          datasetPath: null,
          datasetInfo: null,
          trainRatio: 0.8,
        });
      },
    }),
    {
      // 持久化数据集选择，避免应用重启后丢失（层已自动保存，数据集也应保留）
      name: 'neurobricks_dataset',
    }
  )
);
