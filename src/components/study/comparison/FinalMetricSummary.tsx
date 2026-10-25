/**
 * 最终指标语义化表格（模块 07；M07-002~015 截图修复）：图表之外提供读屏与精确数值审查入口。
 * 指标缺失/NaN/Infinity 显示“指标不可用”；不把所有未知指标标成 Accuracy。
 * 新增：有效点数独立成列；恰好两条 ok 序列且指标一致时展示真实最终差值
 * （原始数值 + accuracy 百分点等价），差值只是事实陈述，不生成趋势/稳定/因果/最佳语言。
 */
import type { Attempt } from '@/types/experiment';
import type { StrictSeriesResult } from '@/utils/metricSeries';
import { strictFinalDifference } from '@/utils/comparisonViewModel';
import { executionTrustLabel, metricNameLabel } from '@/components/panels/study/studyLabels';

interface FinalMetricSummaryProps {
  selected: Attempt[];
  series: StrictSeriesResult[];
  taskType: string;
  experimentNameOf: (attempt: Attempt) => string;
}

export default function FinalMetricSummary({ selected, series, taskType, experimentNameOf }: FinalMetricSummaryProps) {
  const difference = strictFinalDifference(selected, series);
  const signedText = difference
    ? `${difference.difference >= 0 ? '+' : '\u2212'}${Math.abs(difference.difference).toFixed(6)}`
    : '';
  // 百分点等价只对明确的比例指标 accuracy 给出；其他指标不做单位猜测。
  const percentagePointText = difference && difference.metricName === 'accuracy'
    ? `（accuracy 折合 ${(difference.absoluteDifference * 100).toFixed(2)} 个百分点）`
    : '';
  return (
    <table className="comparison-view__table">
      <caption>最终验证指标（严格序列的最后一条合法记录）</caption>
      <thead>
        <tr>
          <th scope="col">实验</th>
          <th scope="col">Attempt</th>
          <th scope="col">seed</th>
          <th scope="col">执行信任</th>
          <th scope="col">指标</th>
          <th scope="col">最终值</th>
          <th scope="col">epoch 覆盖</th>
          <th scope="col">有效点数</th>
        </tr>
      </thead>
      <tbody>
        {selected.map((attempt, index) => {
          const result = series[index];
          const ok = result?.ok === true;
          const points = ok ? result.points : [];
          const last = points[points.length - 1];
          return (
            <tr key={attempt.id}>
              <td>{experimentNameOf(attempt)}</td>
              <td>#{attempt.ordinal}</td>
              <td>{attempt.config.seed ?? '未固定'}</td>
              <td>{executionTrustLabel(attempt.provenance.executionTrust)}</td>
              <td>{ok ? metricNameLabel(result.metricName, taskType) : '指标不可用'}</td>
              <td>{ok && last ? last.value.toFixed(6) : '指标不可用'}</td>
              <td>{ok && points.length > 0 ? `${points[0].epoch}～${points[points.length - 1].epoch}` : '—'}</td>
              <td>{ok ? `${points.length} 点` : '—'}</td>
            </tr>
          );
        })}
      </tbody>
      {difference && (
        <tfoot>
          <tr>
            <td colSpan={8} className="comparison-view__difference">
              真实差值（Attempt #{difference.left.ordinal} 最终值 {difference.left.value.toFixed(6)}（epoch {difference.left.epoch}）
              → Attempt #{difference.right.ordinal} 最终值 {difference.right.value.toFixed(6)}（epoch {difference.right.epoch}））：
              {signedText}{percentagePointText}。
              差值只代表两次最终值的数值差异，不构成趋势、稳定提升或因果结论；
              方差资格以上方徽章为准（单 seed 时未验证方差）。
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
