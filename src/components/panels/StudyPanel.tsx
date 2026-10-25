import { useMemo, type CSSProperties } from 'react';
import type { Attempt } from '@/types/experiment';
import ClaimComposer from '@/components/study/ClaimComposer';
import ComparisonView from '@/components/study/ComparisonView';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StudySwitcher from './study/StudySwitcher';
import StudyCreateForm from './study/StudyCreateForm';
import StudyOverviewHeader from './study/StudyOverviewHeader';
import StudyContractSummary from './study/StudyContractSummary';
import StudyBudgetSummary from './study/StudyBudgetSummary';
import StudyEvidenceSummarySection from './study/StudyEvidenceSummary';
import StudyExperimentList from './study/StudyExperimentList';
import StudyCandidateControls from './study/StudyCandidateControls';
import StudyAuditStatus from './study/StudyAuditStatus';
import { useStudyPanelController } from './study/useStudyPanelController';

interface StudyPanelProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Study 总览组装外壳（模块 06）：
 * - 只从控制层读取状态、组合各职责子模块；业务合法性仍由 runtime 裁决；
 * - ComparisonView / ClaimComposer 保持既有挂载条件，不放入会卸载子树的折叠结构；
 * - 不自渲染面板主标题、不设固定宽度（宿主 RightPanelHost 负责）。
 */
export default function StudyPanel({ className, style }: StudyPanelProps) {
  const controller = useStudyPanelController();
  const {
    activeStudy,
    evidence,
    evidenceSummary,
    claimProjection,
    visibleStudies,
    archivedStudyCount,
    candidateLockedByClaim,
    auditPersistence,
    auditError,
    datasetInfo,
    targetField,
  } = controller;

  const attemptsByExperiment = useMemo(() => {
    const map = new Map<string, Attempt[]>();
    for (const attempt of evidence.attempts) {
      const list = map.get(attempt.experimentId);
      if (list) list.push(attempt);
      else map.set(attempt.experimentId, [attempt]);
    }
    return map;
  }, [evidence.attempts]);

  const selectedAttempt = activeStudy?.selectedAttemptId
    ? evidence.attempts.find(attempt => attempt.id === activeStudy.selectedAttemptId) ?? null
    : null;
  const selectedExperimentName = activeStudy?.selectedExperimentId
    ? evidence.experiments.find(experiment => experiment.id === activeStudy.selectedExperimentId)?.name
    : undefined;

  return (
    <div className={['study-panel', className].filter(Boolean).join(' ')} style={style}>
      <StudySwitcher
        visibleStudies={visibleStudies}
        activeStudyId={activeStudy?.id ?? null}
        archivedStudyCount={archivedStudyCount}
        formOpen={controller.formOpen}
        onSwitch={controller.handleSwitchStudy}
        onToggleForm={controller.toggleForm}
      />

      {controller.formOpen && (
        <StudyCreateForm
          draft={controller.draft}
          submitting={controller.submitting}
          createError={controller.createError}
          datasetInfo={datasetInfo}
          targetField={targetField}
          onUpdate={controller.updateDraft}
          onSubmit={() => { void controller.handleCreate(); }}
        />
      )}

      {!activeStudy ? (
        <div className="study-panel__empty">
          当前为快速路径：无活动 Study。下一次训练会自动进入按可比性键分组的草稿课题；
          也可以在上方新建一个有明确问题的课题。
        </div>
      ) : (
        <div className="study-panel__content">
          <StudyOverviewHeader
            study={activeStudy}
            selectedExperimentName={selectedExperimentName}
            candidateLockedByClaim={candidateLockedByClaim}
            onRequestArchive={controller.requestArchive}
          />

          {activeStudy.selectedAttemptId && candidateLockedByClaim && (
            <div className="study-panel__candidate-lock">
              当前候选已被评估主张引用，不能撤回或更换。需要验证其他权重时请新建 Study。
            </div>
          )}

          <StudyContractSummary study={activeStudy} />

          <StudyBudgetSummary
            study={activeStudy}
            experiments={evidence.experiments}
            attempts={evidence.attempts}
          />

          <StudyEvidenceSummarySection
            study={activeStudy}
            summary={evidenceSummary}
            claimProjection={claimProjection ?? {
              total: 0,
              adjudicatedRecords: 0,
              formalVerdictRecords: 0,
              auditCompleteRecords: 0,
              structuralAnomalyCount: 0,
              nonAuthoritativeCount: 0,
              persistenceBlockedCount: 0,
              trustCounts: { not_evaluated: 0, exploratory: 0, iid_only: 0, gold: 0 },
              highestEffectiveTrust: null,
              records: [],
            }}
            auditPersistence={auditPersistence}
            candidateAttemptOrdinal={selectedAttempt?.ordinal ?? null}
          />

          <StudyExperimentList
            study={activeStudy}
            experiments={evidence.experiments}
            attemptsByExperiment={attemptsByExperiment}
            candidateLockedByClaim={candidateLockedByClaim}
            onRequestCandidateAction={controller.requestCandidateAction}
          />

          {/* 模块 07/08 入口保持既有挂载条件与内部语义，仅归入更清晰的区域标题；
              key 绑定 Study 身份：切换时彻底重建局部状态，杜绝旧 Study 曲线/pending 确认残留一帧 */}
          <section className="study-wb-section" aria-label="证据对比与主张">
            <h4 className="study-wb-section__title">证据对比与主张</h4>
            <ComparisonView key={activeStudy.id} study={activeStudy} />
            {activeStudy.kind === 'candidate_selection' ? (
              <ClaimComposer study={activeStudy} />
            ) : (
              <div className="study-panel__language">单模型验收主张需从当前发现新建候选选择型 Study，并先留痕选定具体权重。</div>
            )}
          </section>

          <StudyAuditStatus auditPersistence={auditPersistence} auditError={auditError} />
        </div>
      )}

      {controller.pendingArchive && activeStudy && (
        <ConfirmDialog
          title="归档这个课题？"
          description={
            <>
              <p>“{activeStudy.name}”归档后不再进入活动列表，但 Study、Experiment、Attempt、Claim 和审计记录均保留。</p>
              <p>归档不是物理删除；仍有运行中或暂停的 Attempt 时，运行时将拒绝归档。</p>
            </>
          }
          confirmLabel="确认归档"
          cancelLabel="取消"
          tone="warning"
          onCancel={controller.cancelArchive}
          onConfirm={controller.confirmArchive}
        />
      )}

      <StudyCandidateControls
        pendingAction={controller.pendingCandidateAction}
        onCancel={controller.cancelCandidateAction}
        onConfirm={controller.confirmCandidateAction}
      />
    </div>
  );
}
