/**
 * 可比性结论与原因（模块 07）：状态用文字+徽章表达，不只靠颜色；
 * 环境差异为非阻塞提示；控制变量（数据/切分/预处理/任务/指标口径）不一致时
 * 用人话解释并阻止默认叠加。
 */
import StatusBadge from '@/components/ui/StatusBadge';
import type { ComparisonAssessmentView } from '@/utils/comparisonViewModel';

interface ComparabilitySummaryProps {
  assessment: ComparisonAssessmentView;
  selectedCount: number;
  overrideActive: boolean;
}

export default function ComparabilitySummary({ assessment, selectedCount, overrideActive }: ComparabilitySummaryProps) {
  if (selectedCount < 2) {
    return <p className="comparison-view__hint">至少选择两个 Attempt 才能对比。</p>;
  }
  if (overrideActive) {
    return (
      <div className="comparison-view__blocked">
        <StatusBadge tone="warning" label="非严格可比（已确认留痕，强制水印）" />
        <span>不可比原因：{assessment.reasons.join('；') || '未记录'}</span>
        {assessment.environmentWarnings.length > 0 && (
          <small>环境提示（不阻塞）：{assessment.environmentWarnings.join('、')}不同</small>
        )}
      </div>
    );
  }
  if (assessment.strict) {
    return (
      <div className="comparison-view__strict">
        <StatusBadge tone="success" label="严格可比（同一考卷、同一指标口径）" />
        <small>严格可比只说明控制变量一致，不自动证明差异超出 seed 方差。</small>
        {assessment.environmentWarnings.length > 0 && (
          <small>环境提示（不阻塞）：{assessment.environmentWarnings.join('、')}不同</small>
        )}
      </div>
    );
  }
  return (
    <div className="comparison-view__blocked">
      <StatusBadge tone="danger" label="已阻止跨组叠加" />
      <span>{assessment.reasons.join('；')}</span>
    </div>
  );
}
