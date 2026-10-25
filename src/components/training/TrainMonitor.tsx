import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import {
  pauseTrainingRun,
  restartLastTrainingRun,
  resumeTrainingRun,
  stopTrainingRun,
} from '@/trainingRuntime';
import { writeChartMetricsNow } from '@/utils/chartSync';
import {
  scopeAttemptsToActiveStudy,
} from '@/utils/trainingMonitorViewModel';
import TrainingAttemptHistory from './TrainingAttemptHistory';
import TrainingControls from './TrainingControls';
import TrainingLogPanel from './TrainingLogPanel';
import TrainingMetricChart from './TrainingMetricChart';
import TrainingStatusSummary from './TrainingStatusSummary';

export interface TrainMonitorProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * 训练监控只组合运行状态、曲线、日志与当前 Study 的 Attempt。
 * 它不授予可信标记；所有证据措辞来自持久化 Attempt 和严格指标投影。
 */
export default function TrainMonitor({ className, style }: TrainMonitorProps) {
  const training = useTrainingStore();
  const ledger = useExperimentStore(state => state.ledger);
  const activeStudyId = useExperimentStore(state => state.activeStudyId);
  const attempts = useMemo(
    () => scopeAttemptsToActiveStudy(ledger, activeStudyId),
    [activeStudyId, ledger],
  );
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    if (training.isTraining) return;
    const preferred = training.lastAttemptId && attempts.some(item => item.attempt.id === training.lastAttemptId)
      ? training.lastAttemptId
      : attempts[0]?.attempt.id ?? null;
    if (!selectedAttemptId || !attempts.some(item => item.attempt.id === selectedAttemptId)) {
      setSelectedAttemptId(preferred);
    }
  }, [attempts, selectedAttemptId, training.isTraining, training.lastAttemptId]);

  const preferredAttemptId = training.lastAttemptId && attempts.some(item => item.attempt.id === training.lastAttemptId)
    ? training.lastAttemptId
    : attempts[0]?.attempt.id ?? null;
  // 选择项由当前 render 同步裁决；不能等待 effect 再纠正，否则切换 Study 后会有一帧
  // 把 training.metrics（可能属于上一 Study）显示成当前课题证据。
  const selectedItem = attempts.find(item => item.attempt.id === selectedAttemptId)
    ?? attempts.find(item => item.attempt.id === preferredAttemptId)
    ?? null;
  const displayedMetrics = training.isTraining
    ? training.metrics
    : selectedItem?.attempt.metrics ?? [];
  const displayedEvidence = training.isTraining
    ? {
        label: training.executionMode === 'simulation'
          ? '实时演示曲线（非实验结果）'
          : '实时过程曲线（尚未完成，仅用于监控）',
        tone: training.executionMode === 'simulation' ? 'warning' as const : 'info' as const,
      }
    : selectedItem?.evidence
      ? { label: selectedItem.evidence.label, tone: selectedItem.evidence.tone }
      : null;
  const metricValueMode = !training.isTraining && selectedItem?.evidence.authoritative ? 'strict' as const : 'diagnostic' as const;

  const canRestart = Boolean(
    !training.isTraining
    && training.lastTrainConfig
    && training.errorKind
    && !['preflight', 'control'].includes(training.errorKind),
  );

  const resetAction = training.error && !training.isTraining ? (
    <Button variant="secondary" size="small" onClick={() => useTrainingStore.getState().resetTraining()}>
      清除提示
    </Button>
  ) : undefined;

  const handleOpenChart = async () => {
    setChartError(null);
    writeChartMetricsNow(2000, displayedMetrics, metricValueMode);
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('open_chart_window');
    } catch (error) {
      setChartError(error instanceof Error ? '无法打开独立曲线窗口：' + error.message : '无法打开独立曲线窗口');
    }
  };

  return (
    <div className={['training-monitor', className].filter(Boolean).join(' ')} style={style}>
      <TrainingStatusSummary
        status={training.status}
        executionMode={training.executionMode}
        currentEpoch={training.currentEpoch}
        totalEpochs={training.totalEpochs}
        currentLoss={training.currentLoss}
        metrics={training.metrics}
        error={training.error}
        errorKind={training.errorKind}
        errorAction={resetAction}
      />

      {(training.isTraining || training.status !== 'idle' || training.error) && (
        <TrainingControls
          isTraining={training.isTraining}
          isPaused={training.isPaused}
          status={training.status}
          canRestart={canRestart}
          onResume={resumeTrainingRun}
          onPause={pauseTrainingRun}
          onStop={stopTrainingRun}
          onRestart={restartLastTrainingRun}
          onReset={() => useTrainingStore.getState().resetTraining()}
        />
      )}

      <section className="training-monitor__chart-section" aria-label="训练曲线">
        {chartError && <Alert tone="danger" title="曲线窗口打开失败">{chartError}</Alert>}
        <div className="training-monitor__section-heading">
          <StatusBadge
            tone={displayedEvidence?.tone ?? 'neutral'}
            label={displayedEvidence?.label ?? '当前没有可归属的运行证据'}
          />
          <Button variant="ghost" size="small" onClick={handleOpenChart} disabled={displayedMetrics.length === 0}>
            独立窗口查看
          </Button>
        </div>
        {displayedMetrics.length > 0 ? (
          <TrainingMetricChart
            metrics={displayedMetrics}
            evidenceLabel={displayedEvidence?.label ?? '训练诊断曲线'}
            metricValueMode={metricValueMode}
          />
        ) : (
          <EmptyState
            title="尚无训练曲线"
            description="开始训练后会显示实时过程；完成或中断后，曲线从当前 Study 的 Attempt 档案读取。"
          />
        )}
      </section>

      {!activeStudyId && !training.isTraining && (
        <Alert tone="info" title="尚未选择活动 Study">
          历史 Attempt 不会在这里冒充当前课题证据。请先在“课题”面板选择或建立 Study。
        </Alert>
      )}

      <TrainingLogPanel logs={training.logs} />
      <TrainingAttemptHistory
        attempts={attempts}
        selectedAttemptId={selectedAttemptId}
        onSelect={setSelectedAttemptId}
      />
    </div>
  );
}
