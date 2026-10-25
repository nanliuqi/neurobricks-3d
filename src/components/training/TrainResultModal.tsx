import { useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import ResultReadingGuide from '@/components/training/ResultReadingGuide';
import { TRAIN_RESULT_READING_TOPIC_IDS } from '@/content/resultInterpretation';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { writeChartMetricsNow } from '@/utils/chartSync';
import { formatStrictMetricValue } from '@/utils/metricSeries';
import { PARAM_COUNT_UNAVAILABLE_TEXT, projectParamCount } from '@/utils/parameterCountPresentation';
import {
  formatDuration,
  matchingTrainRecord,
  metricsDuration,
  metricDisplayName,
  projectAttemptMetricEvidence,
  resumeTypeLabel,
} from '@/utils/trainingMonitorViewModel';

/**
 * 训练完成卡片只展示与 lastAttemptId 匹配的持久化 Attempt。
 * 进程 done 消息是完成通知，不会被冒充为严格 validation/epoch 证据。
 */
export default function TrainResultModal() {
  const training = useTrainingStore();
  const ledger = useExperimentStore(state => state.ledger);
  const [visible, setVisible] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const attempt = useMemo(
    () => training.lastAttemptId
      ? ledger.attempts.find(item => item.id === training.lastAttemptId) ?? null
      : null,
    [ledger.attempts, training.lastAttemptId],
  );
  const completedRecord = useMemo(
    () => matchingTrainRecord(training.history, training.lastAttemptId)
      ?? (training.executionMode === 'simulation'
        ? training.history.find(record => !record.attemptId && record.executionMode === 'simulation') ?? null
        : null),
    [training.executionMode, training.history, training.lastAttemptId],
  );
  const resultMetrics = attempt?.metrics ?? completedRecord?.metrics ?? training.metrics;
  const evidence = attempt ? projectAttemptMetricEvidence(attempt) : null;

  useEffect(() => {
    if (training.status === 'done') {
      setVisible(true);
      window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    }
  }, [training.status]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setVisible(false);
        useTrainingStore.getState().resetTraining();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible]);

  if (!visible || training.status !== 'done') return null;

  const duration = attempt?.startedAt !== null && attempt?.startedAt !== undefined
    && attempt.endedAt !== null && attempt.endedAt !== undefined
    ? attempt.endedAt - attempt.startedAt
    : completedRecord?.duration ?? metricsDuration(resultMetrics);
  const epochCount = attempt?.config.epochs ?? completedRecord?.epochs ?? training.totalEpochs;
  const networkSummary = completedRecord?.networkSummary ?? '未找到与本次 Attempt 匹配的网络摘要';
  const layerCount = attempt?.config.layers.length ?? completedRecord?.layers?.length ?? 0;
  // 参数总量只取该条完成记录自身的快照，不回读当前编辑工程的参数量。
  const recordedTotalParams = completedRecord?.totalParams ?? null;
  const isSimulation = attempt?.executionMode === 'simulation' || completedRecord?.executionMode === 'simulation';
  const artifacts = attempt?.artifacts ?? completedRecord?.artifacts ?? null;
  const modelUnavailable = !isSimulation && artifacts?.perModel === false;

  const finalMetricLabel = evidence?.metricName
    ? metricDisplayName(evidence.metricName)
    : training.finalMetricName ? metricDisplayName(training.finalMetricName) : '主指标';
  const finalMetricText = evidence?.finalPoint?.text
    ?? (
      training.finalMetricName && training.finalAccuracy !== null && Number.isFinite(training.finalAccuracy)
        ? formatStrictMetricValue(training.finalMetricName, training.finalAccuracy)
        : '不可用'
    );
  const finalMetricContext = evidence?.finalPoint
    ? (evidence.authoritative ? '受控完成的严格 validation/epoch 指标' : '结构化指标可读，但不具备可信背书')
      + ' · epoch ' + evidence.finalPoint.epoch
    : '仅来自进程完成通知或缺少严格指标语义，不构成最终验证证据';

  const handleClose = () => {
    setVisible(false);
    training.resetTraining();
  };

  const handleViewChart = async () => {
    setOpenError(null);
    writeChartMetricsNow(2000, resultMetrics, evidence?.authoritative ? 'strict' : 'diagnostic');
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('open_chart_window');
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : '无法打开独立曲线窗口');
    }
  };

  return (
    <div className="train-result-backdrop">
      <section
        className="train-result-card"
        data-testid="train-result-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="train-result-title"
      >
        <header className="train-result-card__header">
          <h2 id="train-result-title">{isSimulation ? '演示训练完成' : '训练完成'}</h2>
          <StatusBadge
            tone={evidence?.tone ?? 'warning'}
            label={evidence?.label ?? (isSimulation ? '演示数据，不构成实验结果' : '未匹配到持久化 Attempt，不能授予可信背书')}
          />
        </header>

        {!attempt && !isSimulation && (
          <Alert tone="warning" title="Attempt 档案未匹配">
            完成通知仍可查看，但无法证明它与哪个持久化 Attempt 对应；下方数字不得作为严格证据。
          </Alert>
        )}
        {openError && <Alert tone="danger" title="曲线窗口打开失败">{openError}</Alert>}

        <div className="train-result-card__metrics">
          <div>
            <span>{finalMetricLabel}</span>
            <strong>{finalMetricText}</strong>
            <small>{finalMetricContext}</small>
          </div>
          <div>
            <span>最近有效验证 Loss</span>
            <strong>{evidence?.validationLoss ? evidence.validationLoss.value.toFixed(6) : '不可用'}</strong>
            <small>{evidence?.validationLoss ? 'validation/epoch · epoch ' + evidence.validationLoss.epoch : '未用训练批次 Loss 冒充验证终值'}</small>
          </div>
        </div>

        <dl className="train-result-card__facts">
          <div><dt>训练时长</dt><dd>{formatDuration(duration)}</dd></div>
          <div><dt>计划轮数</dt><dd>{Number.isFinite(epochCount) ? epochCount + ' epochs' : '不可用'}</dd></div>
          <div><dt>网络层数</dt><dd>{layerCount > 0 ? layerCount + ' 层' : '不可用'}</dd></div>
          <div><dt>参数总量</dt><dd>{projectParamCount(recordedTotalParams) ?? PARAM_COUNT_UNAVAILABLE_TEXT}</dd></div>
          <div><dt>运行语义</dt><dd>{attempt ? resumeTypeLabel(attempt.resumeType, attempt.restartCount) : '不可用'}</dd></div>
          <div>
            <dt>{evidence?.authoritative ? '最佳严格 Epoch' : '最佳结构化观察（不背书）'}</dt>
            <dd>{evidence?.bestPoint
              ? 'Epoch ' + evidence.bestPoint.epoch + '（' + finalMetricLabel + ' ' + evidence.bestPoint.text + '）'
              : '不可用'}</dd>
          </div>
        </dl>

        <p className="train-result-card__network" title={networkSummary}>{networkSummary}</p>

        {evidence?.warnings.map((warning, index) => (
          <Alert key={`${index}-${warning}`} tone="warning" title="指标记录说明">{warning}</Alert>
        ))}
        {modelUnavailable && (
          <Alert tone="warning" title="推理产物不可用">
            训练指标已保存，但独立模型权重写入失败，因此不会创建推理卡片。
          </Alert>
        )}
        {!isSimulation && (
          <p className="train-result-card__note">
            关闭结果卡片只清理临时运行态，不删除持久化 Attempt；之后仍可从课题或导出面板访问。
          </p>
        )}

        {/* R2：静态结果说明，只解释卡片自身显示的验证点与「最佳 Epoch」读法；
            未匹配 Attempt 或演示结果不会因此获得任何背书，卡片显隐与关闭行为不变。 */}
        <ResultReadingGuide topicIds={TRAIN_RESULT_READING_TOPIC_IDS} label="结果说明" />

        <footer className="train-result-card__actions">
          <Button variant="primary" onClick={handleViewChart} disabled={resultMetrics.length === 0}>查看曲线</Button>
          <Button ref={closeButtonRef} variant="secondary" onClick={handleClose}>完成</Button>
        </footer>
      </section>
    </div>
  );
}
