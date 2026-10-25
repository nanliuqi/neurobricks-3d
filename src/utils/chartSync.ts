import { useTrainingStore } from '@/stores/useTrainingStore';
import type { TrainMetric } from '@/types/training';
import {
  projectTrainingChart,
  type TrainingChartMetricMode,
  type TrainingChartModel,
} from '@/utils/trainingMonitorViewModel';

/**
 * 独立曲线窗口的数据同步工具。
 * 曲线窗口（chart.html）与主窗口同源，共享 localStorage；
 * chart.html 每 500ms 轮询 CHART_METRICS_KEY 读取曲线数据并绘制。
 */

/** chart.html 轮询读取的 localStorage 键（必须与 public/chart.html 中的 CHART_KEY 一致） */
export const CHART_METRICS_KEY = 'nb_chart_metrics';
export const CHART_PAYLOAD_VERSION = 2 as const;

export interface ChartMetricsPayloadV2 {
  version: typeof CHART_PAYLOAD_VERSION;
  generatedAt: number;
  chart: TrainingChartModel;
}

function samplePoints<T>(points: readonly T[], limit: number): T[] {
  if (points.length <= limit) return [...points];
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => points[Math.min(Math.round(index * step), points.length - 1)]);
}

/**
 * 立即把当前训练曲线数据写入 localStorage（降采样至 maxPoints 点）。
 * 在打开曲线窗口"之前"调用，确保窗口首次轮询即可读到数据、立即绘制，
 * 规避"窗口已打开但数据尚未写入"的竞态导致空白。
 * @returns 是否有数据被写入
 */
export function writeChartMetricsNow(
  maxPoints = 2000,
  metricsOverride?: readonly TrainMetric[],
  metricValueMode: TrainingChartMetricMode = 'diagnostic',
): boolean {
  try {
    const metrics = metricsOverride ?? useTrainingStore.getState().metrics;
    if (!metrics || metrics.length === 0) return false;

    const safeLimit = Number.isFinite(maxPoints) ? Math.max(2, Math.floor(maxPoints)) : 2000;
    // 先做语义投影再分层降采样：若直接对混合原始流均匀抽样，数量稀少的
    // validation/epoch 记录会被大量 train/batch 点吞没，独立窗口可能只剩训练曲线。
    const fullChart = projectTrainingChart(metrics, metricValueMode);
    const perSeriesLimit = Math.max(2, Math.floor(safeLimit / Math.max(fullChart.series.length, 1)));
    const series = fullChart.series.map(item => ({ ...item, points: samplePoints(item.points, perSeriesLimit) }));
    const chart: TrainingChartModel = {
      ...fullChart,
      series,
      pointCount: series.reduce((total, item) => total + item.points.length, 0),
    };
    const payload: ChartMetricsPayloadV2 = {
      version: CHART_PAYLOAD_VERSION,
      generatedAt: Date.now(),
      chart,
    };
    localStorage.setItem(CHART_METRICS_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
