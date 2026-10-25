import type { CSSProperties } from 'react';
import { useTrainingStore } from '@/stores/useTrainingStore';
import type { TrainMetric } from '@/types/training';
import type { TrainingChartMetricMode } from '@/utils/trainingMonitorViewModel';
import TrainingMetricChart from './TrainingMetricChart';

interface LossChartProps {
  data?: TrainMetric[];
  /** 旧调用方兼容字段；新实现始终使用真实 globalStep/step。 */
  fitMode?: boolean;
  evidenceLabel?: string;
  metricValueMode?: TrainingChartMetricMode;
  className?: string;
  style?: CSSProperties;
}

/**
 * 向后兼容入口。实际绘制统一委托 TrainingMetricChart，
 * 旧的“数组尾项/默认 Accuracy/混合 train 与 validation”逻辑已移除。
 */
export default function LossChart({
  data,
  fitMode: _fitMode,
  evidenceLabel = '训练过程诊断曲线',
  metricValueMode = 'diagnostic',
  className,
  style,
}: LossChartProps) {
  const storeMetrics = useTrainingStore(state => state.metrics);
  return (
    <TrainingMetricChart
      metrics={data ?? storeMetrics}
      evidenceLabel={evidenceLabel}
      metricValueMode={metricValueMode}
      className={className}
      style={style}
    />
  );
}
