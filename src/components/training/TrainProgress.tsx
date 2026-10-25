import { useEffect, useState, type CSSProperties } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { stopTrainingRun } from '@/trainingRuntime';
import { formatStrictMetricValue } from '@/utils/metricSeries';
import {
  clampProgress,
  formatDuration,
  projectLatestDiagnosticMetric,
  projectTrainingStatus,
} from '@/utils/trainingMonitorViewModel';

export interface TrainProgressProps {
  className?: string;
  style?: CSSProperties;
}

/** 底部训练条只负责高频运行反馈；可信结论必须回到 Attempt/Claim 档案查看。 */
export default function TrainProgress({ className, style }: TrainProgressProps) {
  const training = useTrainingStore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!training.isTraining) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [training.isTraining]);

  if (!training.isTraining && training.finalAccuracy === null && !training.error) return null;

  const statusView = projectTrainingStatus(training.status);
  const progress = clampProgress(training.currentEpoch, training.totalEpochs);
  const elapsed = training.trainStartTime ? Math.max(0, now - training.trainStartTime) : null;
  const estimatedTotal = elapsed !== null && progress > 5 ? elapsed / (progress / 100) : null;
  const remaining = estimatedTotal !== null ? Math.max(0, estimatedTotal - elapsed!) : null;
  const latestMetric = projectLatestDiagnosticMetric(training.metrics);

  return (
    <div className={['train-progress', 'train-progress--semantic', className].filter(Boolean).join(' ')} style={style}>
      {training.error && (
        <Alert tone="danger" title={statusView.label} className="train-progress__main">
          {training.error}
        </Alert>
      )}

      {training.isTraining && (
        <>
          <div className="train-progress__main train-progress__body">
            <div className="train-progress__heading">
              <StatusBadge tone={statusView.tone} label={statusView.label} />
              <span>{training.status === 'starting' ? '等待首条进度' : 'Epoch ' + training.currentEpoch + ' / ' + training.totalEpochs}</span>
              {training.executionMode === 'simulation' && <span className="train-progress__simulation">演示数据</span>}
              <strong>{progress.toFixed(1)}%</strong>
            </div>
            <div className="train-progress__track" role="progressbar" aria-label="训练轮次进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
              <span style={{ width: progress + '%' }} />
            </div>
            <div className="train-progress__facts">
              <span>Loss：{training.metrics.length > 0 && Number.isFinite(training.currentLoss) ? training.currentLoss.toFixed(4) : '不可用'}</span>
              <span>{latestMetric.label}：{latestMetric.valueText}</span>
              {elapsed !== null && <span>已用：{formatDuration(elapsed)}</span>}
              {remaining !== null && remaining > 0 && <span>预计剩余：{formatDuration(remaining)}</span>}
            </div>
          </div>
          <Button
            variant="danger"
            size="medium"
            className="train-progress__action"
            onClick={stopTrainingRun}
            disabled={training.status === 'stopping'}
          >
            {training.status === 'stopping' ? '正在停止…' : '停止训练'}
          </Button>
        </>
      )}

      {!training.isTraining && training.finalAccuracy !== null && !training.error && (
        <>
          <div className="train-progress__main train-progress__completed">
            <StatusBadge
              tone={training.executionMode === 'simulation' ? 'warning' : 'success'}
              label={training.executionMode === 'simulation' ? '演示训练完成' : '训练完成通知'}
            />
            <span>
              {training.finalMetricName && Number.isFinite(training.finalAccuracy)
                ? training.finalMetricName + '：' + formatStrictMetricValue(training.finalMetricName, training.finalAccuracy)
                : '完成消息缺少明确指标；请在训练监控查看 Attempt 档案'}
            </span>
            <small>这是进程完成通知，不替代严格 validation/epoch 证据。</small>
          </div>
          <Button variant="secondary" size="medium" className="train-progress__action" onClick={training.resetTraining}>
            关闭提示
          </Button>
        </>
      )}
    </div>
  );
}
