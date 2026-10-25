import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DatasetType, DatasetInfo } from '@/types/dataset';

interface DatasetState {
  datasetType: DatasetType | null;
  datasetPath: string | null;
  datasetInfo: DatasetInfo | null;
  trainRatio: number;
  splitStrategy: 'random' | 'group' | 'temporal';
  groupField: string | null;
  timeField: string | null;
  /** CSV 监督回归目标；null 表示尚未由用户确认。 */
  targetField: string | null;
}

interface DatasetActions {
  setDataset: (info: DatasetInfo, path?: string | null) => void;
  setTrainRatio: (ratio: number) => void;
  setSplitStrategy: (strategy: 'random' | 'group' | 'temporal') => void;
  setGroupField: (field: string | null) => void;
  setTimeField: (field: string | null) => void;
  setTargetField: (field: string | null) => void;
  setSampleUnitDeclaration: (sampleUnit: string, declaration: string) => void;
  updateMachineChecks: (checks: NonNullable<DatasetInfo['machineChecks']>) => void;
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
      splitStrategy: 'random',
      groupField: null,
      timeField: null,
      targetField: null,

      // 设置数据集（从 DatasetInfo 中提取 type）
      setDataset: (info: DatasetInfo, path: string | null = null) => {
        set({
          datasetType: info.type,
          datasetPath: path,
          datasetInfo: info,
          // 切换数据集即切换划分契约。旧 CSV 字段或图像目录字段不得泄漏到新数据集。
          splitStrategy: 'random',
          groupField: null,
          timeField: null,
          targetField: null,
        });
      },

      // 设置训练集比例
      setTrainRatio: (ratio: number) => {
        const clampedRatio = Math.max(0.1, Math.min(0.9, ratio));
        set({
          trainRatio: clampedRatio,
        });
      },

      setSplitStrategy: (strategy) => set({ splitStrategy: strategy }),
      setGroupField: (field) => set({ groupField: field || null }),
      setTimeField: (field) => set({ timeField: field || null }),
      setTargetField: (field) => set({ targetField: field || null }),

      setSampleUnitDeclaration: (sampleUnit, declaration) => {
        set(state => state.datasetInfo ? {
          datasetInfo: {
            ...state.datasetInfo,
            sampleUnit,
            sampleIndependence: 'user_declared',
            sampleUnitDeclaration: declaration.trim() || `独立样本单位 = ${sampleUnit}`,
          },
        } : {});
      },

      updateMachineChecks: (checks) => {
        set(state => state.datasetInfo ? {
          datasetInfo: { ...state.datasetInfo, machineChecks: checks.map(check => ({ ...check })) },
        } : {});
      },

      // 清除数据集
      clearDataset: () => {
        set({
          datasetType: null,
          datasetPath: null,
          datasetInfo: null,
          trainRatio: 0.8,
          splitStrategy: 'random',
          groupField: null,
          timeField: null,
          targetField: null,
        });
      },
    }),
    {
      // 持久化数据集选择，避免应用重启后丢失（层已自动保存，数据集也应保留）
      name: 'neurobricks_dataset',
    }
  )
);
