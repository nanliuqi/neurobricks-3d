/**
 * 非严格对比确认框（模块 07）：
 * - 列出精确 Attempt 集合、每一项不可比原因、强制水印与审计留痕后果；
 * - busy 期间由 ConfirmDialog 既有语义阻断 Escape/背景点击/重复 Enter；
 * - 确认处理器由控制层复核冻结上下文，双击由同步锁保证只写一次事件。
 */
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { COMPARISON_WATERMARK } from '@/utils/comparability';
import type { OverrideContext } from '@/utils/comparisonViewModel';

interface ComparisonOverrideDialogProps {
  context: OverrideContext;
  fingerprint: string;
  attemptLabels: string[];
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ComparisonOverrideDialog({
  context,
  fingerprint,
  attemptLabels,
  confirming,
  onCancel,
  onConfirm,
}: ComparisonOverrideDialogProps) {
  return (
    <ConfirmDialog
      title="确认进行非严格对比？"
      tone="danger"
      busy={confirming}
      confirmLabel="仍然显示并留痕"
      onCancel={onCancel}
      onConfirm={onConfirm}
      description={
        <div className="comparison-view__override-dialog">
          <p>这些结果不可严格比较：{context.reasons.join('、')}。</p>
          <p>精确 Attempt 集合（{context.attemptIds.length} 条）：</p>
          <ul>
            {attemptLabels.map(label => <li key={label}>{label}</li>)}
          </ul>
          <p>指标视图：{context.metricSemantics}（切换指标或增删 Attempt 后本确认失效，需重新确认）。</p>
          <p>
            确认后会永久写入越界记录（比较指纹 {fingerprint.slice(-12)}），
            当前曲线和导出报告都会强制显示“{COMPARISON_WATERMARK}”水印；
            只有审计事件成功持久化后才会展示非严格曲线。
          </p>
        </div>
      }
    />
  );
}
