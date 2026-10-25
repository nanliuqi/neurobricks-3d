/**
 * 网络自动适配确认框（替代 window.confirm）：
 * - 展示适配原因、当前模型规格、数据要求规格与将被修改的层摘要；
 * - 当前模型规格与修改摘要始终基于最新 layer store 渲染（弹窗期间的手动编辑可见）；
 * - 差异预览计算失败时降级展示，不让整个面板白屏，也不虚假宣称“已匹配”；
 * - 确认/取消语义由控制层处理：确认时会再次安全计算与上下文校验。
 */
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useLayerStore } from '@/stores/useLayerStore';
import { adaptLayersForCsvRegression, adaptLayersToInputShape } from '@/utils/shapeInference';
import { getErrorMessage } from '@/utils/errorMessage';
import type { AdaptationPlan } from './useDatasetPanelController';

interface DatasetAdaptationDialogProps {
  plan: AdaptationPlan;
  onConfirm: () => void;
  onCancel: () => void;
}

interface AdaptationPreview {
  currentSpec: string;
  changes: string[];
  /** 预览计算失败时的降级说明；存在时不得展示“已匹配”。 */
  previewError: string | null;
}

/** 将被修改的层摘要（纯展示用；确认时控制层会基于当前模型重算并再次校验）。 */
function describeChanges(plan: AdaptationPlan): AdaptationPreview {
  try {
    const layers = useLayerStore.getState().layers;
    const featureCount = plan.csvRegression ? plan.context.featureCount : plan.targetShape[2];
    const adapted = plan.csvRegression
      ? adaptLayersForCsvRegression(layers, featureCount)
      : adaptLayersToInputShape(layers, plan.targetShape);

    const inputLayer = layers.find(layer => layer.type === 'Input');
    const currentSpec = inputLayer
      ? `${inputLayer.params.inChannels ?? '?'}×${inputLayer.params.inputHeight ?? '?'}×${inputLayer.params.inputWidth ?? '?'}`
      : '未记录';

    const changes: string[] = [];
    adapted.forEach((layer, index) => {
      const original = layers[index];
      if (!original) return;
      const keys = new Set([...Object.keys(layer.params ?? {}), ...Object.keys(original.params ?? {})]);
      const diffs: string[] = [];
      keys.forEach(key => {
        const nextValue = (layer.params ?? {})[key as keyof typeof layer.params];
        const prevValue = (original.params ?? {})[key as keyof typeof original.params];
        if (JSON.stringify(nextValue) !== JSON.stringify(prevValue)) {
          diffs.push(`${key}: ${prevValue ?? '未设置'} → ${nextValue ?? '未设置'}`);
        }
      });
      if (diffs.length > 0) {
        changes.push(`第 ${index + 1} 层 ${layer.type}：${diffs.join('；')}`);
      }
    });

    return { currentSpec, changes, previewError: null };
  } catch (error) {
    // 异常参数/算法抛错：降级展示，不虚假宣称已匹配；确认动作仍会再次安全计算。
    return { currentSpec: '未记录', changes: [], previewError: getErrorMessage(error) };
  }
}

export default function DatasetAdaptationDialog({ plan, onConfirm, onCancel }: DatasetAdaptationDialogProps) {
  // 订阅 layers：弹窗打开期间用户手动编辑网络时，摘要随之更新，不用旧快照展示。
  useLayerStore(state => state.layers);
  const { currentSpec, changes, previewError } = describeChanges(plan);

  return (
    <ConfirmDialog
      title="检测到网络与数据集不匹配，是否自动适配？"
      tone="warning"
      confirmLabel="应用适配"
      cancelLabel="保留当前网络"
      onCancel={onCancel}
      onConfirm={onConfirm}
      description={
        <div className="dataset-wb-adapt-dialog">
          <p><strong>原因：</strong>{plan.reason}</p>
          <p><strong>数据集：</strong>{plan.datasetName}</p>
          <p><strong>当前模型输入：</strong>{currentSpec}</p>
          <p><strong>数据要求输入：</strong>{plan.targetLabel}</p>
          {plan.csvRegression && <p><strong>回归输出：</strong>最后一个 Linear 层将设为单值输出（outFeatures=1）。</p>}
          <div className="dataset-wb-adapt-dialog__changes">
            <strong>将被修改的层：</strong>
            {previewError ? (
              <p>适配预览暂时无法计算（{previewError}）；确认时会再次安全计算，计算失败不会修改网络。</p>
            ) : changes.length > 0 ? (
              <ul>
                {changes.map(change => <li key={change}>{change}</li>)}
              </ul>
            ) : (
              <p>当前网络已匹配，无需修改。</p>
            )}
          </div>
        </div>
      }
    />
  );
}
