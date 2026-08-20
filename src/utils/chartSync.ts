import { useTrainingStore } from '@/stores/useTrainingStore';

/**
 * 独立曲线窗口的数据同步工具。
 * 曲线窗口（chart.html）与主窗口同源，共享 localStorage；
 * chart.html 每 500ms 轮询 CHART_METRICS_KEY 读取曲线数据并绘制。
 */

/** chart.html 轮询读取的 localStorage 键（必须与 public/chart.html 中的 CHART_KEY 一致） */
export const CHART_METRICS_KEY = 'nb_chart_metrics';

/**
 * 立即把当前训练曲线数据写入 localStorage（降采样至 maxPoints 点）。
 * 在打开曲线窗口"之前"调用，确保窗口首次轮询即可读到数据、立即绘制，
 * 规避"窗口已打开但数据尚未写入"的竞态导致空白。
 * @returns 是否有数据被写入
 */
export function writeChartMetricsNow(maxPoints = 2000): boolean {
  try {
    const metrics = useTrainingStore.getState().metrics;
    if (!metrics || metrics.length === 0) return false;

    let payload = metrics;
    if (metrics.length > maxPoints) {
      const step = (metrics.length - 1) / (maxPoints - 1);
      payload = Array.from({ length: maxPoints }, (_, i) =>
        metrics[Math.min(Math.round(i * step), metrics.length - 1)]
      );
    }
    localStorage.setItem(CHART_METRICS_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
