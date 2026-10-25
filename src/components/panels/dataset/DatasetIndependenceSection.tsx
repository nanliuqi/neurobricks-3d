/**
 * 样本独立性声明区域：明确区分用户声明、系统记录与 IID 假设。
 * - 已有 sampleUnit 始终正确显示（不因 machine_verified 显示为空选择）；
 * - 修改声明仍调用既有 setSampleUnitDeclaration；UI 不得把声明升级为机器验证。
 */
import StatusBadge from '@/components/ui/StatusBadge';
import type { DatasetInfo } from '@/types/dataset';
import { INDEPENDENCE_LABELS } from '@/utils/datasetPanelViewModel';

interface DatasetIndependenceSectionProps {
  datasetInfo: DatasetInfo;
  onSetSampleUnit: (unit: string) => void;
}

export default function DatasetIndependenceSection({
  datasetInfo,
  onSetSampleUnit,
}: DatasetIndependenceSectionProps) {
  const independence = datasetInfo.sampleIndependence ?? 'iid_assumed';
  // 修复：machine_verified 状态下也展示已记录的单位值，不显示成空选择。
  const selectValue = datasetInfo.sampleUnit ?? '';

  return (
    <section className="dataset-wb-section" aria-label="样本独立性声明">
      <h4 className="dataset-wb-section__title">样本独立性声明</h4>

      <div className="dataset-wb-task-status">
        <StatusBadge
          tone={independence === 'machine_verified' ? 'success' : independence === 'user_declared' ? 'info' : 'neutral'}
          label={INDEPENDENCE_LABELS[independence]}
        />
      </div>

      <label className="dataset-wb-label" htmlFor="dataset-sample-unit">独立样本单位</label>
      <select
        id="dataset-sample-unit"
        className="dataset-wb-select"
        aria-label="独立样本单位"
        value={selectValue}
        onChange={event => onSetSampleUnit(event.target.value)}
      >
        <option value="">未声明（仅 IID 假设）</option>
        {datasetInfo.type === 'csv' ? (
          <>
            <option value="row">每行记录</option>
            <option value="customer">客户</option>
            <option value="device">设备</option>
            <option value="time_window">时间窗口</option>
          </>
        ) : (
          <>
            <option value="image">单张图片</option>
            <option value="part">零件/对象</option>
            <option value="batch">采集批次</option>
            <option value="customer">客户</option>
            <option value="device">设备</option>
          </>
        )}
      </select>

      <p className="dataset-wb-note">
        {datasetInfo.sampleIndependence === 'user_declared' || datasetInfo.sampleIndependence === 'machine_verified'
          ? datasetInfo.sampleUnitDeclaration ?? '未记录'
          : '系统只能验证文件与分组语法，业务独立性由声明者负责。'}
      </p>
      {independence === 'machine_verified' && (
        <p className="dataset-wb-note">
          机器记录仅证明系统按协议写入了该状态，不代表系统理解了全部业务语义；
          修改上方声明会把状态更新为“用户声明”。
        </p>
      )}
    </section>
  );
}
