import { useMemo, type CSSProperties } from 'react';
import ResultReadingGuide from '@/components/training/ResultReadingGuide';
import { TRAINING_CHART_READING_TOPIC_IDS } from '@/content/resultInterpretation';
import type { TrainMetric } from '@/types/training';
import { formatStrictMetricValue } from '@/utils/metricSeries';
import {
  projectTrainingChart,
  type TrainingChartMetricMode,
  type TrainingChartPoint,
  type TrainingChartSeries,
} from '@/utils/trainingMonitorViewModel';

export interface TrainingMetricChartProps {
  metrics: readonly TrainMetric[];
  evidenceLabel: string;
  metricValueMode?: TrainingChartMetricMode;
  className?: string;
  style?: CSSProperties;
}

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 260;
const PADDING = { top: 24, right: 48, bottom: 34, left: 50 };

function numericRange(values: number[], preferred?: { min: number; max: number }): { min: number; max: number } {
  if (preferred) return preferred;
  if (values.length === 0) return { min: 0, max: 1 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.1, 0.1);
    min -= padding;
    max += padding;
  } else {
    const padding = (max - min) * 0.08;
    min -= padding;
    max += padding;
  }
  return { min, max };
}

function linePoints(
  points: TrainingChartPoint[],
  xRange: { min: number; max: number },
  yRange: { min: number; max: number },
): string {
  const plotWidth = VIEW_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = VIEW_HEIGHT - PADDING.top - PADDING.bottom;
  const xSpan = Math.max(xRange.max - xRange.min, 1);
  const ySpan = Math.max(yRange.max - yRange.min, Number.EPSILON);
  return points.map(point => {
    const x = PADDING.left + ((point.x - xRange.min) / xSpan) * plotWidth;
    const y = PADDING.top + (1 - ((point.value - yRange.min) / ySpan)) * plotHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function latestPoint(series: TrainingChartSeries): TrainingChartPoint | null {
  return series.points[series.points.length - 1] ?? null;
}

/**
 * 无第三方依赖的 SVG 曲线。train/batch 与 validation/epoch 始终分线，
 * 缺失 split/scope/metricName 的记录不会被猜成 Accuracy 或最终验证结果。
 */
export default function TrainingMetricChart({ metrics, evidenceLabel, metricValueMode = 'diagnostic', className, style }: TrainingMetricChartProps) {
  const chart = useMemo(() => projectTrainingChart(metrics, metricValueMode), [metricValueMode, metrics]);
  const allPoints = chart.series.flatMap(series => series.points);
  const xRange = numericRange(allPoints.map(point => point.x));
  const lossValues = chart.series
    .filter(series => series.axis === 'loss')
    .flatMap(series => series.points.map(point => point.value));
  const metricValues = chart.series
    .filter(series => series.axis === 'metric')
    .flatMap(series => series.points.map(point => point.value));
  const lossRange = numericRange(lossValues, lossValues.length > 0 && lossValues.every(value => value >= 0)
    ? { min: 0, max: Math.max(...lossValues, 0.1) }
    : undefined);
  const metricRange = numericRange(metricValues, chart.metricName === 'accuracy' ? { min: 0, max: 1 } : undefined);
  const ariaSummary = chart.series.length === 0
    ? `${evidenceLabel}：没有具备明确作用域和有限数值的数据点。`
    : `${evidenceLabel}：${chart.series.map(series => `${series.label}${series.points.length}点`).join('，')}。`;

  return (
    <section
      className={['training-chart', className].filter(Boolean).join(' ')}
      style={style}
      aria-label={evidenceLabel}
      data-testid="training-chart"
    >
      <div className="training-chart__meta">
        <span>{evidenceLabel}</span>
        <span>{chart.pointCount} 个可解释点</span>
      </div>

      {chart.series.length === 0 ? (
        <div className="training-chart__empty" role="status">
          暂无可绘制曲线。记录必须明确标注 train/batch 或 validation/epoch；主指标还需提供 metricName 与有限数值。
        </div>
      ) : (
        <svg
          className="training-chart__svg"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={ariaSummary}
        >
          <rect className="training-chart__background" x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} rx="6" />
          {[0, 1, 2, 3, 4].map(index => {
            const y = PADDING.top + ((VIEW_HEIGHT - PADDING.top - PADDING.bottom) / 4) * index;
            return <line key={index} className="training-chart__grid" x1={PADDING.left} y1={y} x2={VIEW_WIDTH - PADDING.right} y2={y} />;
          })}
          {chart.series.map(series => {
            const range = series.axis === 'loss' ? lossRange : metricRange;
            const points = linePoints(series.points, xRange, range);
            if (series.points.length === 1) {
              const [cx, cy] = points.split(',');
              return (
                <circle
                  key={series.key}
                  className={`training-chart__line training-chart__line--${series.key}`}
                  cx={cx}
                  cy={cy}
                  r="3"
                />
              );
            }
            return (
              <polyline
                key={series.key}
                className={`training-chart__line training-chart__line--${series.key}`}
                points={points}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {lossValues.length > 0 && (
            <>
              <text className="training-chart__axis-label" x={PADDING.left - 6} y={PADDING.top + 4} textAnchor="end">{lossRange.max.toFixed(3)}</text>
              <text className="training-chart__axis-label" x={PADDING.left - 6} y={VIEW_HEIGHT - PADDING.bottom + 4} textAnchor="end">{lossRange.min.toFixed(3)}</text>
            </>
          )}
          {metricValues.length > 0 && chart.metricName && (
            <>
              <text className="training-chart__axis-label" x={VIEW_WIDTH - PADDING.right + 6} y={PADDING.top + 4} textAnchor="start">{formatStrictMetricValue(chart.metricName, metricRange.max)}</text>
              <text className="training-chart__axis-label" x={VIEW_WIDTH - PADDING.right + 6} y={VIEW_HEIGHT - PADDING.bottom + 4} textAnchor="start">{formatStrictMetricValue(chart.metricName, metricRange.min)}</text>
            </>
          )}
        </svg>
      )}

      {chart.series.length > 0 && (
        <div className="training-chart__legend" aria-label="曲线图例">
          {chart.series.map(series => {
            const latest = latestPoint(series);
            const text = latest
              ? series.axis === 'metric' && chart.metricName
                ? formatStrictMetricValue(chart.metricName, latest.value)
                : latest.value.toFixed(4)
              : '不可用';
            return (
              <span key={series.key} className={`training-chart__legend-item training-chart__legend-item--${series.key}`}>
                <span className="training-chart__legend-swatch" aria-hidden="true" />
                {series.label}：{text}
              </span>
            );
          })}
        </div>
      )}

      {chart.warnings.length > 0 && (
        <ul className="training-chart__warnings" aria-label="曲线数据说明">
          {chart.warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      {/* 主题集合是静态的：读图说明不重新分析 metrics，空数据时同样只是通用说明。 */}
      <ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />
    </section>
  );
}
