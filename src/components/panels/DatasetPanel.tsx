import type { CSSProperties } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useDatasetPanelController } from './dataset/useDatasetPanelController';
import DatasetSourceSection from './dataset/DatasetSourceSection';
import DatasetSummaryCard from './dataset/DatasetSummaryCard';
import DatasetTaskContractSection from './dataset/DatasetTaskContractSection';
import DatasetSplitSection from './dataset/DatasetSplitSection';
import DatasetIndependenceSection from './dataset/DatasetIndependenceSection';
import DatasetMachineChecks from './dataset/DatasetMachineChecks';
import DatasetPreviewTable from './dataset/DatasetPreviewTable';
import DatasetAdaptationDialog from './dataset/DatasetAdaptationDialog';

interface DatasetPanelProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * 数据集工作台：模块 05 重构后的组装外壳。
 * 本组件只负责：读取控制层状态、组合各职责子模块、保持外部接口
 * （className/style 透传、无固定宽度、无自渲染标题）兼容。
 * 全部交互状态机在 useDatasetPanelController，业务规则在纯函数视图模型；
 * 训练是否可启动仍由模块 04 统一 Preflight 裁决，本面板不复制阻断器。
 */
export default function DatasetPanel({ className, style }: DatasetPanelProps) {
  const controller = useDatasetPanelController();
  const { datasetInfo } = controller;
  const previewRowCount = datasetInfo?.previewRows?.length ?? 0;

  return (
    <div className={['dataset-panel', className].filter(Boolean).join(' ')} style={style}>
      <DatasetSourceSection
        builtinValue={controller.builtinValue}
        hasDataset={datasetInfo !== null}
        importPhase={controller.importPhase}
        onSelectBuiltin={controller.selectBuiltin}
        onImportImages={controller.importImages}
        onImportCsv={controller.importCsv}
        onExcelBoundary={controller.showExcelBoundary}
        onRequestClear={controller.requestClearDataset}
      />

      <DatasetSummaryCard summaryView={controller.summaryView} />

      {datasetInfo && (
        <>
          <DatasetTaskContractSection
            datasetInfo={datasetInfo}
            targetField={controller.targetField}
            featureFields={controller.featureFields}
            nonNumericFeatureColumns={controller.nonNumericFeatureColumns}
            onSetTargetField={controller.setTargetField}
          />

          <DatasetSplitSection
            datasetInfo={datasetInfo}
            trainRatio={controller.trainRatio}
            splitStrategy={controller.splitStrategy}
            groupField={controller.groupField}
            timeField={controller.timeField}
            targetField={controller.targetField}
            onSetTrainRatio={controller.setTrainRatio}
            onSetSplitStrategy={controller.setSplitStrategy}
            onSetGroupField={controller.setGroupField}
            onSetTimeField={controller.setTimeField}
          />

          <DatasetIndependenceSection
            datasetInfo={datasetInfo}
            onSetSampleUnit={controller.setSampleUnit}
          />

          <DatasetMachineChecks datasetInfo={datasetInfo} />

          <DatasetPreviewTable
            tableView={controller.previewTableView}
            caption={previewRowCount > 0 ? `数据预览（前 ${previewRowCount} 行）` : '数据预览'}
          />
        </>
      )}

      {/* 安全清除：占位下拉项不承担删除；确认文案明确不动磁盘文件与历史档案 */}
      {controller.clearDialogOpen && (
        <ConfirmDialog
          title="清除当前数据集？"
          tone="danger"
          confirmLabel="确认清除"
          onCancel={controller.cancelClearDataset}
          onConfirm={controller.confirmClearDataset}
          description={
            <ul className="dataset-wb-clear-dialog__list">
              <li>将清除当前数据集选择。</li>
              <li>将清除与该数据集关联的目标列和切分字段选择。</li>
              <li>不会删除你磁盘上的原始文件。</li>
              <li>不会删除已有 Study、Attempt 或审计记录。</li>
            </ul>
          }
        />
      )}

      {/* 网络适配确认：确认时控制层基于当前模型重算并校验上下文 */}
      {controller.adaptation && (
        <DatasetAdaptationDialog
          plan={controller.adaptation}
          onConfirm={controller.confirmAdaptation}
          onCancel={controller.cancelAdaptation}
        />
      )}
    </div>
  );
}
