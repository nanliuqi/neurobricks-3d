/**
 * 表格回归任务契约：显式选择目标列的纪律展示。
 * - 不自动猜测目标列、不默认选择末列；未选择时显示待办状态；
 * - 有效特征列数量标注为“按当前配置推导”，与训练端口径保持同源规则，不做最终断言；
 * - 非数值特征列用 Alert 明确告警（与模块 04 Preflight 阻断口径一致）。
 */
import Alert from '@/components/ui/Alert';
import StatusBadge from '@/components/ui/StatusBadge';
import type { DatasetInfo } from '@/types/dataset';

interface DatasetTaskContractSectionProps {
  datasetInfo: DatasetInfo;
  targetField: string | null;
  featureFields: string[] | undefined;
  nonNumericFeatureColumns: string[];
  onSetTargetField: (field: string | null) => void;
}

export default function DatasetTaskContractSection({
  datasetInfo,
  targetField,
  featureFields,
  nonNumericFeatureColumns,
  onSetTargetField,
}: DatasetTaskContractSectionProps) {
  if (datasetInfo.type !== 'csv' || !datasetInfo.columns || datasetInfo.columns.length === 0) {
    return null;
  }

  return (
    <section className="dataset-wb-section" aria-label="回归任务契约">
      <h4 className="dataset-wb-section__title">回归任务契约</h4>

      <div className="dataset-wb-task-status">
        {targetField ? (
          <StatusBadge tone="success" label="监督式回归 · 目标列已确认" />
        ) : (
          <StatusBadge tone="warning" label="待办：请确认回归目标列" />
        )}
      </div>

      <label className="dataset-wb-label" htmlFor="dataset-target-field">回归目标列（必须确认）</label>
      <select
        id="dataset-target-field"
        className="dataset-wb-select"
        aria-label="回归目标列"
        value={targetField ?? ''}
        onChange={event => onSetTargetField(event.target.value || null)}
      >
        <option value="">请选择目标列（不会默认取末列）</option>
        {datasetInfo.columns.map(column => (
          <option key={column} value={column}>{column}</option>
        ))}
      </select>

      <p className="dataset-wb-note">
        {targetField
          ? `已确认目标：${targetField}。`
          : '未确认目标前禁止训练，避免把普通特征静默当作标签。'}
      </p>

      {targetField && datasetInfo.nonNumericColumns?.includes(targetField) && (
        <Alert tone="danger" title="目标列不能作为数值回归目标">
          目标列“{targetField}”含缺失、文本或日期，不能作为数值回归目标。
        </Alert>
      )}

      {targetField && featureFields && (
        <div className="dataset-wb-feature-summary">
          <p className="dataset-wb-note">
            有效特征列（按当前配置推导）：<strong>{featureFields.length} 列</strong>
          </p>
          {featureFields.length > 0 && (
            <p className="dataset-wb-note dataset-wb-note--mono" title={featureFields.join('、')}>
              特征：{featureFields.join('、')}
            </p>
          )}
        </div>
      )}

      {nonNumericFeatureColumns.length > 0 && (
        <Alert tone="warning" title="特征列含非数值列，将阻止当前回归训练">
          CSV 列 {nonNumericFeatureColumns.join('、')} 含文本/日期，不能直接进入 MLP；
          请将其选为 group/time 切分字段，或先在源数据中完成数值编码。
        </Alert>
      )}
    </section>
  );
}
