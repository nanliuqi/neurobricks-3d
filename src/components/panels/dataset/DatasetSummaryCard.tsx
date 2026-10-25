/**
 * 数据集摘要与身份：只陈述元数据真正知道的事实。
 * - 指纹缺失时诚实提示“身份信息不完整”，不得伪造；
 * - “已导入”不等于“已验证”；未知字段显示“未记录”。
 */
import EmptyState from '@/components/ui/EmptyState';
import Tooltip from '@/components/ui/Tooltip';
import type { DatasetSummaryView } from '@/utils/datasetPanelViewModel';
import { DatabaseIcon } from './datasetIcons';

interface DatasetSummaryCardProps {
  summaryView: DatasetSummaryView | null;
}

export default function DatasetSummaryCard({ summaryView }: DatasetSummaryCardProps) {
  if (!summaryView) {
    return (
      <EmptyState
        icon={<DatabaseIcon size={22} />}
        title="尚未选择数据集"
        description="请先选择内置数据集、导入图片目录或 CSV 文件。"
        className="dataset-wb-empty"
      />
    );
  }

  return (
    <section className="dataset-wb-section dataset-wb-summary" aria-label="数据集摘要">
      <h4 className="dataset-wb-section__title">数据集摘要</h4>
      <strong className="dataset-wb-summary__name" title={summaryView.name}>{summaryView.name}</strong>
      <dl className="dataset-wb-summary__list">
        <div className="dataset-wb-summary__row">
          <dt>类型</dt>
          <dd>{summaryView.typeLabel}</dd>
        </div>
        <div className="dataset-wb-summary__row">
          <dt>样本数</dt>
          <dd>{summaryView.sampleCountText}</dd>
        </div>
        <div className="dataset-wb-summary__row">
          <dt>任务</dt>
          <dd>{summaryView.taskLine}</dd>
        </div>
        {summaryView.inputText && (
          <div className="dataset-wb-summary__row">
            <dt>{summaryView.taskState === 'classification' ? '输入形状' : '表格规模'}</dt>
            <dd>{summaryView.inputText}</dd>
          </div>
        )}
        <div className="dataset-wb-summary__row">
          <dt>导入时间</dt>
          <dd>{summaryView.importedAtText}</dd>
        </div>
        <div className="dataset-wb-summary__row">
          <dt>内容指纹</dt>
          <dd>
            {summaryView.fingerprintShort ? (
              <Tooltip content={`完整指纹：${summaryView.fingerprintFull}`}>
                <code className="dataset-wb-summary__fingerprint">{summaryView.fingerprintShort}</code>
              </Tooltip>
            ) : (
              <span className="dataset-wb-summary__fingerprint-missing">
                身份信息不完整，不能进入严格可比组
              </span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
