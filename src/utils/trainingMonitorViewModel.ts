import type { Attempt, AttemptStatus, ExperimentLedgerV1 } from '@/types/experiment';
import type {
  LogEntry,
  TrainMetric,
  TrainRecord,
  TrainStatus,
  TrainingErrorKind,
  TrainingExecutionMode,
} from '@/types/training';
import {
  diagnosticMetricValueOf,
  extractStrictSeriesFromMetrics,
  formatStrictMetricValue,
  strictMetricValueOf,
  strictMetricDescriptorFromMetrics,
  type MetricDirection,
} from '@/utils/metricSeries';

export type MonitorTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface TrainingStatusView {
  known: boolean;
  label: string;
  tone: MonitorTone;
  description: string;
  active: boolean;
  terminal: boolean;
}

const TRAIN_STATUS: Record<TrainStatus, Omit<TrainingStatusView, 'known'>> = {
  idle: { label: '等待训练', tone: 'neutral', description: '当前没有活动训练进程。', active: false, terminal: false },
  starting: { label: '正在启动', tone: 'info', description: '训练进程正在启动，尚未收到首条进度。', active: true, terminal: false },
  training: { label: '训练中', tone: 'info', description: '正在接收受控训练进度。', active: true, terminal: false },
  paused: { label: '已暂停', tone: 'warning', description: '进程仍受控，但当前不继续训练。', active: true, terminal: false },
  stopping: { label: '正在停止', tone: 'warning', description: '停止请求已发送，等待进程确认。', active: true, terminal: false },
  done: { label: '训练完成', tone: 'success', description: '训练进程已完成；证据等级仍由 Attempt 档案决定。', active: false, terminal: true },
  cancelled: { label: '已取消', tone: 'warning', description: '保留的部分轨迹只用于诊断，不构成严格对比证据。', active: false, terminal: true },
  error: { label: '训练失败', tone: 'danger', description: '训练未完成；请根据错误原因修复后重试。', active: false, terminal: true },
  crashed: { label: '进程异常退出', tone: 'danger', description: '进程见证已中断，部分轨迹只用于诊断。', active: false, terminal: true },
};

export function projectTrainingStatus(status: unknown): TrainingStatusView {
  if (typeof status === 'string' && status in TRAIN_STATUS) {
    return { known: true, ...TRAIN_STATUS[status as TrainStatus] };
  }
  return {
    known: false,
    label: '训练状态异常',
    tone: 'danger',
    description: '记录包含当前版本无法识别的训练状态，已按失败关闭处理。',
    active: false,
    terminal: true,
  };
}

export function trainingErrorTitle(kind: TrainingErrorKind | null): string {
  if (kind === 'preflight') return '训练前检查未通过';
  if (kind === 'startup') return '训练进程启动失败';
  if (kind === 'control') return '训练控制失败';
  if (kind === 'hung') return '训练进程挂起';
  if (kind === 'crashed') return '训练进程异常退出';
  return '训练执行失败';
}

export function metricDisplayName(metricName: string): string {
  if (metricName === 'accuracy') return 'Accuracy';
  if (metricName === 'mae') return 'MAE';
  if (metricName === 'rmse') return 'RMSE';
  if (metricName === 'r2') return 'R²';
  return metricName;
}

export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '不可用';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}分${seconds % 60}秒`;
}

/** 显式写入却非法的 metricValue 不能被旧 accuracy 字段遮蔽；只有真正缺失字段的旧记录才走诊断兼容。 */
function monitorMetricValue(metric: TrainMetric): number | null {
  if (metric.metricValue !== undefined) {
    return typeof metric.metricValue === 'number' && Number.isFinite(metric.metricValue)
      ? metric.metricValue
      : null;
  }
  return diagnosticMetricValueOf(metric);
}

/** 与主指标相同：显式但非法的 lossValue 不能被旧 loss 字段静默覆盖。 */
function monitorLossValue(metric: TrainMetric): number | null {
  if (metric.lossValue !== undefined) {
    return typeof metric.lossValue === 'number' && Number.isFinite(metric.lossValue)
      ? metric.lossValue
      : null;
  }
  return Number.isFinite(metric.loss) ? metric.loss : null;
}

export function clampProgress(currentEpoch: number, totalEpochs: number): number {
  if (!Number.isFinite(currentEpoch) || !Number.isFinite(totalEpochs) || totalEpochs <= 0) return 0;
  return Math.min(100, Math.max(0, (currentEpoch / totalEpochs) * 100));
}

export interface LiveMetricView {
  available: boolean;
  label: string;
  valueText: string;
  context: string;
}

export function projectLatestDiagnosticMetric(metrics: readonly TrainMetric[]): LiveMetricView {
  for (let index = metrics.length - 1; index >= 0; index -= 1) {
    const metric = metrics[index];
    const name = typeof metric.metricName === 'string' ? metric.metricName.trim() : '';
    const value = monitorMetricValue(metric);
    if (!name || value === null) continue;
    const context = metric.split && metric.scope
      ? `${metric.split}/${metric.scope}`
      : '语义不完整的历史记录';
    return {
      available: true,
      label: metricDisplayName(name),
      valueText: formatStrictMetricValue(name, value),
      context,
    };
  }
  return { available: false, label: '主指标', valueText: '不可用', context: '缺少明确指标名或有限数值' };
}

export type TrainingChartSeriesKey =
  | 'train_loss'
  | 'validation_loss'
  | 'train_metric'
  | 'validation_metric';

export interface TrainingChartPoint {
  x: number;
  epoch: number;
  value: number;
}

export interface TrainingChartSeries {
  key: TrainingChartSeriesKey;
  label: string;
  axis: 'loss' | 'metric';
  points: TrainingChartPoint[];
}

export interface TrainingChartModel {
  metricValueMode: TrainingChartMetricMode;
  metricName: string | null;
  metricLabel: string | null;
  series: TrainingChartSeries[];
  warnings: string[];
  excludedRecordCount: number;
  pointCount: number;
}

export interface LatestTrainingDiagnosticValue {
  label: string;
  valueText: string;
  epoch: number;
  context: '训练批次' | '验证轮次';
}

export interface LatestTrainingDiagnostics {
  loss: LatestTrainingDiagnosticValue | null;
  metric: LatestTrainingDiagnosticValue | null;
  warnings: string[];
}

export type TrainingChartMetricMode = 'diagnostic' | 'strict';

function metricX(metric: TrainMetric): number | null {
  const value = metric.globalStep ?? metric.step;
  if (Number.isFinite(value)) return value;
  return Number.isFinite(metric.epoch) ? metric.epoch : null;
}

function chartPoint(metric: TrainMetric, value: number): TrainingChartPoint | null {
  const x = metricX(metric);
  if (x === null || !Number.isFinite(metric.epoch) || !Number.isFinite(value)) return null;
  return { x, epoch: metric.epoch, value };
}

function sortPoints(points: TrainingChartPoint[]): TrainingChartPoint[] {
  return points.sort((left, right) => left.x - right.x || left.epoch - right.epoch);
}

/**
 * 训练曲线的唯一展示投影：只按显式 split/scope/metricName 分组。
 * 缺失语义的旧记录可以留在原始日志中，但不得被猜成 Accuracy 或验证集终值。
 */
export function projectTrainingChart(
  metrics: readonly TrainMetric[],
  metricValueMode: TrainingChartMetricMode = 'diagnostic',
): TrainingChartModel {
  const warnings: string[] = [];
  const excludedIndices = new Set<number>();
  let legacyMetricExclusionCount = 0;
  const eligible = metrics.map((metric, index) => ({ metric, index })).filter(({ metric, index }) => {
    const knownScope = (metric.split === 'train' && metric.scope === 'batch')
      || (metric.split === 'validation' && metric.scope === 'epoch');
    if (!knownScope) excludedIndices.add(index);
    return knownScope;
  });

  const names = [...new Set(eligible
    .map(({ metric }) => typeof metric.metricName === 'string' ? metric.metricName.trim() : '')
    .filter(Boolean))].sort();
  const metricName = names.length === 1 ? names[0] : null;
  if (names.length > 1) warnings.push(`检测到多个主指标（${names.join('、')}），未将它们混为一条曲线`);
  if (names.length === 0 && eligible.length > 0) warnings.push('记录缺少明确 metricName，未猜测为 Accuracy');

  const trainLoss: TrainingChartPoint[] = [];
  const validationLoss: TrainingChartPoint[] = [];
  const trainMetric: TrainingChartPoint[] = [];
  const validationMetric: TrainingChartPoint[] = [];

  for (const { metric, index } of eligible) {
    const loss = monitorLossValue(metric);
    if (loss !== null) {
      const point = chartPoint(metric, loss);
      if (point) (metric.split === 'train' ? trainLoss : validationLoss).push(point);
      else excludedIndices.add(index);
    } else {
      excludedIndices.add(index);
    }

    if (!metricName || metric.metricName !== metricName) {
      excludedIndices.add(index);
      continue;
    }
    const value = metricValueMode === 'strict' ? strictMetricValueOf(metric) : monitorMetricValue(metric);
    if (value === null) {
      if (metricValueMode === 'strict' && metric.metricValue === undefined) legacyMetricExclusionCount += 1;
      excludedIndices.add(index);
      continue;
    }
    const point = chartPoint(metric, value);
    if (point) (metric.split === 'train' ? trainMetric : validationMetric).push(point);
    else excludedIndices.add(index);
  }

  const excludedRecordCount = excludedIndices.size;
  if (excludedRecordCount > 0) {
    warnings.push(`${excludedRecordCount} 条记录因作用域或数值语义不完整，部分或全部字段未进入曲线`);
  }
  if (legacyMetricExclusionCount > 0) {
    warnings.push(`${legacyMetricExclusionCount} 条旧记录仅有 accuracy 兼容字段，未进入严格主指标曲线`);
  }

  const series: TrainingChartSeries[] = ([
    { key: 'train_loss', label: '训练批次 Loss', axis: 'loss', points: sortPoints(trainLoss) },
    { key: 'validation_loss', label: '验证轮次 Loss', axis: 'loss', points: sortPoints(validationLoss) },
    {
      key: 'train_metric',
      label: metricName ? `训练批次 ${metricDisplayName(metricName)}` : '训练批次主指标',
      axis: 'metric',
      points: sortPoints(trainMetric),
    },
    {
      key: 'validation_metric',
      label: metricName ? `验证轮次 ${metricDisplayName(metricName)}` : '验证轮次主指标',
      axis: 'metric',
      points: sortPoints(validationMetric),
    },
  ] satisfies TrainingChartSeries[]).filter(seriesItem => seriesItem.points.length > 0);

  return {
    metricValueMode,
    metricName,
    metricLabel: metricName ? metricDisplayName(metricName) : null,
    series,
    warnings,
    excludedRecordCount,
    pointCount: series.reduce((total, item) => total + item.points.length, 0),
  };
}

/**
 * 卡片式任务摘要使用的唯一诊断投影。
 * 优先展示 validation/epoch；缺失时才展示 train/batch，并沿用曲线投影的
 * split/scope/metricName/有限值闸门，不从数组尾项猜测 Loss 或 Accuracy。
 */
export function projectLatestTrainingDiagnostics(
  metrics: readonly TrainMetric[],
): LatestTrainingDiagnostics {
  const chart = projectTrainingChart(metrics, 'diagnostic');
  const latestOf = (preferredKey: TrainingChartSeriesKey, fallbackKey: TrainingChartSeriesKey) => {
    const series = chart.series.find(item => item.key === preferredKey)
      ?? chart.series.find(item => item.key === fallbackKey);
    const point = series?.points[series.points.length - 1];
    return series && point ? { series, point } : null;
  };
  const latestLoss = latestOf('validation_loss', 'train_loss');
  const latestMetric = latestOf('validation_metric', 'train_metric');
  const contextOf = (key: TrainingChartSeriesKey): LatestTrainingDiagnosticValue['context'] => (
    key.startsWith('validation') ? '验证轮次' : '训练批次'
  );

  return {
    loss: latestLoss ? {
      label: 'Loss',
      valueText: formatStrictMetricValue('loss', latestLoss.point.value),
      epoch: latestLoss.point.epoch,
      context: contextOf(latestLoss.series.key),
    } : null,
    metric: latestMetric && chart.metricName ? {
      label: metricDisplayName(chart.metricName),
      valueText: formatStrictMetricValue(chart.metricName, latestMetric.point.value),
      epoch: latestMetric.point.epoch,
      context: contextOf(latestMetric.series.key),
    } : null,
    warnings: chart.warnings,
  };
}

export interface AttemptMetricEvidence {
  metricName: string | null;
  direction: MetricDirection | null;
  finalPoint: { epoch: number; value: number; text: string } | null;
  bestPoint: { epoch: number; value: number; text: string } | null;
  validationLoss: { epoch: number; value: number } | null;
  strictSemanticsAvailable: boolean;
  authoritative: boolean;
  label: string;
  tone: MonitorTone;
  warnings: string[];
}

export function resumeTypeLabel(resumeType: unknown, restartCount = 0): string {
  if (resumeType === 'fresh') return restartCount > 0 ? `从头重跑 · 重启序号 ${restartCount}` : '从头运行';
  if (resumeType === 'full_state') return '完整状态续训';
  if (resumeType === 'weights_only') return '仅权重恢复 · 优化轨迹已改变';
  return '恢复语义异常';
}

function isKnownResumeType(value: unknown): value is Attempt['resumeType'] {
  return value === 'fresh' || value === 'full_state' || value === 'weights_only';
}

function latestValidationLoss(metrics: readonly TrainMetric[]): { epoch: number; value: number } | null {
  const points = metrics
    .filter(metric => metric.split === 'validation' && metric.scope === 'epoch' && Number.isFinite(metric.epoch))
    .map(metric => ({
      epoch: metric.epoch,
      value: monitorLossValue(metric),
      timestamp: Number.isFinite(metric.timestamp) ? metric.timestamp : 0,
    }))
    .filter((point): point is { epoch: number; value: number; timestamp: number } => point.value !== null)
    .sort((left, right) => left.epoch - right.epoch || left.timestamp - right.timestamp);
  const last = points[points.length - 1];
  return last ? { epoch: last.epoch, value: last.value } : null;
}

export function projectAttemptMetricEvidence(attempt: Attempt): AttemptMetricEvidence {
  const metrics = Array.isArray(attempt.metrics) ? attempt.metrics : [];
  const descriptor = strictMetricDescriptorFromMetrics(metrics);
  const warnings: string[] = [];
  let metricName: string | null = null;
  let direction: MetricDirection | null = null;
  let finalPoint: AttemptMetricEvidence['finalPoint'] = null;
  let bestPoint: AttemptMetricEvidence['bestPoint'] = null;

  if (descriptor.available) {
    metricName = descriptor.descriptor.metricName;
    direction = descriptor.descriptor.optimizationDirection;
    const sequence = extractStrictSeriesFromMetrics(metrics, metricName);
    if (sequence.ok) {
      warnings.push(...sequence.warnings);
      const final = sequence.points[sequence.points.length - 1];
      const best = sequence.points.reduce((selected, point) => (
        sequence.direction === 'maximize'
          ? point.value > selected.value
          : point.value < selected.value
      ) ? point : selected);
      finalPoint = { ...final, text: formatStrictMetricValue(metricName, final.value) };
      bestPoint = { ...best, text: formatStrictMetricValue(metricName, best.value) };
    }
  } else {
    warnings.push(descriptor.reason);
  }

  const statusKnown = isKnownAttemptStatus(attempt.status);
  const authoritative = statusKnown
    && isKnownResumeType(attempt.resumeType)
    && attempt.status === 'completed'
    && attempt.provenance.executionTrust === 'trusted'
    && attempt.executionMode === 'native'
    && finalPoint !== null;

  if (!statusKnown) {
    return {
      metricName,
      direction,
      finalPoint,
      bestPoint,
      validationLoss: latestValidationLoss(metrics),
      strictSemanticsAvailable: finalPoint !== null,
      authoritative: false,
      label: 'Attempt 状态异常，证据不可采信',
      tone: 'danger',
      warnings,
    };
  }
  if (!isKnownResumeType(attempt.resumeType)) {
    return {
      metricName,
      direction,
      finalPoint,
      bestPoint,
      validationLoss: latestValidationLoss(metrics),
      strictSemanticsAvailable: finalPoint !== null,
      authoritative: false,
      label: '恢复语义异常，证据不可采信',
      tone: 'danger',
      warnings,
    };
  }
  if (attempt.executionMode === 'simulation') {
    return {
      metricName,
      direction,
      finalPoint,
      bestPoint,
      validationLoss: latestValidationLoss(metrics),
      strictSemanticsAvailable: finalPoint !== null,
      authoritative: false,
      label: '演示数据，不构成实验结果',
      tone: 'warning',
      warnings,
    };
  }
  if (authoritative) {
    return {
      metricName,
      direction,
      finalPoint,
      bestPoint,
      validationLoss: latestValidationLoss(metrics),
      strictSemanticsAvailable: true,
      authoritative: true,
      label: attempt.resumeType === 'weights_only'
        ? '受控完成 · 非完整状态恢复 · 严格 validation/epoch 指标'
        : '受控完成 · 严格 validation/epoch 指标',
      tone: 'success',
      warnings,
    };
  }
  if (attempt.status !== 'completed') {
    return {
      metricName,
      direction,
      finalPoint,
      bestPoint,
      validationLoss: latestValidationLoss(metrics),
      strictSemanticsAvailable: finalPoint !== null,
      authoritative: false,
      label: '部分轨迹，仅用于诊断',
      tone: 'warning',
      warnings,
    };
  }
  return {
    metricName,
    direction,
    finalPoint,
    bestPoint,
    validationLoss: latestValidationLoss(metrics),
    strictSemanticsAvailable: finalPoint !== null,
    authoritative: false,
    label: finalPoint ? '结构化指标可读，但执行未获可信背书' : '严格验证指标不可用',
    tone: 'warning',
    warnings,
  };
}

const ATTEMPT_STATUS: Record<AttemptStatus, { label: string; tone: MonitorTone }> = {
  pending: { label: '等待启动', tone: 'neutral' },
  starting: { label: '正在启动', tone: 'info' },
  running: { label: '运行中', tone: 'info' },
  paused: { label: '已暂停', tone: 'warning' },
  completed: { label: '已完成', tone: 'success' },
  interrupted: { label: '已中断', tone: 'warning' },
  failed: { label: '失败', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'warning' },
};

export function isKnownAttemptStatus(value: unknown): value is AttemptStatus {
  return typeof value === 'string' && value in ATTEMPT_STATUS;
}

export function attemptStatusView(value: unknown): { known: boolean; label: string; tone: MonitorTone } {
  if (isKnownAttemptStatus(value)) return { known: true, ...ATTEMPT_STATUS[value] };
  return { known: false, label: '状态异常', tone: 'danger' };
}

export interface AttemptMonitorItem {
  attempt: Attempt;
  experimentName: string;
  status: ReturnType<typeof attemptStatusView>;
  evidence: AttemptMetricEvidence;
  startedText: string;
  durationText: string;
  resumeLabel: string;
}

/** 只返回活动 Study 的 Attempt；无活动 Study 时绝不把历史运行冒充当前证据。 */
export function scopeAttemptsToActiveStudy(
  ledger: ExperimentLedgerV1,
  activeStudyId: string | null,
): AttemptMonitorItem[] {
  if (!activeStudyId || !ledger.studies.some(study => study.id === activeStudyId && !study.archivedAt)) return [];
  const experiments = new Map(ledger.experiments
    .filter(experiment => experiment.studyId === activeStudyId)
    .map(experiment => [experiment.id, experiment]));
  return ledger.attempts
    .filter(attempt => experiments.has(attempt.experimentId))
    .map(attempt => {
      const experiment = experiments.get(attempt.experimentId);
      const duration = typeof attempt.startedAt === 'number' && typeof attempt.endedAt === 'number'
        ? attempt.endedAt - attempt.startedAt
        : null;
      return {
        attempt,
        experimentName: experiment?.name ?? '未命名 Experiment',
        status: attemptStatusView(attempt.status),
        evidence: projectAttemptMetricEvidence(attempt),
        startedText: typeof attempt.startedAt === 'number' && Number.isFinite(attempt.startedAt)
          ? new Date(attempt.startedAt).toLocaleString('zh-CN', { hour12: false })
          : '尚未开始',
        durationText: formatDuration(duration),
        resumeLabel: resumeTypeLabel(attempt.resumeType, attempt.restartCount),
      };
    })
    .sort((left, right) => (
      attemptSortTime(right.attempt) - attemptSortTime(left.attempt)
    ));
}

function attemptSortTime(attempt: Attempt): number {
  if (typeof attempt.startedAt === 'number' && Number.isFinite(attempt.startedAt)) return attempt.startedAt;
  if (typeof attempt.endedAt === 'number' && Number.isFinite(attempt.endedAt)) return attempt.endedAt;
  return 0;
}

export function matchingTrainRecord(
  history: readonly TrainRecord[],
  attemptId: string | null,
): TrainRecord | null {
  if (!attemptId) return null;
  return history.find(record => record.attemptId === attemptId) ?? null;
}

export function metricsDuration(metrics: readonly TrainMetric[]): number | null {
  const timestamps = metrics.map(metric => metric.timestamp).filter(Number.isFinite).sort((a, b) => a - b);
  if (timestamps.length < 2) return null;
  return Math.max(0, timestamps[timestamps.length - 1] - timestamps[0]);
}

export function formatLogTime(log: LogEntry): string {
  if (!Number.isFinite(log.timestamp)) return '--:--:--';
  return new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

export function executionModeLabel(mode: TrainingExecutionMode | null): string {
  if (mode === 'native') return '本机受控管线';
  if (mode === 'simulation') return '浏览器演示';
  return '执行方式未知';
}
