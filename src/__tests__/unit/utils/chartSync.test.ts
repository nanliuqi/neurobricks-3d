import { beforeEach, describe, expect, it } from 'vitest';
import type { TrainMetric } from '@/types/training';
import { CHART_METRICS_KEY, CHART_PAYLOAD_VERSION, writeChartMetricsNow } from '@/utils/chartSync';

function metric(overrides: Partial<TrainMetric> = {}): TrainMetric {
  return {
    epoch: 1, step: 1, split: 'validation', scope: 'epoch', loss: 0.5, accuracy: 0.8,
    metricName: 'accuracy', metricValue: 0.8, optimizationDirection: 'maximize', timestamp: 1,
    ...overrides,
  };
}

beforeEach(() => localStorage.clear());

describe('chartSync v2', () => {
  it('写入版本化语义投影而不是原始数组', () => {
    expect(writeChartMetricsNow(2000, [metric()])).toBe(true);
    const payload = JSON.parse(localStorage.getItem(CHART_METRICS_KEY) ?? '{}');
    expect(payload.version).toBe(CHART_PAYLOAD_VERSION);
    expect(Array.isArray(payload)).toBe(false);
    expect(payload.chart.metricName).toBe('accuracy');
    expect(payload.chart.series[0].points[0].value).toBe(0.5);
  });

  it('未知指标语义写入降级说明，不猜 Accuracy', () => {
    writeChartMetricsNow(2000, [metric({ metricName: undefined })]);
    const payload = JSON.parse(localStorage.getItem(CHART_METRICS_KEY) ?? '{}');
    expect(payload.chart.metricName).toBeNull();
    expect(payload.chart.warnings.join(' ')).toContain('未猜测为 Accuracy');
  });

  it('严格独立窗口载荷不接纳旧 accuracy 回退值', () => {
    writeChartMetricsNow(2000, [metric({ metricValue: undefined, accuracy: 0.9 })], 'strict');
    const payload = JSON.parse(localStorage.getItem(CHART_METRICS_KEY) ?? '{}');
    expect(payload.chart.metricValueMode).toBe('strict');
    expect(payload.chart.series.some((item: { axis: string }) => item.axis === 'metric')).toBe(false);
  });

  it('降采样保留首尾且安全处理非法上限', () => {
    const metrics = Array.from({ length: 5 }, (_, index) => metric({ epoch: index + 1, step: index + 1, timestamp: index + 1 }));
    writeChartMetricsNow(2, metrics);
    const payload = JSON.parse(localStorage.getItem(CHART_METRICS_KEY) ?? '{}');
    const points = payload.chart.series.find((item: { key: string }) => item.key === 'validation_metric').points;
    expect(points.map((point: { epoch: number }) => point.epoch)).toEqual([1, 5]);
    expect(writeChartMetricsNow(Number.NaN, metrics)).toBe(true);
  });

  it('分层降采样不会让稀少 validation 点被 train/batch 吞没', () => {
    const training = Array.from({ length: 100 }, (_, index) => metric({
      epoch: Math.floor(index / 10) + 1,
      step: index + 1,
      globalStep: index + 1,
      split: 'train',
      scope: 'batch',
      timestamp: index + 1,
    }));
    const validation = [
      metric({ epoch: 1, step: 10, globalStep: 10, timestamp: 101 }),
      metric({ epoch: 2, step: 20, globalStep: 20, timestamp: 102 }),
    ];
    writeChartMetricsNow(8, [...training, ...validation]);
    const payload = JSON.parse(localStorage.getItem(CHART_METRICS_KEY) ?? '{}');
    const validationSeries = payload.chart.series.find((item: { key: string }) => item.key === 'validation_metric');
    expect(validationSeries.points.map((point: { epoch: number }) => point.epoch)).toEqual([1, 2]);
  });
});
