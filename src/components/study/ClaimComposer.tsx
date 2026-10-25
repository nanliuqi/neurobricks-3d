/**
 * 评估主张工作流（模块 08 重构）：本组件只负责组合。
 * - 规则与投影在 claimComposerViewModel（纯函数），动作协调在 useClaimWorkflowController；
 * - 候选绑定只读、草稿按 role 编辑、冻结/解封始终经过完整复核确认框；
 * - 有效信任一律消费 projectEffectiveClaimTrust，绝不直接读存档 conclusionTrust 背书；
 * - 不修改统计裁决与信任协议，不实现 post_hoc 创建。
 */
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { EvaluationClaim, Study } from '@/types/experiment';
import { projectEffectiveClaimTrust, type EffectiveClaimTrustProjection } from '@/utils/claimProtocol';
import { useClaimWorkflowController } from '@/hooks/useClaimWorkflowController';
import ClaimAuditBanner from './claim/ClaimAuditBanner';
import ClaimCandidateBinding from './claim/ClaimCandidateBinding';
import ClaimDraftEditor from './claim/ClaimDraftEditor';
import ClaimFreezeReview from './claim/ClaimFreezeReview';
import ClaimRecordCard from './claim/ClaimRecordCard';
import ClaimUnsealReview from './claim/ClaimUnsealReview';

interface ClaimComposerProps {
  study: Study;
}

export default function ClaimComposer({ study }: ClaimComposerProps) {
  const {
    composerRef,
    ledger,
    binding,
    claims,
    predicates,
    updatePredicate,
    addGuardrail,
    removeGuardrail,
    editingClaim,
    bindingDrifted,
    structure,
    formEligibility,
    auditPersistence,
    auditError,
    auditHealthy,
    preflightPreview,
    busy,
    pendingConfirmation,
    handleSaveDraft,
    handleFreeze,
    cancelPendingConfirmation,
    confirmFreeze,
    handleEditDraft,
    handleCancelEditing,
    handleEvaluate,
    confirmEvaluate,
    handleRepairAudit,
    unsealReviewFor,
    unsealButtonState,
  } = useClaimWorkflowController(study);

  // 有效信任消费协议层单一投影（模块 06 语义保持）：审计链不完整、档案持久化非 healthy、
  // 存档未知或不一致时绝不显示 gold；与 Study 总览/报告/导出等级一致。
  const claimProjection = (claim: EvaluationClaim): EffectiveClaimTrustProjection => {
    const attempt = ledger.attempts.find(item => item.id === claim.attemptId) ?? null;
    return projectEffectiveClaimTrust({ study, claim, attempt, events: ledger.events, auditPersistence });
  };

  const pendingDraft = pendingConfirmation?.kind === 'freeze'
    ? claims.find(claim => claim.id === pendingConfirmation.claimId) ?? null
    : null;
  const pendingDraftAttempt = pendingDraft
    ? ledger.attempts.find(attempt => attempt.id === pendingDraft.attemptId) ?? null
    : null;
  const pendingDraftExperiment = pendingDraftAttempt
    ? ledger.experiments.find(experiment => experiment.id === pendingDraftAttempt.experimentId) ?? null
    : null;
  const pendingUnseal = pendingConfirmation?.kind === 'evaluate'
    ? unsealReviewFor(pendingConfirmation.claimId)
    : null;

  return (
    <section ref={composerRef} className="claim-composer" aria-label="评估主张">
      <div className="claim-composer__heading">
        <strong>冻结评估主张</strong>
        <span>测试集答案可见前钉死指标、阈值、模型和统计方法</span>
      </div>

      <ClaimAuditBanner
        auditPersistence={auditPersistence}
        auditError={auditError}
        busy={busy}
        onRepair={() => void handleRepairAudit()}
      />

      <ClaimCandidateBinding binding={binding} />

      <ClaimDraftEditor
        study={study}
        predicates={predicates}
        structure={structure}
        bindingDrifted={bindingDrifted}
        editingRevision={editingClaim?.revision ?? null}
        preflightPreview={preflightPreview}
        busy={busy}
        canBind={formEligibility.allowed}
        auditHealthy={auditHealthy}
        onUpdatePredicate={updatePredicate}
        onAddGuardrail={addGuardrail}
        onRemoveGuardrail={removeGuardrail}
        onSaveDraft={handleSaveDraft}
        onFreeze={handleFreeze}
        onCancelEditing={handleCancelEditing}
      />

      <div className="claim-composer__claims">
        {claims.map(claim => (
          <ClaimRecordCard
            key={claim.id}
            claim={claim}
            study={study}
            attempt={ledger.attempts.find(item => item.id === claim.attemptId) ?? null}
            projection={claimProjection(claim)}
            unsealState={unsealButtonState(claim.id)}
            busy={busy}
            onEvaluate={handleEvaluate}
            onEditDraft={handleEditDraft}
          />
        ))}
      </div>

      {pendingConfirmation?.kind === 'freeze' && pendingDraft && (
        <ConfirmDialog
          title="确认冻结这条评估主张？"
          description={(
            <ClaimFreezeReview
              draft={pendingDraft}
              study={study}
              experiment={pendingDraftExperiment}
              attemptOrdinal={pendingDraftAttempt?.ordinal ?? null}
              warnings={pendingConfirmation.warnings}
            />
          )}
          confirmLabel="确认冻结"
          busy={busy}
          onCancel={cancelPendingConfirmation}
          onConfirm={() => void confirmFreeze(pendingConfirmation.claimId)}
        />
      )}

      {pendingConfirmation?.kind === 'evaluate' && pendingUnseal && (
        <ConfirmDialog
          title={pendingConfirmation.retrying ? '继续既定裁决？' : '确认解封并裁决？'}
          description={<ClaimUnsealReview review={pendingUnseal} />}
          confirmLabel={pendingConfirmation.retrying ? '继续裁决' : '确认解封'}
          tone={pendingConfirmation.retrying ? 'warning' : 'danger'}
          busy={busy}
          onCancel={cancelPendingConfirmation}
          onConfirm={() => void confirmEvaluate(pendingConfirmation.claimId)}
        />
      )}
    </section>
  );
}
