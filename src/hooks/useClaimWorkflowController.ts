/**
 * Claim 工作流控制器（模块 08）：表单状态、草稿编辑、pending 确认与动作协调。
 * - 冻结与解封只在 auditPersistence === 'healthy' 时开放；degraded/unavailable 一律失败关闭；
 * - 点击操作与最终确认都重新读取最新 store 快照（revision/predicates/绑定/哈希/审计/预演），
 *   确认期间任何变化均拒绝执行；
 * - 双击确认由同步锁保证只执行一次；
 * - 候选变更后旧草稿不得改绑保存（bindingDrifted 阻断）；
 * - 不复制统计与信任协议：预演走 preflightClaim/preflightRegisteredClaim，裁决走 evaluateFrozenClaim。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import {
  evaluateFrozenClaim,
  freezeRegisteredClaim,
  preflightRegisteredClaim,
  saveClaimDraft,
} from '@/claimRuntime';
import { useExperimentStore, verifyExperimentLedgerAudit } from '@/stores/useExperimentStore';
import type { ClaimPredicate, MetricName, Study } from '@/types/experiment';
import { preflightClaim } from '@/utils/claimProtocol';
import { projectClaimUnseal } from '@/utils/claimUnsealProjection';
import {
  candidateBinding,
  claimLabelSet,
  draftBindingDrifted,
  unsealIdentityGate,
  unsealReview,
  validatePredicateStructure,
} from '@/utils/claimComposerViewModel';

/* ---------------- 表单构造纯助手（默认值与协议联动） ---------------- */

export function createPredicate(taskType: Study['datasetContract']['identity']['taskType'], role: ClaimPredicate['role'], index: number): ClaimPredicate {
  if (taskType === 'tabular_regression') {
    return {
      id: `${role}-${index}`, role, metric: 'mae', operator: 'lte', threshold: 0.1,
      confidenceLevel: 0.95, intervalMethod: 'seeded_bootstrap', minimumEffectiveSampleSize: 30,
      bootstrapSamples: 2000, bootstrapSeed: 42,
    };
  }
  return {
    id: `${role}-${index}`, role, metric: 'recall', operator: 'gte', threshold: 0.95,
    targetClass: '1', aggregation: 'binary', confidenceLevel: 0.95,
    intervalMethod: 'wilson', minimumEffectiveSampleSize: 20,
  };
}

export function normalizeMetric(predicate: ClaimPredicate, metric: MetricName): ClaimPredicate {
  const lowerIsBetter = ['false_positive_rate', 'mae', 'rmse'].includes(metric);
  const usesBootstrap = ['macro_f1', 'mae', 'rmse', 'r2'].includes(metric);
  const needsTarget = ['recall', 'precision', 'false_positive_rate'].includes(metric);
  return {
    ...predicate,
    metric,
    operator: lowerIsBetter ? 'lte' : 'gte',
    intervalMethod: usesBootstrap ? 'seeded_bootstrap' : 'wilson',
    targetClass: needsTarget ? (predicate.targetClass ?? '1') : undefined,
    aggregation: metric === 'macro_f1' ? 'macro' : needsTarget ? 'binary' : undefined,
    bootstrapSamples: usesBootstrap ? (predicate.bootstrapSamples ?? 2000) : undefined,
    bootstrapSeed: usesBootstrap ? (predicate.bootstrapSeed ?? 42) : undefined,
  };
}

export function nextGuardrailId(predicates: ClaimPredicate[]): string {
  const highest = predicates.reduce((maximum, predicate) => {
    const match = /^guardrail-(\d+)$/.exec(predicate.id);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `guardrail-${highest + 1}`;
}

/* ---------------- pending 确认（含冻结/解封快照） ---------------- */

export interface FreezeSnapshot {
  revision: number | null;
  predicatesJson: string;
  attemptId: string;
  modelWeightsHash: string | null;
  testSetHash: string | null;
  preprocessingHash: string | null;
}

export interface EvaluateSnapshot {
  studyId: string;
  attemptId: string;
  revision: number | null;
  frozenHash: string | null;
  /** 冻结 Claim 自身身份。 */
  claimModelWeightsHash: string | null;
  claimTestDatasetHash: string | null;
  claimPreprocessingHash: string | null;
  /** 请求时当前 Attempt 身份（确认时逐项比对）。 */
  attemptModelWeightsHash: string | null;
  attemptTestSetHash: string | null;
  attemptPreprocessingHash: string | null;
  attemptModelId: string | null;
  /** 解封模式与序号（确认时重算投影必须一致）。 */
  mode: 'first' | 'subsequent' | 'retry';
  sequence: number;
}

export type PendingConfirmation =
  | { kind: 'freeze'; claimId: string; warnings: string[]; snapshot: FreezeSnapshot }
  | { kind: 'evaluate'; claimId: string; retrying: boolean; snapshot: EvaluateSnapshot };

export function useClaimWorkflowController(study: Study) {
  const composerRef = useRef<HTMLElement>(null);
  // 同步锁：双击冻结/解封确认只能执行一次（不依赖渲染后的 disabled）。
  const actionInFlightRef = useRef(false);
  const ledger = useExperimentStore(state => state.ledger);
  const auditPersistence = useExperimentStore(state => state.auditPersistence);
  const auditError = useExperimentStore(state => state.auditError);

  const binding = useMemo(() => candidateBinding(study, ledger), [study, ledger]);
  const claims = useMemo(
    () => ledger.claims.filter(claim => claim.studyId === study.id),
    [ledger.claims, study.id],
  );

  const [predicates, setPredicates] = useState<ClaimPredicate[]>([
    createPredicate(study.datasetContract.identity.taskType, 'primary', 0),
  ]);
  const [editingClaimId, setEditingClaimId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  // Study / 任务类型切换：清空表单、编辑态与 pending 确认，杜绝跨 Study 残留。
  useEffect(() => {
    setPredicates([createPredicate(study.datasetContract.identity.taskType, 'primary', 0)]);
    setEditingClaimId(null);
    setPendingConfirmation(null);
  }, [study.datasetContract.identity.taskType, study.id]);

  const editingClaim = editingClaimId
    ? claims.find(claim => claim.id === editingClaimId && claim.status === 'draft') ?? null
    : null;
  const bindingDrifted = draftBindingDrifted(editingClaim, binding);
  const structure = validatePredicateStructure(predicates);
  const auditHealthy = auditPersistence === 'healthy';

  // 新主张只能绑定当前候选；编辑中的草稿保持自己原有绑定（不跟随候选改绑）。
  const attemptIdForActions = editingClaim ? editingClaim.attemptId : binding.attempt?.id ?? '';
  const selectedAttempt = ledger.attempts.find(attempt => attempt.id === attemptIdForActions) ?? null;

  /**
   * 表单动作资格（三层同源：按钮禁用态 / 入口闸门 / 确认复核）：
   * - 新建：必须 binding.canCreateClaim（不允许“卡片写暂不可创建但按钮可点”）；
   * - 编辑草稿：重新检查其绑定 Attempt 属于当前 Study、仍是当前候选、
   *   completed、trusted、三身份哈希完整；未知状态失败关闭。
   */
  const formEligibility = useMemo((): { allowed: boolean; reason: string | null } => {
    if (!editingClaim) {
      return binding.canCreateClaim
        ? { allowed: true, reason: null }
        : { allowed: false, reason: binding.blockers[0] ?? '当前没有可绑定的候选 Attempt' };
    }
    const attempt = ledger.attempts.find(item => item.id === editingClaim.attemptId) ?? null;
    const experiment = attempt ? ledger.experiments.find(item => item.id === attempt.experimentId) ?? null : null;
    if (!attempt || !experiment || experiment.studyId !== study.id) {
      return { allowed: false, reason: '草稿绑定的 Attempt/Experiment 不存在或不属于当前 Study' };
    }
    if (study.selectedAttemptId !== attempt.id) {
      return { allowed: false, reason: '候选绑定已变化：该草稿绑定的 Attempt 不再是当前候选，不得改绑保存' };
    }
    if (attempt.status !== 'completed') return { allowed: false, reason: '草稿绑定的 Attempt 不再是已完成运行' };
    if (attempt.provenance.executionTrust !== 'trusted') return { allowed: false, reason: '草稿绑定的 Attempt 不再是受控可信执行' };
    if (!attempt.provenance.modelWeightsHash || !attempt.provenance.testSetHash || !attempt.provenance.preprocessingHash) {
      return { allowed: false, reason: '草稿绑定的 Attempt 身份哈希不完整' };
    }
    return { allowed: true, reason: null };
  }, [editingClaim, binding, ledger.attempts, ledger.experiments, study.id, study.selectedAttemptId]);

  const preflightPreview = useMemo(() => {
    if (!selectedAttempt) return null;
    try {
      return { ...preflightClaim(predicates, selectedAttempt), error: null as string | null };
    } catch (error) {
      return { blockers: [], warnings: [], error: (error as Error).message };
    }
  }, [predicates, selectedAttempt]);

  const updatePredicate = (predicateId: string, patch: Partial<ClaimPredicate>) => {
    setPredicates(current => current.map(predicate => (
      predicate.id === predicateId ? { ...predicate, ...patch } : predicate
    )));
  };

  const addGuardrail = () => {
    setPredicates(current => {
      const guardrailCount = current.filter(predicate => predicate.role === 'guardrail').length;
      if (guardrailCount >= 2) return current;
      const created = createPredicate(study.datasetContract.identity.taskType, 'guardrail', current.length);
      return [...current, { ...created, id: nextGuardrailId(current) }];
    });
  };

  const removeGuardrail = (predicateId: string) => {
    setPredicates(current => current.filter(predicate => !(predicate.id === predicateId && predicate.role === 'guardrail')));
  };

  /** 动作前置闸门：漂移/结构错误/资格投影不允许一律阻断（保存与冻结共用，与按钮禁用态同源）。 */
  const guardFormAction = (): boolean => {
    if (bindingDrifted) {
      toast.error('候选绑定已变化：该旧草稿不得以新候选保存或冻结。请退出编辑，为当前候选创建新草稿。');
      return false;
    }
    if (structure.errors.length > 0) {
      toast.error(`子句结构错误：${structure.errors.join('；')}`);
      return false;
    }
    if (!formEligibility.allowed) {
      toast.error(formEligibility.reason ?? '当前不满足保存/冻结资格');
      return false;
    }
    return true;
  };

  const handleSaveDraft = () => {
    if (!attemptIdForActions) {
      toast.error('当前 Study 没有可绑定的候选 Attempt；请先在候选控制中完成候选选择。');
      return;
    }
    if (!guardFormAction()) return;
    try {
      const draft = saveClaimDraft(attemptIdForActions, predicates, editingClaimId ?? undefined);
      setEditingClaimId(draft.id);
      // 档案不健康时不得声称已完整持久化。
      toast.success(auditHealthy
        ? `主张草稿已保存（版本 ${draft.revision}）`
        : `主张草稿已保存（版本 ${draft.revision}）；档案持久化当前为${auditPersistence === 'degraded' ? '降级' : '不可用'}，本次保存不声称已完整持久化`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleFreeze = () => {
    // 冻结必须留痕：只有 healthy 才开放（degraded/unavailable 一律失败关闭）。
    if (!auditHealthy) {
      toast.error(`档案持久化当前为${auditPersistence === 'degraded' ? '降级' : '不可用'}；冻结必须写入只追加审计链，已失败关闭。请先修复审计状态。`);
      return;
    }
    if (!attemptIdForActions) {
      toast.error('当前 Study 没有可绑定的候选 Attempt；请先完成候选选择。');
      return;
    }
    if (!guardFormAction()) return;
    try {
      // 点击冻结先保存当前草稿版本；确认框取消后继续编辑同一草稿，不复制新主张。
      const draft = saveClaimDraft(attemptIdForActions, predicates, editingClaimId ?? undefined);
      const preflight = preflightRegisteredClaim(draft.id);
      if (preflight.blockers.length > 0) throw new Error(preflight.blockers.join('；'));
      setEditingClaimId(draft.id);
      const attempt = ledger.attempts.find(item => item.id === draft.attemptId) ?? null;
      setPendingConfirmation({
        kind: 'freeze',
        claimId: draft.id,
        warnings: preflight.warnings,
        snapshot: {
          revision: draft.revision ?? null,
          predicatesJson: JSON.stringify(draft.predicates),
          attemptId: draft.attemptId,
          modelWeightsHash: attempt?.provenance.modelWeightsHash ?? null,
          testSetHash: attempt?.provenance.testSetHash ?? null,
          preprocessingHash: attempt?.provenance.preprocessingHash ?? null,
        },
      });
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const cancelPendingConfirmation = () => {
    if (pendingConfirmation?.kind === 'freeze') {
      toast.info('草稿已保存但尚未冻结；可继续编辑同一版本，冻结前不会产生新主张。');
    }
    setPendingConfirmation(null);
  };

  const confirmFreeze = async (claimId: string) => {
    if (actionInFlightRef.current) return;
    const pending = pendingConfirmation;
    if (!pending || pending.kind !== 'freeze') return;
    actionInFlightRef.current = true;
    setBusy(true);
    try {
      // 确认瞬间重新读取最新 store：任何变化都拒绝冻结并要求重新复核。
      const state = useExperimentStore.getState();
      const draft = state.ledger.claims.find(claim => claim.id === claimId);
      if (!draft || draft.status !== 'draft') throw new Error('草稿已不存在或状态已变化；冻结已取消，请重新复核。');
      if (
        (draft.revision ?? null) !== pending.snapshot.revision
        || JSON.stringify(draft.predicates) !== pending.snapshot.predicatesJson
        || draft.attemptId !== pending.snapshot.attemptId
      ) {
        throw new Error('草稿版本、子句或 Attempt 绑定在确认期间发生变化；已拒绝冻结，请重新复核。');
      }
      const attempt = state.ledger.attempts.find(item => item.id === draft.attemptId) ?? null;
      if (
        !attempt
        || attempt.provenance.modelWeightsHash !== pending.snapshot.modelWeightsHash
        || attempt.provenance.testSetHash !== pending.snapshot.testSetHash
        || attempt.provenance.preprocessingHash !== pending.snapshot.preprocessingHash
      ) {
        throw new Error('绑定 Attempt 的身份哈希在确认期间发生变化；已拒绝冻结，请重新复核。');
      }
      // 候选复核（模块 08 可信边界补丁）：确认框打开后更换候选必须拒绝冻结。
      const freshStudy = state.ledger.studies.find(item => item.id === draft.studyId);
      const freshExperiment = state.ledger.experiments.find(item => item.id === attempt.experimentId);
      if (!freshStudy || freshStudy.id !== study.id) {
        throw new Error('草稿所属 Study 在确认期间发生变化；已拒绝冻结。');
      }
      if (!freshExperiment || freshExperiment.studyId !== study.id) {
        throw new Error('Experiment 归属在确认期间发生变化；已拒绝冻结。');
      }
      if (freshStudy.selectedAttemptId !== draft.attemptId) {
        throw new Error('当前候选已变化，请重新复核；本次冻结已拒绝，主张保持草稿。');
      }
      if (freshStudy.selectedExperimentId && freshStudy.selectedExperimentId !== attempt.experimentId) {
        throw new Error('当前候选实验与绑定 Attempt 所属实验不一致，请重新复核；本次冻结已拒绝。');
      }
      if (attempt.status !== 'completed' || attempt.provenance.executionTrust !== 'trusted') {
        throw new Error('绑定 Attempt 不再是完成且受控可信状态；已拒绝冻结。');
      }
      if (state.auditPersistence !== 'healthy') {
        throw new Error('档案持久化在确认期间发生变化；冻结已失败关闭，请修复审计状态后重新发起。');
      }
      const freshPreflight = preflightClaim(draft.predicates, attempt);
      if (freshPreflight.blockers.length > 0) throw new Error(freshPreflight.blockers.join('；'));
      // 警告必须与用户刚才确认的完全一致：增减或变化都要求重新复核。
      if ([...freshPreflight.warnings].sort().join('|') !== [...pending.warnings].sort().join('|')) {
        throw new Error('统计预演警告在确认期间发生变化；已拒绝冻结，请重新复核后再确认。');
      }

      const result = await freezeRegisteredClaim(claimId, true);
      setEditingClaimId(null);
      setPendingConfirmation(null);
      toast.success(`主张已冻结：${result.claim.frozenHash?.slice(0, 18)}…`);
    } catch (error) {
      setPendingConfirmation(null);
      toast.error((error as Error).message);
    } finally {
      actionInFlightRef.current = false;
      setBusy(false);
    }
  };

  const handleEditDraft = (claimId: string) => {
    const draft = claims.find(claim => claim.id === claimId && claim.status === 'draft');
    if (!draft) return;
    setPredicates(draft.predicates.map(predicate => ({ ...predicate })));
    setEditingClaimId(draft.id);
    toast.info(`已载入主张草稿 v${draft.revision}；上方字段现在可以编辑，保存后会形成新版本`);
    window.requestAnimationFrame(() => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleCancelEditing = () => {
    setEditingClaimId(null);
    setPredicates([createPredicate(study.datasetContract.identity.taskType, 'primary', 0)]);
    toast.info('已退出草稿编辑；已保存版本保持不变');
  };

  const handleEvaluate = (claimId: string) => {
    const claim = claims.find(item => item.id === claimId);
    if (!claim || claim.status !== 'frozen') return;
    // 解封必须留痕：healthy 才开放；degraded 与 unavailable 都失败关闭（纵深防御，入口按钮同样禁用）。
    if (auditPersistence !== 'healthy') {
      toast.error(auditPersistence === 'degraded'
        ? '只追加审计链尚未恢复健康；请先点击“修复并重新校验审计链”'
        : '档案持久化不可用；解封必须留痕，已失败关闭。');
      return;
    }
    const attempt = ledger.attempts.find(item => item.id === claim.attemptId) ?? null;
    const experiment = attempt ? ledger.experiments.find(item => item.id === attempt.experimentId) ?? null : null;
    const gate = unsealIdentityGate(claim, attempt, experiment, study);
    if (!gate.allowed) {
      toast.error(`解封已关闭：${gate.reasons.join('；')}。封存集未访问。`);
      return;
    }
    // 解封模式与序号消费测试集级共享投影（与 evaluateFrozenClaim 同源）；invalid 失败关闭。
    const projection = projectClaimUnseal(claim, ledger.events);
    if (projection.mode === 'invalid' || projection.sequence === null) {
      toast.error(`解封档案冲突：${projection.reasons.join('；')}。封存集未访问。`);
      return;
    }
    setPendingConfirmation({
      kind: 'evaluate',
      claimId,
      retrying: projection.mode === 'retry',
      snapshot: {
        studyId: claim.studyId,
        attemptId: claim.attemptId,
        revision: claim.revision ?? null,
        frozenHash: claim.frozenHash,
        claimModelWeightsHash: claim.modelWeightsHash,
        claimTestDatasetHash: claim.testDatasetHash,
        claimPreprocessingHash: claim.preprocessingHash,
        attemptModelWeightsHash: attempt?.provenance.modelWeightsHash ?? null,
        attemptTestSetHash: attempt?.provenance.testSetHash ?? null,
        attemptPreprocessingHash: attempt?.provenance.preprocessingHash ?? null,
        attemptModelId: attempt?.modelId ?? null,
        mode: projection.mode,
        sequence: projection.sequence,
      },
    });
  };

  const confirmEvaluate = async (claimId: string) => {
    if (actionInFlightRef.current) return;
    const pending = pendingConfirmation;
    if (!pending || pending.kind !== 'evaluate') return;
    actionInFlightRef.current = true;
    setBusy(true);
    try {
      // 确认瞬间重新读取最新 store：完整冻结身份、归属、投影与审计状态任一变化即拒绝。
      const state = useExperimentStore.getState();
      const claim = state.ledger.claims.find(item => item.id === claimId);
      if (!claim || claim.status !== 'frozen') throw new Error('主张已不在已冻结状态；解封已取消。');
      const snap = pending.snapshot;
      if (
        claim.studyId !== snap.studyId
        || claim.attemptId !== snap.attemptId
        || (claim.revision ?? null) !== snap.revision
        || claim.frozenHash !== snap.frozenHash
        || claim.modelWeightsHash !== snap.claimModelWeightsHash
        || claim.testDatasetHash !== snap.claimTestDatasetHash
        || claim.preprocessingHash !== snap.claimPreprocessingHash
      ) {
        throw new Error('冻结主张身份（studyId/attemptId/revision/三哈希）在确认期间发生变化；已拒绝访问封存集。');
      }
      const attempt = state.ledger.attempts.find(item => item.id === claim.attemptId) ?? null;
      const experiment = attempt ? state.ledger.experiments.find(item => item.id === attempt.experimentId) ?? null : null;
      if (
        !attempt || !experiment || experiment.studyId !== claim.studyId
        || attempt.modelId !== snap.attemptModelId || !attempt.modelId
        || attempt.provenance.modelWeightsHash !== snap.attemptModelWeightsHash
        || attempt.provenance.testSetHash !== snap.attemptTestSetHash
        || attempt.provenance.preprocessingHash !== snap.attemptPreprocessingHash
      ) {
        throw new Error('当前 Attempt 身份或归属在确认期间发生变化（身份漂移）；已拒绝访问封存集。');
      }
      // 身份闸门使用最新 ledger 解析的 fresh Study，不依赖闭包中的旧 props。
      const freshStudy = state.ledger.studies.find(item => item.id === claim.studyId) ?? null;
      const gate = freshStudy
        ? unsealIdentityGate(claim, attempt, experiment, freshStudy)
        : { allowed: false, reasons: ['归属 Study 在最新档案中不存在'] };
      if (!gate.allowed) {
        throw new Error(`解封已关闭：${gate.reasons.join('；')}。封存集未访问。`);
      }
      // 投影重算：模式与序号必须与请求时一致（确认期间新增解封事件即拒绝）。
      const projection = projectClaimUnseal(claim, state.ledger.events);
      if (projection.mode !== snap.mode || projection.sequence !== snap.sequence) {
        throw new Error('解封投影在确认期间发生变化（模式或序号）；已拒绝执行，请重新发起。');
      }
      if (state.auditPersistence !== 'healthy') {
        throw new Error('档案持久化在确认期间发生变化；解封已失败关闭。');
      }
      const result = await evaluateFrozenClaim(claimId);
      setPendingConfirmation(null);
      toast.success(`裁决完成：${claimLabelSet(result).verdictText}`);
    } catch (error) {
      setPendingConfirmation(null);
      toast.error((error as Error).message);
    } finally {
      actionInFlightRef.current = false;
      setBusy(false);
    }
  };

  const handleRepairAudit = async () => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setBusy(true);
    try {
      const repaired = await verifyExperimentLedgerAudit();
      if (!repaired) throw new Error(useExperimentStore.getState().auditError ?? '审计链仍不完整');
      toast.success('只追加审计链已恢复健康，可以继续解封裁决');
    } catch (error) {
      toast.error(`审计链修复失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      actionInFlightRef.current = false;
      setBusy(false);
    }
  };

  /** 解封复核视图（first/subsequent/retry）；invalid 或身份漂移不生成。 */
  const unsealReviewFor = (claimId: string) => {
    const claim = claims.find(item => item.id === claimId);
    if (!claim) return null;
    const attempt = ledger.attempts.find(item => item.id === claim.attemptId) ?? null;
    return unsealReview(claim, attempt, projectClaimUnseal(claim, ledger.events));
  };

  /** 解封按钮文案与禁用态：审计、身份闸门、投影 invalid 全部失败关闭，文案区分四种状态。 */
  const unsealButtonState = (claimId: string): { label: string; disabled: boolean; reason: string | null } => {
    const claim = claims.find(item => item.id === claimId);
    if (!claim) return { label: '解封并裁决', disabled: true, reason: null };
    const attempt = ledger.attempts.find(item => item.id === claim.attemptId) ?? null;
    const experiment = attempt ? ledger.experiments.find(item => item.id === attempt.experimentId) ?? null : null;
    const projection = projectClaimUnseal(claim, ledger.events);
    const retry = projection.mode === 'retry';
    if (auditPersistence === 'degraded') {
      return { label: retry ? '审计异常：修复后继续既定裁决' : '审计异常：修复后解封', disabled: true, reason: '只追加审计链异常' };
    }
    if (auditPersistence !== 'healthy') {
      return { label: retry ? '档案不可用：修复后继续既定裁决' : '档案不可用：修复后解封', disabled: true, reason: '档案持久化不可用' };
    }
    const gate = unsealIdentityGate(claim, attempt, experiment, study);
    if (!gate.allowed) {
      return { label: '身份漂移：解封已关闭', disabled: true, reason: gate.reasons.join('；') };
    }
    if (projection.mode === 'invalid') {
      return { label: '档案冲突：解封已关闭', disabled: true, reason: projection.reasons.join('；') };
    }
    return { label: retry ? '继续既定裁决（不创建新主张）' : '解封并裁决', disabled: busy, reason: null };
  };

  return {
    composerRef,
    ledger,
    study,
    binding,
    claims,
    predicates,
    setPredicates,
    updatePredicate,
    addGuardrail,
    removeGuardrail,
    editingClaim,
    editingClaimId,
    bindingDrifted,
    structure,
    formEligibility,
    auditPersistence,
    auditError,
    auditHealthy,
    attemptIdForActions,
    selectedAttempt,
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
  };
}

export type ClaimWorkflowController = ReturnType<typeof useClaimWorkflowController>;
