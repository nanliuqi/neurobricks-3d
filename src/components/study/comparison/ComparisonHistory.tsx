/**
 * 既有非严格对比留痕（模块 07）：
 * - 只列出通过恢复校验的精确 override（Study 归属 + 集合 + 水印 + 指纹）；
 * - 结构异常事件失败关闭并显示档案异常提示，不静默采信；
 * - 与当前选择精确匹配的历史 override 标注“对当前选择生效”。
 */
import Alert from '@/components/ui/Alert';
import type { RestoredOverride } from '@/utils/comparisonViewModel';

interface ComparisonHistoryProps {
  restored: { valid: RestoredOverride[]; anomalies: string[] };
  activeEventId: string | null;
}

export default function ComparisonHistory({ restored, activeEventId }: ComparisonHistoryProps) {
  if (restored.valid.length === 0 && restored.anomalies.length === 0) return null;

  return (
    <section className="comparison-view__history" aria-label="非严格对比留痕">
      <strong>非严格对比留痕（精确 Attempt 集合，不作用于其他对比）</strong>
      {restored.anomalies.length > 0 && (
        <Alert tone="warning" title="历史越界记录存在档案异常">
          {restored.anomalies.join('；')}。异常事件已失败关闭，不参与恢复。
        </Alert>
      )}
      {restored.valid.length > 0 && (
        <ul>
          {restored.valid.map(item => (
            <li key={item.eventId}>
              {new Date(item.occurredAt).toLocaleString()} · Attempt 集合 [{item.attemptIds.join(', ')}]
              {item.reasons.length > 0 && ` · 原因：${item.reasons.join('、')}`}
              {item.fingerprint && ` · 指纹 …${item.fingerprint.slice(-12)}`}
              {activeEventId === item.eventId && ' ·（对当前选择生效）'}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
