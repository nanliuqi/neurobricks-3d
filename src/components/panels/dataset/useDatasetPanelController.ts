/**
 * 数据集工作台控制层：DatasetPanel 的全部交互状态机。
 * - 异步互斥：同步重入锁 + 五态导入阶段（选择/导入分别真实呈现）；
 * - 清除确认：ConfirmDialog 状态，占位下拉项不承担删除动作；
 * - 网络适配确认：打开时冻结完整任务契约上下文（身份 + 目标列 + 切分 +
 *   特征列快照）；确认时校验 requestId、强身份与上下文一致性（fail-closed），
 *   模型层允许变化但基于当前模型重算；经 applyAdaptedLayers 单次原子提交；
 * - 组件卸载后不再更新局部状态。
 * 业务规则（切分语义、字段清理、适配算法边界）均沿用既有实现，不新增。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { adaptLayersForCsvRegression, adaptLayersToInputShape } from '@/utils/shapeInference';
import { getErrorMessage } from '@/utils/errorMessage';
import { toast } from '@/components/ui/Toast';
import type { DatasetInfo, DatasetType } from '@/types/dataset';
import { deriveCsvFeatureFields } from '@/utils/datasetContract';
import {
  buildBuiltinDatasetInfo,
  buildDatasetSummaryView,
  buildPreviewTableView,
  deriveNonNumericFeatureColumns,
  isBuiltinDatasetType,
  type DatasetSummaryView,
  type PreviewTableView,
} from '@/utils/datasetPanelViewModel';

// 兼容真实导入协议的无详情兜底：导入阶段只建立列画像、不猜目标列；
// 文本/日期列可先导入（记录为 nonNumericColumns），NaN/Infinity 与结构性错误才会拒绝。
const CSV_IMPORT_ERROR_FALLBACK =
  '后端未返回错误详情；请确认 CSV 文件可读、至少包含两列、每行列数一致，且单元格不包含 NaN/Infinity。目标列需在导入成功后于数据集面板明确选择。';

/** 五态导入阶段：选择与导入是两个真实阶段，文案必须与状态一致。 */
export type DatasetImportPhase =
  | 'idle'
  | 'selecting-image'
  | 'importing-image'
  | 'selecting-csv'
  | 'importing-csv';

/**
 * 适配请求的冻结上下文：打开确认框时的完整任务契约快照。
 * 确认时逐项比对；任何不一致都拒绝应用（不得回退到 type:name 冒充同一身份）。
 */
export interface AdaptationContext {
  datasetId: string | null;
  contentHash: string | null;
  importedAt: number | null;
  datasetPath: string | null;
  datasetType: DatasetType | null;
  targetField: string | null;
  splitStrategy: 'random' | 'group' | 'temporal';
  groupField: string | null;
  timeField: string | null;
  /** 冻结的特征列快照（CSV）；非 CSV 为 null。 */
  featureFields: string[] | null;
  featureCount: number;
}

export interface AdaptationPlan {
  /** 单调递增请求 ID；过期的确认处理器不得执行。 */
  requestId: number;
  kind: 'image' | 'csv';
  datasetName: string;
  context: AdaptationContext;
  targetShape: [number, number, number];
  targetLabel: string;
  csvRegression: boolean;
  /** 为什么建议适配（确认框展示用途）。 */
  reason: string;
}

interface FieldSelections {
  splitStrategy: 'random' | 'group' | 'temporal';
  groupField: string | null;
  timeField: string | null;
  targetField: string | null;
}

function captureAdaptationContext(
  datasetInfo: DatasetInfo | null,
  datasetPath: string | null,
  selections: FieldSelections,
): AdaptationContext {
  const featureFields = datasetInfo?.type === 'csv'
    ? deriveCsvFeatureFields(datasetInfo, selections) ?? null
    : null;
  return {
    datasetId: datasetInfo?.datasetId ?? null,
    contentHash: datasetInfo?.contentHash ?? null,
    importedAt: typeof datasetInfo?.importedAt === 'number' ? datasetInfo.importedAt : null,
    datasetPath,
    datasetType: datasetInfo?.type ?? null,
    targetField: selections.targetField,
    splitStrategy: selections.splitStrategy,
    groupField: selections.groupField,
    timeField: selections.timeField,
    featureFields,
    featureCount: featureFields?.length ?? 0,
  };
}

function adaptationContextMatches(expected: AdaptationContext, actual: AdaptationContext): boolean {
  return expected.datasetId === actual.datasetId
    && expected.contentHash === actual.contentHash
    && expected.importedAt === actual.importedAt
    && expected.datasetPath === actual.datasetPath
    && expected.datasetType === actual.datasetType
    && expected.targetField === actual.targetField
    && expected.splitStrategy === actual.splitStrategy
    && expected.groupField === actual.groupField
    && expected.timeField === actual.timeField
    && expected.featureCount === actual.featureCount
    && JSON.stringify(expected.featureFields) === JSON.stringify(actual.featureFields);
}

export function useDatasetPanelController() {
  const datasetInfo = useDatasetStore(state => state.datasetInfo);
  const trainRatio = useDatasetStore(state => state.trainRatio);
  const splitStrategy = useDatasetStore(state => state.splitStrategy);
  const groupField = useDatasetStore(state => state.groupField);
  const timeField = useDatasetStore(state => state.timeField);
  const targetField = useDatasetStore(state => state.targetField);

  const [importPhase, setImportPhase] = useState<DatasetImportPhase>('idle');
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [adaptation, setAdaptationState] = useState<AdaptationPlan | null>(null);
  const setAdaptation = useCallback((plan: AdaptationPlan | null) => {
    adaptationOpenRef.current = plan !== null;
    setAdaptationState(plan);
  }, []);

  // 同步重入锁：不依赖下一次渲染后的 disabled，防止同一动作触发两次 invoke/选择器。
  const importLockRef = useRef<DatasetImportPhase>('idle');
  const adaptationIdRef = useRef(0);
  // 适配弹窗打开时不得叠加清除确认弹窗（避免两个模态互相干扰）。
  const adaptationOpenRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ---------------- 派生视图（与模块 04 消费同一 store，不复制训练规则） ---------------- */

  const builtinValue = isBuiltinDatasetType(datasetInfo?.type) ? String(datasetInfo?.type) : '';

  const summaryView: DatasetSummaryView | null = useMemo(
    () => (datasetInfo ? buildDatasetSummaryView(datasetInfo) : null),
    [datasetInfo],
  );

  const featureFields = useMemo(
    () => deriveCsvFeatureFields(datasetInfo, { splitStrategy, groupField, timeField, targetField }),
    [datasetInfo, splitStrategy, groupField, timeField, targetField],
  );

  const nonNumericFeatureColumns = useMemo(
    () => deriveNonNumericFeatureColumns(datasetInfo, { splitStrategy, groupField, timeField, targetField }),
    [datasetInfo, splitStrategy, groupField, timeField, targetField],
  );

  const previewTableView: PreviewTableView | null = useMemo(
    () => buildPreviewTableView(datasetInfo?.previewRows, datasetInfo?.columns),
    [datasetInfo],
  );

  /* ---------------- 网络适配：请求（打开确认框） ---------------- */

  const openAdaptationDialog = useCallback((plan: Omit<AdaptationPlan, 'requestId'>) => {
    try {
      const layers = useLayerStore.getState().layers;
      const inputLayer = layers.find(layer => layer.type === 'Input');
      // 没有 Input 层时不弹框也不伪造成功（与既有边界一致）。
      if (!inputLayer) return;

      const adapted = plan.csvRegression
        ? adaptLayersForCsvRegression(layers, plan.targetShape[2])
        : adaptLayersToInputShape(layers, plan.targetShape);
      const needsUpdate = adapted.some(
        (layer, index) => JSON.stringify(layer.params) !== JSON.stringify(layers[index].params),
      );
      // 当前网络已匹配：不显示无意义确认框（计算失败时不会走到这里，不产生虚假“已匹配”）。
      if (!needsUpdate) return;

      adaptationIdRef.current += 1;
      // 替换语义：快速连续触发时只有最新请求有效，不存在多个互相覆盖的弹窗。
      setAdaptation({ ...plan, requestId: adaptationIdRef.current });
    } catch (error) {
      // 适配预览计算抛错：不弹框、不修改模型，给出明确中文提示。
      toast.error('网络适配计算失败：' + getErrorMessage(error));
    }
  }, [setAdaptation]);

  /** CSV 变化（目标列/切分字段）后的适配请求：上下文按当前任务契约完整冻结。 */
  const requestCsvAdaptation = useCallback(() => {
    const state = useDatasetStore.getState();
    if (state.datasetInfo?.type !== 'csv') return;
    if (!state.targetField) return;
    const context = captureAdaptationContext(state.datasetInfo, state.datasetPath, state);
    if (context.featureCount <= 0) return;
    openAdaptationDialog({
      kind: 'csv',
      datasetName: state.datasetInfo.name,
      context,
      targetShape: [1, 1, context.featureCount],
      targetLabel: `1×1×${context.featureCount}（按当前配置推导，已排除目标列与切分元数据列）`,
      csvRegression: true,
      reason: 'CSV 回归需要表格输入形状 [1, 1, 特征数]，并把最后一个 Linear 输出设为 1。',
    });
  }, [openAdaptationDialog]);

  /* ---------------- 网络适配：确认 / 取消 ---------------- */

  const cancelAdaptation = useCallback(() => {
    // 只保留数据集选择与当前网络，不回滚任何已保存的数据集配置。
    setAdaptation(null);
  }, [setAdaptation]);

  const confirmAdaptation = useCallback(() => {
    const plan = adaptation;
    if (!plan) return;
    // requestId 过期（已被更新的请求替换）：旧确认处理器不得执行。
    if (plan.requestId !== adaptationIdRef.current) {
      setAdaptation(null);
      return;
    }
    const datasetState = useDatasetStore.getState();
    // 数据集已被清除/替换为空：属于契约变化，直接拒绝。
    if (!datasetState.datasetInfo) {
      setAdaptation(null);
      toast.error('数据集或任务契约已变化，请重新确认网络适配');
      return;
    }
    const currentContext = captureAdaptationContext(datasetState.datasetInfo, datasetState.datasetPath, datasetState);
    // 缺少强身份时不得回退到 type:name 冒充同一身份：先于上下文比对拒绝（fail-closed）。
    if (!currentContext.datasetId && !currentContext.contentHash) {
      setAdaptation(null);
      toast.error('数据集缺少强身份（datasetId / contentHash），无法安全应用网络适配');
      return;
    }
    if (!adaptationContextMatches(plan.context, currentContext)) {
      setAdaptation(null);
      toast.error('数据集或任务契约已变化，请重新确认网络适配');
      return;
    }

    // 模型层允许在弹窗期间变化：确认时必须基于当前模型重新计算，不使用旧快照。
    // 适配计算、差异计算与最终写入全部在受控边界内；任何失败都不修改 store。
    try {
      const layers = useLayerStore.getState().layers;
      if (!layers.some(layer => layer.type === 'Input')) {
        setAdaptation(null);
        toast.error('当前场景没有 Input 层，无法执行网络适配');
        return;
      }

      const adapted = plan.csvRegression
        ? adaptLayersForCsvRegression(layers, plan.context.featureCount)
        : adaptLayersToInputShape(layers, plan.targetShape);
      const needsUpdate = adapted.some(
        (layer, index) => JSON.stringify(layer.params) !== JSON.stringify(layers[index].params),
      );
      if (!needsUpdate) {
        // 弹窗期间用户已手动对齐：不再重复修改。
        setAdaptation(null);
        return;
      }

      // 原子提交：统计先在内存算完，成功后仅一次 set；失败（抛出）则 store 完全不变。
      useLayerStore.getState().applyAdaptedLayers(adapted);
      setAdaptation(null);
    } catch (error) {
      // 失败后弹窗保持打开可重试，不永久锁死；网络保持失败前的状态。
      toast.error('应用网络适配失败：' + getErrorMessage(error));
    }
  }, [adaptation, setAdaptation]);

  /* ---------------- 数据来源：内置 / 图片 / CSV / Excel 边界 ---------------- */

  const selectBuiltin = useCallback((datasetName: string) => {
    if (!datasetName) return; // 占位项只表示“请选择”，不承担清除动作
    const info = buildBuiltinDatasetInfo(datasetName as 'mnist' | 'cifar10');
    useDatasetStore.getState().setDataset(info);
    if (info.channels != null && info.imageHeight != null && info.imageWidth != null) {
      const state = useDatasetStore.getState();
      openAdaptationDialog({
        kind: 'image',
        datasetName: info.name,
        context: captureAdaptationContext(info, state.datasetPath, state),
        targetShape: [info.channels, info.imageHeight, info.imageWidth],
        targetLabel: `${info.channels}×${info.imageHeight}×${info.imageWidth}`,
        csvRegression: false,
        reason: `内置数据集 ${info.name} 的输入形状与该数据集官方规格一致。`,
      });
    }
  }, [openAdaptationDialog]);

  const importImages = useCallback(async () => {
    if (importLockRef.current !== 'idle') return; // 图片与 CSV 互斥，且不重复打开选择器
    importLockRef.current = 'selecting-image';
    if (mountedRef.current) setImportPhase('selecting-image');
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');

      const dirPath = await open({
        directory: true,
        multiple: false,
        title: '选择图像文件夹',
      });
      // 用户取消系统选择器不是错误。
      if (!dirPath) return;

      // 选择器返回有效路径后才进入导入阶段：文案与真实状态一致。
      importLockRef.current = 'importing-image';
      if (mountedRef.current) setImportPhase('importing-image');

      const result = await invoke<DatasetInfo>('import_local_images', { dirPath });
      useDatasetStore.getState().setDataset(result, dirPath as string);

      // 自定义图像：Rust 端已返回首图尺寸与真实通道数，据此适配网络（与内置同构）。
      if (result.channels != null && result.imageHeight != null && result.imageWidth != null) {
        const state = useDatasetStore.getState();
        openAdaptationDialog({
          kind: 'image',
          datasetName: result.name,
          context: captureAdaptationContext(result, state.datasetPath, state),
          targetShape: [result.channels, result.imageHeight, result.imageWidth],
          targetLabel: `${result.channels}×${result.imageHeight}×${result.imageWidth}`,
          csvRegression: false,
          reason: '导入目录的首图尺寸/通道数与当前网络输入不一致。',
        });
      }
    } catch (error) {
      console.error('Failed to import images:', error);
      toast.error('导入图像数据集失败：' + getErrorMessage(error));
    } finally {
      importLockRef.current = 'idle';
      if (mountedRef.current) setImportPhase('idle');
    }
  }, [openAdaptationDialog]);

  const importCsv = useCallback(async () => {
    if (importLockRef.current !== 'idle') return;
    importLockRef.current = 'selecting-csv';
    if (mountedRef.current) setImportPhase('selecting-csv');
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');

      const filePath = await open({
        multiple: false,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        title: '选择 CSV 文件',
      });
      if (!filePath) return;

      importLockRef.current = 'importing-csv';
      if (mountedRef.current) setImportPhase('importing-csv');

      const result = await invoke<DatasetInfo>('import_csv', { filePath });
      useDatasetStore.getState().setDataset(result, filePath as string);

      // CSV 目标列必须显式选择，不能按位置猜测；卷积层与表格数据不兼容，直接提示。
      const layers = useLayerStore.getState().layers;
      const hasConvLayers = layers.some(
        layer => layer.type === 'Conv2D' || layer.type === 'MaxPool2D' || layer.type === 'AvgPool2D',
      );
      if (hasConvLayers) {
        toast.warning(
          'CSV 是表格数据，不支持卷积/池化层。\n当前网络包含卷积层，无法自动适配，请改用全连接结构（Input → Flatten → Linear）。'
        );
        return;
      }
      toast.info('CSV 已导入。请在数据预览中明确选择“回归目标列”；确认后系统才会适配 MLP。');
    } catch (error) {
      console.error('Failed to import CSV:', error);
      toast.error('导入 CSV 失败：' + getErrorMessage(error, CSV_IMPORT_ERROR_FALLBACK));
    } finally {
      importLockRef.current = 'idle';
      if (mountedRef.current) setImportPhase('idle');
    }
  }, []);

  /** Excel 不在当前可信训练边界内：只解释能力边界，绝不打开文件选择器或调用导入命令。 */
  const showExcelBoundary = useCallback(() => {
    toast.info('Excel 导入功能开发中，请使用 CSV 文件或内置数据集');
  }, []);

  /* ---------------- 安全清除 ---------------- */

  const requestClearDataset = useCallback(() => {
    if (!useDatasetStore.getState().datasetInfo) return;
    if (adaptationOpenRef.current) return; // 适配确认进行中不叠加第二个模态；处理完后仍可清除
    setClearDialogOpen(true);
  }, []);

  const cancelClearDataset = useCallback(() => {
    // 取消后状态完全不变（不调用任何 store 动作）。
    setClearDialogOpen(false);
  }, []);

  const confirmClearDataset = useCallback(() => {
    // 复用既有清除动作；清除的是选择与字段配置，不删除磁盘文件与历史档案。
    useDatasetStore.getState().clearDataset();
    setClearDialogOpen(false);
    setAdaptation(null);
  }, [setAdaptation]);

  /* ---------------- 字段配置（沿用既有清理语义） ---------------- */

  const setTrainRatio = useCallback((ratio: number) => {
    useDatasetStore.getState().setTrainRatio(ratio);
  }, []);

  const setSplitStrategy = useCallback((strategy: 'random' | 'group' | 'temporal') => {
    const state = useDatasetStore.getState();
    state.setSplitStrategy(strategy);
    if (strategy === 'group') {
      state.setTimeField(null);
      state.setGroupField(
        state.datasetInfo?.type === 'local_image' && state.datasetInfo.imageGroup?.available
          ? state.datasetInfo.imageGroup.field
          : null,
      );
      return;
    }
    if (strategy === 'temporal') {
      state.setGroupField(null);
      return;
    }
    state.setGroupField(null);
    state.setTimeField(null);
    requestCsvAdaptation();
  }, [requestCsvAdaptation]);

  const setGroupField = useCallback((field: string | null) => {
    useDatasetStore.getState().setGroupField(field);
    requestCsvAdaptation();
  }, [requestCsvAdaptation]);

  const setTimeField = useCallback((field: string | null) => {
    useDatasetStore.getState().setTimeField(field);
    requestCsvAdaptation();
  }, [requestCsvAdaptation]);

  const setTargetField = useCallback((nextTargetField: string | null) => {
    const state = useDatasetStore.getState();
    state.setTargetField(nextTargetField);
    // 既有冲突清理：目标列不能同时作为 group / time 字段，不悄悄选择替代字段。
    if (state.groupField === nextTargetField) state.setGroupField(null);
    if (state.timeField === nextTargetField) state.setTimeField(null);
    requestCsvAdaptation();
  }, [requestCsvAdaptation]);

  const setSampleUnit = useCallback((unit: string) => {
    if (!unit) return;
    useDatasetStore.getState().setSampleUnitDeclaration(unit, `用户声明：独立样本单位 = ${unit}`);
  }, []);

  return {
    // store 镜像
    datasetInfo,
    trainRatio,
    splitStrategy,
    groupField,
    timeField,
    targetField,
    // 派生视图
    builtinValue,
    summaryView,
    featureFields,
    nonNumericFeatureColumns,
    previewTableView,
    // 交互状态
    importPhase,
    importing: importPhase !== 'idle',
    clearDialogOpen,
    adaptation,
    // 动作
    selectBuiltin,
    importImages,
    importCsv,
    showExcelBoundary,
    requestClearDataset,
    cancelClearDataset,
    confirmClearDataset,
    setTrainRatio,
    setSplitStrategy,
    setGroupField,
    setTimeField,
    setTargetField,
    setSampleUnit,
    cancelAdaptation,
    confirmAdaptation,
  };
}

export type DatasetPanelController = ReturnType<typeof useDatasetPanelController>;
