import type { ReactNode } from 'react';
import Alert from '@/components/ui/Alert';
import StatusBadge from '@/components/ui/StatusBadge';
import type { TrainMetric, TrainStatus, TrainingErrorKind, TrainingExecutionMode } from '@/types/training';
import {
  clampProgress,
  executionModeLabel,
  projectLatestDiagnosticMetric,
  projectTrainingStatus,
  trainingErrorTitle,
} from '@/utils/trainingMonitorViewModel';

export interface TrainingStatusSummaryProps {
  status: TrainStatus;
  executionMode: TrainingExecutionMode | null;
  currentEpoch: number;
  totalEpochs: number;
  currentLoss: number;
  metrics: readonly TrainMetric[];
  error: string | null;
  errorKind: TrainingErrorKind | null;
  errorAction?: ReactNode;
}

export default function TrainingStatusSummary({
  status,
  executionMode,
  currentEpoch,
  totalEpochs,
  currentLoss,
  metrics,
  error,
  errorKind,
  errorAction,
}: TrainingStatusSummaryProps) {
  const state = projectTrainingStatus(status);
  const metric = projectLatestDiagnosticMetric(metrics);
  const progress = clampProgress(currentEpoch, totalEpochs);
  const lossText = metrics.length > 0 && Number.isFinite(currentLoss) ? currentLoss.toFixed(4) : '不可用';

  return (
    <section className="training-monitor__status" aria-label="训练状态">
      <div className="training-monitor__status-heading">
        <StatusBadge tone={state.tone} label={state.label} description={state.description} />
        <span className="training-monitor__execution-mode">{executionModeLabel(executionMode)}</span>
      </div>
      {error && <Alert tone="danger" title={trainingErrorTitle(errorKind)} action={errorAction}>{error}</Alert>}
      {executionMode === 'simulation' && (
        <Alert tone="warning" title="浏览器演示模式">曲线和指标是模拟数据，不会生成模型、权重或可信 Attempt。</Alert>
      )}
      {status === 'cancelled' && !error && (
        <Alert tone="warning" title="训练已取消">部分轨迹仍可用于排障，但不会成为可信候选，也不会进入严格对比组。</Alert>
      )}
      <div className="training-monitor__progress-row">
        <span>{totalEpochs > 0 ? `Epoch ${currentEpoch} / ${totalEpochs}` : '尚未收到轮次进度'}</span>
        <strong>{progress.toFixed(1)}%</strong>
      </div>
      <div className="training-monitor__progress-track" role="progressbar" aria-label="训练轮次进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <span className="training-monitor__progress-value" style={{ width: `${progress}%` }} />
      </div>
      <dl className="training-monitor__metric-grid">
        <div><dt>当前 Loss</dt><dd>{lossText}</dd></div>
        <div><dt>{metric.label}</dt><dd>{metric.valueText}</dd><small>{metric.context}</small></div>
      </dl>
    </section>
  );
}
