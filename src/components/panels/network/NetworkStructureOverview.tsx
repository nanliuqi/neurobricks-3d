import { useMemo } from 'react';
import EmptyState from '@/components/ui/EmptyState';
import { useLayerStore } from '@/stores/useLayerStore';
import {
  ERROR_DETAIL_MISSING_TEXT,
  PARAM_COUNT_UNAVAILABLE_TEXT,
  buildNetworkStructureViewModel,
  type NetworkStructureRow,
} from '@/utils/networkStructureViewModel';

/**
 * 逐层结构清单：当前编辑中网络的**静态结构视图**，不是前向执行结果、特征图或性能证据。
 * 只读投影 + 选中联动：行按钮仅调用既有 setSelectedId，不写参数、不重算、不启动训练。
 */
export default function NetworkStructureOverview() {
  const layers = useLayerStore(state => state.layers);
  const validationResult = useLayerStore(state => state.validationResult);
  const selectedId = useLayerStore(state => state.selectedId);
  const setSelectedId = useLayerStore(state => state.setSelectedId);

  const model = useMemo(
    () => buildNetworkStructureViewModel({ layers, validationResult }),
    [layers, validationResult],
  );

  return (
    <section
      className="network-structure"
      aria-labelledby="network-structure-heading"
    >
      <div className="network-structure__header">
        <h3 id="network-structure-heading" className="network-structure__heading">
          网络结构
        </h3>
        <span className="network-structure__count">{model.layerCount} 层</span>
      </div>
      <p className="network-structure__note">
        三维按 [C, H, W] 展示，一维为特征维，均不含 batch。
        以下为静态推导与已记录校验，不替代训练前检查，也不代表真实运行结果。
      </p>

      {model.isEmpty ? (
        <EmptyState
          className="network-structure__empty"
          title="网络为空"
          description="从左侧模型库添加层后，这里按网络顺序显示逐层结构。"
        />
      ) : (
        <ul className="network-structure__list">
          {model.rows.map(row => (
            <li key={row.id}>
              <StructureRowButton
                row={row}
                selected={row.id === selectedId}
                onSelect={setSelectedId}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface StructureRowButtonProps {
  row: NetworkStructureRow;
  selected: boolean;
  onSelect: (id: string) => void;
}

function StructureRowButton({ row, selected, onSelect }: StructureRowButtonProps) {
  const classNames = ['network-structure__row'];
  if (selected) classNames.push('network-structure__row--selected');
  if (row.hasRecordedError) classNames.push('network-structure__row--error');
  else if (row.upstreamHasError) classNames.push('network-structure__row--downstream-of-error');

  return (
    <button
      type="button"
      className={classNames.join(' ')}
      aria-pressed={selected}
      onClick={() => onSelect(row.id)}
    >
      <span className="network-structure__row-title">
        第 {row.index} 层 · {row.label}
      </span>
      {row.description && (
        <span className="network-structure__description">{row.description}</span>
      )}
      <span className="network-structure__line">
        上游已记录输出：{row.upstreamText}
      </span>
      <span className="network-structure__line">
        推导输出：{row.outputText}
      </span>
      <span className="network-structure__line">
        参数量：{row.paramCountText ?? PARAM_COUNT_UNAVAILABLE_TEXT}
      </span>
      <span className={`network-structure__status network-structure__status--${row.statusKind}`}>
        {row.statusText}
      </span>
      {row.upstreamHasError && (
        <span className="network-structure__caveat">
          上游已记录错误，本行推导结果仅供定位参考
        </span>
      )}
      {row.errorMessages.map(message => (
        <span key={`msg-${message}`} className="network-structure__error">
          {message}
        </span>
      ))}
      {row.errorDetailMissing && (
        <span className="network-structure__error">{ERROR_DETAIL_MISSING_TEXT}</span>
      )}
      {row.suggestions.map(suggestion => (
        <span key={`tip-${suggestion}`} className="network-structure__suggestion">
          💡 {suggestion}
        </span>
      ))}
    </button>
  );
}
