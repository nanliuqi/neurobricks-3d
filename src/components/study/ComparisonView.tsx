/**
 * 严格实验对比（模块 07 重构）：本组件只负责组合。
 * - 规则在 comparisonViewModel / metricSeries（纯函数），交互在 useComparisonController；
 * - 默认对比只接纳严格可比证据；非严格对比必须显式确认、精确留痕并强制水印；
 * - 不修改候选选择：图表选择 ≠ 候选选择。
 */
import { useMemo } from 'react';
import type { Study } from '@/types/experiment';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import ResultReadingGuide from '@/components/training/ResultReadingGuide';
import { COMPARISON_READING_TOPIC_IDS } from '@/content/resultInterpretation';
import { useComparisonController } from './comparison/useComparisonController';
import ComparisonAttemptPicker from './comparison/ComparisonAttemptPicker';
import ComparabilitySummary from './comparison/ComparabilitySummary';
import MetricComparisonChart from './comparison/MetricComparisonChart';
import FinalMetricSummary from './comparison/FinalMetricSummary';
import VarianceEvidence from './comparison/VarianceEvidence';
import AblationEvidencePanel from './comparison/AblationEvidencePanel';
import ComparisonOverrideDialog from './comparison/ComparisonOverrideDialog';
import ComparisonHistory from './comparison/ComparisonHistory';
import ComparisonChartBoundary from './comparison/ComparisonChartBoundary';
import {
  bestStrictAttempt,
  observationLanguage,
  singlePointSeries,
  strictSeriesCoincidence,
  strictSeriesFailureText,
  varianceQualification,
} from '@/utils/comparisonViewModel';

interface ComparisonViewProps {
  study: Study;
}

export default function ComparisonView({ study }: ComparisonViewProps) {
  const controller = useComparisonController(study);
  const {
    ledger,
    scope,
    groups,
    ablationEvidence,
    auditPersistence,
    selected,
    selectedIds,
    toggleAttempt,
    overflowNotice,
    commonMetrics,
    activeMetric,
    setMetricChoice,
    series,
    seriesReady,
    assessment,
    overrideActive,
    overrideEntryAvailable,
    seriesWarnings,
    historyMatch,
    restored,
    pendingOverride,
    overrideError,
    confirmingOverride,
    requestOverride,
    cancelOverride,
    confirmOverride,
    currentOverrideContext,
  } = controller;

  const experimentNameOf = useMemo(() => {
    return (attempt: { experimentId: string }) =>
      scope.experiments.find(experiment => experiment.id === attempt.experimentId)?.name ?? attempt.experimentId;
  }, [scope.experiments]);

  const untrustedCompleted = useMemo(
    () => scope.studyAttempts.filter(attempt => (
      attempt.status === 'completed'
      && attempt.provenance.executionTrust !== 'trusted'
    )),
    [scope.studyAttempts],
  );

  const qualification = useMemo(
    () => varianceQualification(selected, ablationEvidence),
    [selected, ablationEvidence],
  );

  // 观察语言纪律：“最佳方案”只在严格可比 + 序列就绪 + 指标语义完全一致时生成，
  // 方向来自严格序列实际记录的 optimizationDirection（不按指标名猜测）；
  // 非严格 override 只允许查看带水印原始趋势与精确数值，绝不生成排名/被选中语言。
  const bestAttempt = assessment.strict && seriesReady
    ? bestStrictAttempt(selected, series)
    : null;
  const observation = observationLanguage(study, bestAttempt, scope.experiments);

  const seriesConflict = series.find(item => !item.ok && item.kind === 'multiple_metric_names');
  const mayRender = selected.length >= 2
    && seriesReady
    && (assessment.strict || overrideActive);

  /* 真实重合检测（M07-002~015）：数值逐点相同时几何重叠不可避免；
   * 诚实披露而非加偏移伪造差异，区分责任由图例/顶点标记/指标表承担。 */
  const coincidence = useMemo(
    () => (seriesReady ? strictSeriesCoincidence(selected, series) : null),
    [selected, series, seriesReady],
  );

  /* 单点严格序列（M07-002~015 截图修复）：只有 1 个 validation/epoch 点的 Attempt
   * 只能比较最终值，不得被描述成训练趋势；必须显式披露。 */
  const singlePoints = useMemo(
    () => (seriesReady ? singlePointSeries(selected, series) : []),
    [selected, series, seriesReady],
  );

  return (
    <section className="comparison-view" aria-label="严格实验对比">
      <div className="comparison-view__heading">
        <strong>严格实验对比</strong>
        <span>默认按数据、切分、任务、预处理与指标语义分组；结构/超参/轮数差异不阻止比较</span>
      </div>

      <ComparisonAttemptPicker
        ledger={ledger}
        experiments={scope.experiments}
        eligibleAttempts={scope.eligibleAttempts}
        untrustedCompleted={untrustedCompleted}
        partialAttempts={scope.partialAttempts}
        groups={groups}
        selectedIds={selectedIds}
        overflowNotice={overflowNotice}
        onToggle={toggleAttempt}
      />

      <ComparabilitySummary
        assessment={assessment}
        selectedCount={selected.length}
        overrideActive={overrideActive}
      />

      {/* 指标语义：多个共同指标时由用户显式选择；无共同指标时阻止严格展示并解释 */}
      {selected.length >= 2 && commonMetrics.length > 1 && (
        <div className="comparison-view__metric-choice">
          <label htmlFor="comparison-metric-select">共同指标（多条曲线必须同一口径）</label>
          <select
            id="comparison-metric-select"
            value={activeMetric ?? ''}
            onChange={event => setMetricChoice(event.target.value || null)}
          >
            {commonMetrics.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      )}
      {selected.length >= 2 && commonMetrics.length === 0 && !seriesConflict && (
        <Alert tone="warning" title="没有可共同严格展示的指标">
          所选 Attempt 缺少明确标记为 validation/epoch 且带指标名与优化方向的记录；旧档案不猜测语义，无法进入严格曲线。
        </Alert>
      )}
      {seriesConflict && (
        <Alert tone="warning" title="同一 Attempt 存在多个指标名">
          检测到指标 {seriesConflict.metricNames.join('、')}；不得随意选择第一项，请选择共同指标或调整选择。
        </Alert>
      )}

      {!assessment.strict && selected.length >= 2 && !overrideActive && (
        !overrideEntryAvailable ? (
          <Alert tone="warning" title="非严格对比不可用">
            当前没有可被诚实叠加的共同指标，非严格 override 也不能补造指标语义。
          </Alert>
        ) : auditPersistence !== 'healthy' ? (
          /* 审计状态与入口权限一致（最终证据闭环补丁）：不健康时不显示可执行按钮，
             只给禁用态 + 说明；requestOverride 内部 guard 保留作纵深防御。 */
          <div className="comparison-view__override-entry">
            <Alert tone="danger" title="审计链不健康，无法留痕">
              只追加审计当前为 {auditPersistence === 'degraded' ? '降级' : '不可用'}；非严格对比必须永久留痕后才能展示，因此不能越界展示。请先修复审计状态。
            </Alert>
            <Button size="small" variant="warning" disabled>
              仍然对比（带水印）
            </Button>
          </div>
        ) : (
          <div className="comparison-view__override-entry">
            <Button size="small" variant="warning" onClick={requestOverride}>
              仍然对比（带水印）
            </Button>
            <small>非严格对比需要显式确认并永久留痕；审计链不健康时失败关闭。</small>
          </div>
        )
      )}

      {overrideError && (
        <Alert tone="danger" title="非严格对比未生效">{overrideError}</Alert>
      )}

      {/* 水印声明独立于曲线渲染：即使序列不可用，override 生效状态也必须诚实可见 */}
      {overrideActive && selected.length >= 2 && (
        <p className="comparison-view__notice">
          非严格可比：此水印会进入导出报告。
          <small>仅对本次确认的精确 Attempt 集合与指标视图生效；增删 Attempt 或切换指标后需重新确认。</small>
        </p>
      )}

      {mayRender && activeMetric && (
        <ComparisonChartBoundary>
          {singlePoints.length > 0 && (
            <Alert tone="info" title="单点严格序列：只能比较最终值">
              以下 Attempt 仅有 1 个严格 validation/epoch 点：
              {singlePoints.map(item => {
                const attempt = scope.studyAttempts.find(candidate => candidate.id === item.attemptId);
                return attempt ? `${experimentNameOf(attempt)} · #${attempt.ordinal}` : `#${item.ordinal}`;
              }).join('、')}。
              单点不能解读训练过程趋势，也不构成趋势结论；当前对比仅限最终值，差值见最终指标表。
            </Alert>
          )}
          {coincidence && (
            <Alert tone="info" title="严格指标数值完全重合">
              所选曲线中有 {coincidence.attemptIds.length} 条的严格序列逐点（共 {coincidence.pointCount} 个 epoch）相同，
              几何上完全重叠。这是真实结果，未施加任何人为偏移；两次实验在此指标上未产生可观测差异。
              请通过图例与下方最终指标表区分各 Attempt 及其数值。
            </Alert>
          )}
          {seriesWarnings.length > 0 && (
            <Alert tone="warning" title="部分指标记录已被排除">
              {seriesWarnings.map(warning => {
                const attempt = scope.studyAttempts.find(item => item.id === warning.attemptId);
                const name = attempt ? experimentNameOf(attempt) : warning.attemptId;
                return `${name}（Attempt #${warning.ordinal}）：${warning.excludedCount} 条记录因数值非有限被排除`;
              }).join('；')}。非有限记录不进入图表与最终值；剩余合法点继续展示。
            </Alert>
          )}
          <MetricComparisonChart
            selected={selected}
            series={series}
            metricName={activeMetric}
            taskType={study.datasetContract.identity.taskType}
            overrideActive={overrideActive}
            experimentNameOf={attempt => experimentNameOf(attempt)}
          />
          <FinalMetricSummary
            selected={selected}
            series={series}
            taskType={study.datasetContract.identity.taskType}
            experimentNameOf={attempt => experimentNameOf(attempt)}
          />
        </ComparisonChartBoundary>
      )}
      {selected.length >= 2 && (assessment.strict || overrideActive) && !seriesReady && activeMetric && (
        <Alert tone="warning" title="曲线不可用">
          {/* 空态矩阵（M07-002~015）：逐 Attempt 给出具体失败原因，绝不空白无解释。 */}
          {selected.map((attempt, index) => {
            const failure = strictSeriesFailureText(series[index]);
            return failure ? `${experimentNameOf(attempt)} · #${attempt.ordinal}：${failure}` : null;
          }).filter(Boolean).join('；')}
          。图表与表格已失败关闭，不猜测语义。
        </Alert>
      )}

      {/* R2：只挂静态读法说明。主题集合不含选择、指标与资格信息，
          未选够实验或被阻止时同样只是通用解释，不暗示比较已获批准；
          必须常显的单点/重合/排除提醒、方差徽章与水印保持原位原条件。 */}
      <ResultReadingGuide topicIds={COMPARISON_READING_TOPIC_IDS} label="如何比较" />

      <VarianceEvidence qualification={qualification} />

      {observation && <p className="comparison-view__observation">{observation}</p>}

      <AblationEvidencePanel
        evidence={ablationEvidence}
        taskType={study.datasetContract.identity.taskType}
      />

      <ComparisonHistory restored={restored} activeEventId={historyMatch?.eventId ?? null} />

      {pendingOverride && currentOverrideContext && (
        <ComparisonOverrideDialog
          context={pendingOverride.context}
          fingerprint={pendingOverride.fingerprint}
          attemptLabels={pendingOverride.context.attemptIds.map(id => {
            const attempt = scope.studyAttempts.find(item => item.id === id);
            return attempt ? `${experimentNameOf(attempt)} · Attempt #${attempt.ordinal}` : id;
          })}
          confirming={confirmingOverride}
          onCancel={cancelOverride}
          onConfirm={() => { void confirmOverride(); }}
        />
      )}
    </section>
  );
}
