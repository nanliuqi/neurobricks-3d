/**
 * Experiment/Attempt 列表（模块 06）：
 * - 最新 Attempt 按 ordinal 确定（不假定数组末尾即最新）；
 * - 枚举一律中文标签；指标必须 Number.isFinite，缺失/NaN/Infinity 显示“指标不可用”；
 * - 指标标签来自真实 metricName，未知指标不冒充 Accuracy；
 * - 候选按钮保持既有可访问命名与业务规则（候选合法性由 runtime 最终裁决）。
 */
import Button from '@/components/ui/Button';
import type { Attempt, Experiment, Study } from '@/types/experiment';
import {
  extractStrictSeries,
  formatStrictMetricValue,
  strictMetricDescriptor,
} from '@/utils/metricSeries';
import { selectLatestAttempt, selectLatestSelectableCandidate } from './studyOverviewViewModel';
import { attemptStatusLabel, executionTrustLabel, metricNameLabel } from './studyLabels';
import type { PendingCandidateAction } from './useStudyPanelController';

interface StudyExperimentCardProps {
  study: Study;
  experiment: Experiment;
  experimentIndex: number;
  attempts: Attempt[];
  candidateLockedByClaim: boolean;
  onRequestCandidateAction: (action: PendingCandidateAction) => void;
}

/**
 * Experiment 列表只展示严格 validation/epoch 证据。
 * 不读取数组尾项、不使用旧 accuracy 字段回退，也不按任务类型猜测指标单位。
 */
export function strictMetricDisplay(attempt: Attempt, taskType: string): string {
  if (!Array.isArray(attempt.metrics) || attempt.metrics.length === 0) return '无指标';

  const descriptor = strictMetricDescriptor(attempt);
  if (!descriptor.available) return '严格验证指标不可用';

  const series = extractStrictSeries(attempt, descriptor.descriptor.metricName);
  if (!series.ok) return '严格验证指标不可用';
  const latestPoint = series.points[series.points.length - 1];
  if (!latestPoint) return '严格验证指标不可用';

  const label = metricNameLabel(series.metricName, taskType);
  const excludedSuffix = series.excludedCount > 0
    ? ` · 排除 ${series.excludedCount} 条异常记录`
    : '';
  return `${label} ${formatStrictMetricValue(series.metricName, latestPoint.value)} · epoch ${latestPoint.epoch}${excludedSuffix}`;
}

export function StudyExperimentCard({
  study,
  experiment,
  experimentIndex,
  attempts,
  candidateLockedByClaim,
  onRequestCandidateAction,
}: StudyExperimentCardProps) {
  const latest = selectLatestAttempt(attempts);
  const latestSelectable = selectLatestSelectableCandidate(attempts);
  const selectedInExperiment = attempts.find(item => item.id === study.selectedAttemptId) ?? null;
  const taskType = study.datasetContract.identity.taskType;

  // 当前候选不因同一 Experiment 出现更新 Attempt 而消失；同时保留最新可信入口。
  const candidateOptions = [selectedInExperiment, latestSelectable]
    .filter((item): item is Attempt => Boolean(item))
    .filter((item, index, items) => items.findIndex(candidate => candidate.id === item.id) === index);

  return (
    <div className="study-panel__experiment study-wb-experiment">
      <div className="study-panel__experiment-heading">
        <strong>方案 {experimentIndex + 1}</strong>
        <span className="study-panel__experiment-id">Experiment …{experiment.id.slice(-8)}</span>
      </div>
      <span className="study-panel__experiment-name" title={experiment.name}>{experiment.name}</span>
      <div className="study-panel__experiment-meta">
        <span>Attempt {attempts.length} 次</span>
        <span>{latest ? `最新 Attempt #${latest.ordinal} · ${attemptStatusLabel(latest.status)} · ${executionTrustLabel(latest.provenance.executionTrust)}` : '尚未运行'}</span>
        {latest && <span>seed {latest.config.seed ?? '未记录'}</span>}
        {latest && <span>LR {typeof latest.config.learningRate === 'number' && Number.isFinite(latest.config.learningRate) ? latest.config.learningRate : '未记录'}</span>}
        {latest && <span>WD {typeof latest.config.weightDecay === 'number' && Number.isFinite(latest.config.weightDecay) ? latest.config.weightDecay : '未记录'}</span>}
        {latest && <span>{strictMetricDisplay(latest, taskType)}</span>}
      </div>
      {experiment.differenceFromBaseline && experiment.differenceFromBaseline.length > 0 && (
        <small className="study-wb-diff">实际差异：{experiment.differenceFromBaseline.join('、')}</small>
      )}
      {study.kind === 'candidate_selection' && candidateOptions.map(candidate => {
        const isSelected = study.selectedAttemptId === candidate.id;
        const candidateSummary = `seed=${candidate.config.seed ?? '未记录'} · ${strictMetricDisplay(candidate, taskType)}`;
        const labelPrefix = `方案 ${experimentIndex + 1} · Attempt #${candidate.ordinal}`;
        return (
          <Button
            key={candidate.id}
            className="study-panel__candidate-button"
            data-selected={isSelected}
            disabled={candidateLockedByClaim}
            title={candidateLockedByClaim ? '候选已被评估主张引用，不能原地修改' : undefined}
            onClick={() => onRequestCandidateAction(
              isSelected
                ? { kind: 'revoke', label: labelPrefix }
                : {
                    kind: 'select',
                    attemptId: candidate.id,
                    label: labelPrefix,
                    replacing: Boolean(study.selectedAttemptId),
                  },
            )}
          >
            {isSelected
              ? `当前候选：${labelPrefix}（${candidateSummary}）· 点击撤回`
              : `选择${labelPrefix}（${candidateSummary}）`}
          </Button>
        );
      })}
    </div>
  );
}

interface StudyExperimentListProps {
  study: Study;
  experiments: Experiment[];
  attemptsByExperiment: Map<string, Attempt[]>;
  candidateLockedByClaim: boolean;
  onRequestCandidateAction: (action: PendingCandidateAction) => void;
}

export default function StudyExperimentList({
  study,
  experiments,
  attemptsByExperiment,
  candidateLockedByClaim,
  onRequestCandidateAction,
}: StudyExperimentListProps) {
  if (experiments.length === 0) {
    return (
      <div className="study-wb-empty-evidence">
        尚无证据。保持此 Study 激活后开始训练。
      </div>
    );
  }
  return (
    <section className="study-wb-section study-panel__experiments" aria-label="Experiment 列表">
      <h4 className="study-wb-section__title">Experiment 与 Attempt</h4>
      {experiments.map((experiment, experimentIndex) => (
        <StudyExperimentCard
          key={experiment.id}
          study={study}
          experiment={experiment}
          experimentIndex={experimentIndex}
          attempts={attemptsByExperiment.get(experiment.id) ?? []}
          candidateLockedByClaim={candidateLockedByClaim}
          onRequestCandidateAction={onRequestCandidateAction}
        />
      ))}
    </section>
  );
}
