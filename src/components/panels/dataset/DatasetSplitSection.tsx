/**
 * 划分契约区域：
 * - 内置数据集显示官方预定义划分，不提供看似可编辑、实际不生效的比例控件；
 * - 自定义数据展示开发池/封存测试集的“计划比例”，明确实际分配将在训练归档中记录；
 * - 切分策略与字段选择的展示语义沿用既有规则，不修改持久化结构与真实切分算法。
 */
import StatusBadge from '@/components/ui/StatusBadge';
import { LOCAL_IMAGE_PARENT_GROUP_FIELD, type DatasetInfo } from '@/types/dataset';
import { isBuiltinDatasetType } from '@/utils/datasetPanelViewModel';

interface DatasetSplitSectionProps {
  datasetInfo: DatasetInfo;
  trainRatio: number;
  splitStrategy: 'random' | 'group' | 'temporal';
  groupField: string | null;
  timeField: string | null;
  targetField: string | null;
  onSetTrainRatio: (ratio: number) => void;
  onSetSplitStrategy: (strategy: 'random' | 'group' | 'temporal') => void;
  onSetGroupField: (field: string | null) => void;
  onSetTimeField: (field: string | null) => void;
}

export default function DatasetSplitSection({
  datasetInfo,
  trainRatio,
  splitStrategy,
  groupField,
  timeField,
  targetField,
  onSetTrainRatio,
  onSetSplitStrategy,
  onSetGroupField,
  onSetTimeField,
}: DatasetSplitSectionProps) {
  const isBuiltin = isBuiltinDatasetType(datasetInfo.type);
  const isCsv = datasetInfo.type === 'csv';

  return (
    <section className="dataset-wb-section" aria-label="划分契约">
      <h4 className="dataset-wb-section__title">划分契约</h4>

      {isBuiltin ? (
        <div className="dataset-wb-split-predefined">
          <StatusBadge tone="info" label="官方预定义 train/test 切分" />
          <p className="dataset-wb-note">
            内置数据集使用 TorchVision 官方划分，不可修改；开发池内部的验证比例在训练高级配置中设置。
          </p>
        </div>
      ) : (
        <div className="dataset-wb-split-ratio">
          <label className="dataset-wb-label" htmlFor="dataset-train-ratio">
            开发池（训练+验证）：{Math.round(trainRatio * 100)}% · 封存测试：{Math.round((1 - trainRatio) * 100)}%
          </label>
          <input
            id="dataset-train-ratio"
            type="range"
            min="0.5"
            max="0.9"
            step="0.05"
            value={trainRatio}
            onChange={event => onSetTrainRatio(Number(event.target.value))}
          />
          <div className="dataset-wb-split-ratio__scale" aria-hidden="true">
            <span>50%</span>
            <span>90%</span>
          </div>
          <p className="dataset-wb-note">
            这是计划比例，不是实际样本分配；实际分配将在训练归档中记录。
            训练过程内部的 validation split 由训练参数管理，不等同于封存测试集。
          </p>
        </div>
      )}

      <label className="dataset-wb-label" htmlFor="dataset-split-strategy">划分策略</label>
      <select
        id="dataset-split-strategy"
        className="dataset-wb-select"
        aria-label="划分策略"
        value={isBuiltin ? 'predefined' : splitStrategy}
        disabled={isBuiltin}
        onChange={event => onSetSplitStrategy(event.target.value as 'random' | 'group' | 'temporal')}
      >
        {isBuiltin && <option value="predefined">官方预定义 train/test 切分</option>}
        {!isBuiltin && <option value="random">固定 seed 随机切分</option>}
        {!isBuiltin && (
          <option
            value="group"
            disabled={!isCsv && !(datasetInfo.type === 'local_image' && datasetInfo.imageGroup?.available)}
          >
            按分组隔离
          </option>
        )}
        {!isBuiltin && (
          <option value="temporal" disabled={!isCsv}>
            按时间先后{!isCsv ? '（仅 CSV）' : ''}
          </option>
        )}
      </select>

      {/* 本地图片 group：受控字段由导入元数据决定 */}
      {datasetInfo.type === 'local_image' && splitStrategy === 'group' && datasetInfo.imageGroup?.available && (
        <div className="dataset-wb-info-box">
          分组字段：{datasetInfo.imageGroup.label} · {datasetInfo.imageGroup.distinctCount} 组
          <br />
          同名子目录跨类别视为同一组，整个组只会进入训练、验证、测试中的一个集合。
          {groupField === LOCAL_IMAGE_PARENT_GROUP_FIELD && '（当前已绑定受控字段）'}
        </div>
      )}
      {datasetInfo.type === 'local_image' && splitStrategy === 'group' && datasetInfo.imageGroup?.readinessWarning && (
        <div role="alert" className="dataset-wb-alert-inline dataset-wb-alert-inline--warning">
          {datasetInfo.imageGroup.readinessWarning}
        </div>
      )}
      {datasetInfo.type === 'local_image' && !datasetInfo.imageGroup?.available && (
        <p className="dataset-wb-note dataset-wb-note--warning">
          group 不可用：{datasetInfo.imageGroup?.unavailableReason ?? '该记录缺少目录分组元数据，请重新导入数据集。'}
        </p>
      )}
      {datasetInfo.type === 'local_image' && (
        <p className="dataset-wb-note">
          temporal 仅在 CSV 存在真实时间字段时开放；文件修改时间不代表业务时间，不用于可信切分。
        </p>
      )}

      {/* CSV group/time 字段：选项不含目标列 */}
      {isCsv && splitStrategy === 'group' && (
        <>
          <label className="dataset-wb-label" htmlFor="dataset-group-field">分组字段</label>
          <select
            id="dataset-group-field"
            className="dataset-wb-select"
            aria-label="分组字段"
            value={groupField ?? ''}
            onChange={event => onSetGroupField(event.target.value || null)}
          >
            <option value="">选择 group 字段</option>
            {datasetInfo.columns?.filter(column => column !== targetField).map(column => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
          {!groupField && (
            <StatusBadge tone="warning" label="待办：请选择分组字段" className="dataset-wb-todo" />
          )}
        </>
      )}
      {isCsv && splitStrategy === 'temporal' && (
        <>
          <label className="dataset-wb-label" htmlFor="dataset-time-field">时间字段</label>
          <select
            id="dataset-time-field"
            className="dataset-wb-select"
            aria-label="时间字段"
            value={timeField ?? ''}
            onChange={event => onSetTimeField(event.target.value || null)}
          >
            <option value="">选择时间字段</option>
            {datasetInfo.columns?.filter(column => column !== targetField).map(column => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
          {!timeField && (
            <StatusBadge tone="warning" label="待办：请选择时间字段" className="dataset-wb-todo" />
          )}
          <p className="dataset-wb-note">
            temporal 切分按时间先后划分（先训练后测试），用于暴露分布漂移；不得随机混排。
          </p>
        </>
      )}
    </section>
  );
}
