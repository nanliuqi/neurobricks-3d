import { useExperimentStore, verifyExperimentLedgerAudit } from '@/stores/useExperimentStore';
import type { Attempt, ClaimEvaluationPayload, ClaimPredicate, EvaluationClaim, Experiment, ExperimentLedgerV1, LedgerEvent, Study } from '@/types/experiment';
import { ExperimentProtocolError, sha256ProtocolValue, stableProtocolJson } from '@/utils/experimentProtocol';
import {
  adjudicatePredicates,
  buildClassificationDiagnostics,
  conclusionTrustFor,
  createDraftClaim,
  freezeClaim,
  preflightClaim,
  type ClaimPreflight,
} from '@/utils/claimProtocol';
import { isNativeTrainingRuntime } from '@/trainingRuntime';
import { projectClaimUnseal } from '@/utils/claimUnsealProjection';

function createId(prefix: string): string {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function contextForAttempt(attemptId: string) {
  const ledger = useExperimentStore.getState().ledger;
  const attempt = ledger.attempts.find(item => item.id === attemptId);
  if (!attempt) throw new ExperimentProtocolError('Attempt 不存在');
  const experiment = ledger.experiments.find(item => item.id === attempt.experimentId);
  if (!experiment) throw new ExperimentProtocolError('Experiment 不存在');
  const study = ledger.studies.find(item => item.id === experiment.studyId);
  if (!study) throw new ExperimentProtocolError('Study 不存在');
  return { attempt, experiment, study };
}

export function saveClaimDraft(
  attemptId: string,
  predicates: ClaimPredicate[],
  claimId?: string,
): EvaluationClaim {
  const { attempt, study } = contextForAttempt(attemptId);
  const next = createDraftClaim(study, attempt, predicates);
  const existing = claimId
    ? useExperimentStore.getState().ledger.claims.find(item => item.id === claimId)
    : undefined;
  if (claimId && !existing) throw new ExperimentProtocolError('要修订的主张草稿不存在');
  if (existing && existing.status !== 'draft') throw new ExperimentProtocolError('冻结后的主张不可原地修改；请创建派生主张');
  if (existing && existing.attemptId !== attemptId) throw new ExperimentProtocolError('草稿修订不能更换绑定的 Attempt');
  if (existing && stableProtocolJson(existing.predicates) === stableProtocolJson(next.predicates)) {
    return existing;
  }
  const draft: EvaluationClaim = existing
    ? {
        ...next,
        id: existing.id,
        revision: (Number.isInteger(existing.revision) && existing.revision > 0 ? existing.revision : 0) + 1,
        createdAt: existing.createdAt,
      }
    : next;
  useExperimentStore.getState().registerClaim(draft);
  useExperimentStore.getState().appendEvent('claim', draft.id, existing ? 'claim_draft_revised' : 'claim_draft_created', {
    revision: draft.revision,
    attemptId,
    modelWeightsHash: draft.modelWeightsHash,
    testSetHash: draft.testDatasetHash,
    preprocessingHash: draft.preprocessingHash,
    predicates: draft.predicates,
  }, draft.updatedAt);
  return draft;
}

export async function freezeRegisteredClaim(
  claimId: string,
  confirmWarnings = false,
): Promise<{ claim: EvaluationClaim; preflight: ClaimPreflight }> {
  const draft = useExperimentStore.getState().ledger.claims.find(item => item.id === claimId);
  if (!draft || draft.status !== 'draft') throw new ExperimentProtocolError('主张草稿不存在或已经冻结');
  // 审计绝对闸门（模块 08 最终运行时原子性补丁）：冻结必须留痕，
  // unavailable 与 degraded 都失败关闭，不得只比较前后状态变化。
  const auditAtRequest = useExperimentStore.getState().auditPersistence;
  if (auditAtRequest !== 'healthy') {
    throw new ExperimentProtocolError(`档案持久化状态为 ${auditAtRequest}；冻结必须写入只追加审计链，已失败关闭`);
  }
  const { attempt, study } = contextForAttempt(draft.attemptId);
  // 纵深加固：冻结前复核当前 Study 候选仍为草稿绑定 Attempt，且归属/身份完整。
  if (draft.studyId !== study.id) {
    throw new ExperimentProtocolError('草稿所属 Study 与绑定 Attempt 的 Study 不一致，冻结已拒绝');
  }
  if (study.selectedAttemptId !== draft.attemptId) {
    throw new ExperimentProtocolError('当前候选已变化，冻结已拒绝；请重新复核后再发起');
  }
  if (study.selectedExperimentId && study.selectedExperimentId !== attempt.experimentId) {
    throw new ExperimentProtocolError('当前候选实验与绑定 Attempt 所属实验不一致，冻结已拒绝');
  }
  if (attempt.status !== 'completed' || attempt.provenance.executionTrust !== 'trusted') {
    throw new ExperimentProtocolError('绑定 Attempt 不再是完成且受控可信状态，冻结已拒绝');
  }
  if (!attempt.provenance.modelWeightsHash || !attempt.provenance.testSetHash || !attempt.provenance.preprocessingHash) {
    throw new ExperimentProtocolError('绑定 Attempt 身份哈希不完整，冻结已拒绝');
  }
  const preflight = preflightClaim(draft.predicates, attempt);
  if (preflight.blockers.length > 0) throw new ExperimentProtocolError(preflight.blockers.join('；'));
  if (preflight.warnings.length > 0 && !confirmWarnings) {
    return { claim: draft, preflight };
  }
  const frozen = await freezeClaim(draft, study, attempt);
  const stateAfter = useExperimentStore.getState();
  const current = stateAfter.ledger.claims.find(item => item.id === claimId);
  if (
    !current
    || current.status !== 'draft'
    || current.revision !== draft.revision
    || stableProtocolJson(current.predicates) !== stableProtocolJson(draft.predicates)
  ) throw new ExperimentProtocolError('冻结计算期间主张草稿发生变化，请重新确认最新版本');
  // 异步计算完成后再次复核：候选、Experiment 一致性、Attempt 身份与审计状态（绝对 healthy）。
  const studyAfter = stateAfter.ledger.studies.find(item => item.id === study.id);
  const attemptAfter = stateAfter.ledger.attempts.find(item => item.id === attempt.id);
  if (!studyAfter || studyAfter.selectedAttemptId !== draft.attemptId) {
    throw new ExperimentProtocolError('冻结计算期间当前候选已变化，已拒绝冻结；请重新复核');
  }
  if (studyAfter.selectedExperimentId && studyAfter.selectedExperimentId !== attempt.experimentId) {
    throw new ExperimentProtocolError('冻结计算期间候选实验与绑定 Attempt 所属实验不再一致，已拒绝冻结');
  }
  if (
    !attemptAfter
    || attemptAfter.status !== 'completed'
    || attemptAfter.provenance.executionTrust !== 'trusted'
    || !attemptAfter.provenance.modelWeightsHash
    || !attemptAfter.provenance.testSetHash
    || !attemptAfter.provenance.preprocessingHash
    || attemptAfter.provenance.modelWeightsHash !== attempt.provenance.modelWeightsHash
    || attemptAfter.provenance.testSetHash !== attempt.provenance.testSetHash
    || attemptAfter.provenance.preprocessingHash !== attempt.provenance.preprocessingHash
  ) throw new ExperimentProtocolError('冻结计算期间 Attempt 身份发生变化或不完整，已拒绝冻结');
  if (stateAfter.auditPersistence !== 'healthy') {
    throw new ExperimentProtocolError('冻结计算期间审计持久化不再健康，已失败关闭；请修复审计后重新发起');
  }
  useExperimentStore.getState().replaceClaim(frozen);
  useExperimentStore.getState().appendEvent('claim', frozen.id, 'claim_frozen', {
    frozenHash: frozen.frozenHash,
    revision: frozen.revision,
    attemptId: frozen.attemptId,
    modelWeightsHash: frozen.modelWeightsHash,
    testSetHash: frozen.testDatasetHash,
    preprocessingHash: frozen.preprocessingHash,
  }, frozen.frozenAt ?? Date.now());
  return { claim: frozen, preflight };
}

export function preflightRegisteredClaim(claimId: string): ClaimPreflight {
  const draft = useExperimentStore.getState().ledger.claims.find(item => item.id === claimId);
  if (!draft || draft.status !== 'draft') throw new ExperimentProtocolError('主张草稿不存在或已经冻结');
  const { attempt } = contextForAttempt(draft.attemptId);
  return preflightClaim(draft.predicates, attempt);
}

/**
 * 只有只追加事件中的完整授权记录才代表已保留解封序号；不能只相信可变 Claim 快照。
 * 注意（模块 08 可信边界补丁）：解封模式与序号的权威来源是测试集级投影
 * projectClaimUnseal（UI 与 evaluateFrozenClaim 共同消费）；本函数仅作单 Claim
 * 事件查询的兼容入口保留，不得再用于推断 retry/next 序号。
 */
export function recordedUnsealSequence(claim: EvaluationClaim, events: LedgerEvent[]): number | null {
  const event = [...events].reverse().find(item => (
    item.entityType === 'claim'
    && item.entityId === claim.id
    && item.eventType === 'claim_unsealed'
    && item.payload.frozenHash === claim.frozenHash
    && item.payload.testSetHash === claim.testDatasetHash
    && Number.isSafeInteger(item.payload.unsealSequence)
    && Number(item.payload.unsealSequence) > 0
  ));
  return event ? Number(event.payload.unsealSequence) : null;
}

/** 兼容旧调用；新界面使用“保存草稿 → 冻结”以保留版本历史。 */
export async function registerAndFreezeClaim(
  attemptId: string,
  predicates: ClaimPredicate[],
  confirmWarnings = false,
): Promise<{ claim: EvaluationClaim; preflight: ClaimPreflight }> {
  const draft = saveClaimDraft(attemptId, predicates);
  return freezeRegisteredClaim(draft.id, confirmWarnings);
}

function parseClaimPayload(value: unknown, claim: EvaluationClaim, expectedClassCount?: number): ClaimEvaluationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExperimentProtocolError('主张评估协议无效');
  const data = value as Record<string, unknown>;
  if (
    data.type !== 'claim_result'
    || data.claimId !== claim.id
    || data.frozenHash !== claim.frozenHash
    || data.modelWeightsHash !== claim.modelWeightsHash
    || data.testSetHash !== claim.testDatasetHash
    || data.preprocessingHash !== claim.preprocessingHash
    || !Array.isArray(data.targets)
    || !Array.isArray(data.predictions)
  ) throw new ExperimentProtocolError('eval-only 结果与冻结主张身份不一致');
  const taskType = data.taskType;
  if (taskType !== 'image_classification' && taskType !== 'tabular_regression') {
    throw new ExperimentProtocolError('eval-only 任务类型无效');
  }
  if (taskType === 'image_classification' && (
    !Number.isSafeInteger(data.classCount)
    || data.classCount !== expectedClassCount
  )) throw new ExperimentProtocolError('eval-only 类别全集与冻结数据契约不一致');
  return {
    claimId: claim.id,
    frozenHash: claim.frozenHash!,
    taskType,
    modelWeightsHash: claim.modelWeightsHash,
    testSetHash: claim.testDatasetHash,
    preprocessingHash: claim.preprocessingHash,
    classCount: taskType === 'image_classification' ? data.classCount as number : undefined,
    targets: data.targets as number[],
    predictions: data.predictions as number[],
  };
}

const activeClaimEvaluations = new Set<string>();
/** 全局评估串行锁：同测试集两个 Claim 并发时不得分配重复解封序号。 */
let globalEvaluationClaimId: string | null = null;

/**
 * 从最新 ledger 完整解析并校验 Claim/Attempt/Experiment/Study（三个异步边界共用同一实现）：
 * - Claim：frozen、frozenHash 非空、revision 合法、三身份哈希完整；
 * - Attempt：存在、completed、trusted、modelId 非空、三哈希非空；
 * - 归属：Attempt→Experiment→Study 链路完整且 Study 与 Claim.studyId 一致；
 * - Claim↔Attempt 三哈希一致（身份漂移失败关闭）。
 */
function resolveClaimEntities(ledger: ExperimentLedgerV1, claimId: string): {
  claim: EvaluationClaim; attempt: Attempt; experiment: Experiment; study: Study;
} {
  const claim = ledger.claims.find(item => item.id === claimId);
  if (!claim) throw new ExperimentProtocolError('主张不存在');
  if (claim.status !== 'frozen') throw new ExperimentProtocolError('主张不在已冻结状态');
  if (typeof claim.frozenHash !== 'string' || claim.frozenHash.length === 0) throw new ExperimentProtocolError('主张缺少冻结哈希');
  if (claim.revision !== null && (!Number.isSafeInteger(claim.revision) || (claim.revision as number) < 1)) {
    throw new ExperimentProtocolError('主张 revision 非法');
  }
  if (!claim.modelWeightsHash || !claim.testDatasetHash || !claim.preprocessingHash) {
    throw new ExperimentProtocolError('主张身份哈希不完整');
  }
  const attempt = ledger.attempts.find(item => item.id === claim.attemptId);
  if (!attempt) throw new ExperimentProtocolError('绑定 Attempt 不存在');
  if (attempt.status !== 'completed') throw new ExperimentProtocolError('绑定 Attempt 不是已完成运行');
  if (attempt.provenance.executionTrust !== 'trusted') throw new ExperimentProtocolError('绑定 Attempt 不是受控管线可信执行');
  if (typeof attempt.modelId !== 'string' || attempt.modelId.length === 0) throw new ExperimentProtocolError('Attempt 缺少独立权重文件身份');
  if (!attempt.provenance.modelWeightsHash || !attempt.provenance.testSetHash || !attempt.provenance.preprocessingHash) {
    throw new ExperimentProtocolError('Attempt 身份哈希不完整');
  }
  const experiment = ledger.experiments.find(item => item.id === attempt.experimentId);
  if (!experiment) throw new ExperimentProtocolError('Experiment 不存在');
  const study = ledger.studies.find(item => item.id === experiment.studyId);
  if (!study) throw new ExperimentProtocolError('Study 不存在');
  if (study.id !== claim.studyId) throw new ExperimentProtocolError('Claim/Experiment/Study 归属不一致');
  if (
    claim.modelWeightsHash !== attempt.provenance.modelWeightsHash
    || claim.testDatasetHash !== attempt.provenance.testSetHash
    || claim.preprocessingHash !== attempt.provenance.preprocessingHash
  ) throw new ExperimentProtocolError('冻结主张与当前 Attempt 身份漂移');
  return { claim, attempt, experiment, study };
}

function assertSameClaimIdentity(current: EvaluationClaim, expected: EvaluationClaim): void {
  if (
    current.status !== 'frozen'
    || current.frozenHash !== expected.frozenHash
    || current.attemptId !== expected.attemptId
    || current.studyId !== expected.studyId
    || current.revision !== expected.revision
    || current.modelWeightsHash !== expected.modelWeightsHash
    || current.testDatasetHash !== expected.testDatasetHash
    || current.preprocessingHash !== expected.preprocessingHash
  ) throw new ExperimentProtocolError('主张身份（status/frozenHash/attemptId/studyId/revision/三哈希）发生变化');
}

function assertSameAttemptIdentity(current: Attempt, expected: Attempt): void {
  if (
    current.status !== 'completed'
    || current.provenance.executionTrust !== 'trusted'
    || current.modelId !== expected.modelId
    || current.provenance.modelWeightsHash !== expected.provenance.modelWeightsHash
    || current.provenance.testSetHash !== expected.provenance.testSetHash
    || current.provenance.preprocessingHash !== expected.provenance.preprocessingHash
  ) throw new ExperimentProtocolError('Attempt 身份（modelId/状态/执行信任/三哈希）发生变化');
}

export async function evaluateFrozenClaim(claimId: string): Promise<EvaluationClaim> {
  if (activeClaimEvaluations.has(claimId)) {
    throw new ExperimentProtocolError('该主张的裁决已经在进行，请勿重复提交');
  }
  // 全局串行：同测试集两个 Claim 并发时，序号分配不得竞态（原子性由串行化保证）。
  if (globalEvaluationClaimId !== null) {
    throw new ExperimentProtocolError('另一项解封评估正在进行；为保证测试集解封序号的原子分配，本次请求已拒绝');
  }
  activeClaimEvaluations.add(claimId);
  globalEvaluationClaimId = claimId;
  try {
    return await evaluateFrozenClaimOnce(claimId);
  } finally {
    activeClaimEvaluations.delete(claimId);
    globalEvaluationClaimId = null;
  }
}

async function evaluateFrozenClaimOnce(claimId: string): Promise<EvaluationClaim> {
  if (!isNativeTrainingRuntime()) throw new ExperimentProtocolError('封存测试集评估只允许在桌面受控管线中运行');
  // 初始快照预检：快速失败，避免无意义的审计等待；同时留存审计前身份基准。
  const initial = resolveClaimEntities(useExperimentStore.getState().ledger, claimId);

  // 在产生任何新的信任事件之前先确认旧账完整。磁盘分叉时宁可保持 frozen，
  // 也不能让一次点击把“请求解封”伪装成“已经解封”。
  if (!await verifyExperimentLedgerAudit()) {
    throw new ExperimentProtocolError('只追加审计链尚未恢复健康；主张仍保持冻结，封存集未访问');
  }

  /* —— 异步边界 1（模块 08 最终运行时原子性）：审计验证后从最新 store 重新解析全部实体。
   * 只有最新实体全部通过完整验证且与审计前基准身份一致后，才允许计算投影和追加解封事件；
   * 不得使用审计前捕获的 Claim/Attempt/Study 生成授权事件。 */
  const verifiedState = useExperimentStore.getState();
  const verified = resolveClaimEntities(verifiedState.ledger, claimId);
  assertSameClaimIdentity(verified.claim, initial.claim);
  assertSameAttemptIdentity(verified.attempt, initial.attempt);
  const unsealProjection = projectClaimUnseal(verified.claim, verifiedState.ledger.events);
  if (unsealProjection.mode === 'invalid' || unsealProjection.sequence === null) {
    throw new ExperimentProtocolError(`解封档案冲突：${unsealProjection.reasons.join('；')}；封存集未访问`);
  }
  const isRetry = unsealProjection.mode === 'retry';
  const unsealSequence = unsealProjection.sequence;
  const unsealedAt = Date.now();

  // 先把授权/重试事件同步写盘并验证；只有成功后才推进 Claim 快照和按钮语义。
  verifiedState.appendEvent(
    'claim',
    verified.claim.id,
    isRetry ? 'claim_evaluation_retried' : 'claim_unsealed',
    {
      frozenHash: verified.claim.frozenHash,
      testSetHash: verified.claim.testDatasetHash,
      unsealSequence,
    },
    unsealedAt,
  );
  if (!await verifyExperimentLedgerAudit()) {
    throw new ExperimentProtocolError(isRetry
      ? '只追加审计链未能持久化本次裁决重试；封存集未再次访问'
      : '只追加审计链未能持久化解封许可；主张仍保持冻结，封存集未访问');
  }

  /* —— 异步边界 2：事件持久化后，重新解析最新实体并建立本次 eval-only 的不可变授权上下文。
   * 持久化期间实体漂移 → 解封事件已落盘保留（测试集可能已被授权），明确报告不采信。 */
  const authorizedState = useExperimentStore.getState();
  const authorized = resolveClaimEntities(authorizedState.ledger, claimId);
  try {
    assertSameClaimIdentity(authorized.claim, verified.claim);
    assertSameAttemptIdentity(authorized.attempt, verified.attempt);
  } catch (error) {
    throw new ExperimentProtocolError(`解封许可已落盘留痕，但实体身份在持久化期间发生漂移（${(error as Error).message}）；本次评估中止，结果不会被采信`);
  }
  const armedClaim = { ...authorized.claim, unsealSequence, updatedAt: unsealedAt };
  authorizedState.replaceClaim(armedClaim);
  // 不可变授权上下文：sidecar 调用与裁决计算只允许消费这里冻结的实体。
  const authContext = { claim: armedClaim, attempt: authorized.attempt, study: authorized.study };

  const runId = createId('claim-eval');
  const payload = await new Promise<ClaimEvaluationPayload>(async (resolve, reject) => {
    const [{ listen }, { invoke }] = await Promise.all([
      import('@tauri-apps/api/event'),
      import('@tauri-apps/api/tauri'),
    ]);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unlistenResult();
      unlistenError();
      callback();
    };
    const unlistenResult = await listen<unknown>('claim-evaluation', event => {
      const data = event.payload as Record<string, unknown>;
      if (data?.runId !== runId) return;
      try {
        const parsed = parseClaimPayload(data, authContext.claim, authContext.study.datasetContract.identity.classCount);
        finish(() => resolve(parsed));
      } catch (error) {
        finish(() => reject(error));
      }
    });
    const unlistenError = await listen<unknown>('training-error', event => {
      const data = event.payload as Record<string, unknown>;
      if (data?.runId !== runId) return;
      const message = typeof data.message === 'string' ? data.message : 'eval-only sidecar failed';
      finish(() => reject(new ExperimentProtocolError(message)));
    });
    const timeout = window.setTimeout(
      () => finish(() => reject(new ExperimentProtocolError('eval-only 超时，封存集访问已记入档案'))),
      10 * 60 * 1000,
    );
    try {
      await invoke('start_training', {
        config: {
          ...authContext.attempt.config,
          mode: 'evaluate_claim',
          runId,
          attemptId: authContext.attempt.id,
          modelId: authContext.attempt.modelId,
          splitHash: authContext.attempt.provenance.splitHash ?? undefined,
          preprocessingHash: authContext.attempt.provenance.preprocessingHash ?? undefined,
          evaluationClaim: {
            claimId: authContext.claim.id,
            frozenHash: authContext.claim.frozenHash,
            modelWeightsHash: authContext.claim.modelWeightsHash,
            testSetHash: authContext.claim.testDatasetHash,
            taskType: authContext.study.datasetContract.identity.taskType,
            classCount: authContext.study.datasetContract.identity.classCount,
          },
        },
      });
    } catch (error) {
      finish(() => reject(error));
    }
  });

  /* —— 异步边界 3：sidecar 返回后、写入 adjudicated 前，再次读取最新 store 并完整验证。
   * 运行期间漂移 → 不 replaceClaim、不追加 claim_adjudicated；
   * 已落盘的 claim_unsealed 保留（测试集可能已被访问），明确区分“已留痕”与“未采信”。 */
  const finalState = useExperimentStore.getState();
  const finalEntities = resolveClaimEntities(finalState.ledger, claimId);
  try {
    assertSameClaimIdentity(finalEntities.claim, authorized.claim);
    assertSameAttemptIdentity(finalEntities.attempt, authContext.attempt);
    if (finalEntities.claim.unsealSequence !== unsealSequence) {
      throw new ExperimentProtocolError('unsealSequence 已变化');
    }
  } catch (error) {
    throw new ExperimentProtocolError(`封存集访问已留痕（解封事件已写入档案并保留），但结果因身份漂移未被采信：${(error as Error).message}；不写入裁决`);
  }

  // 裁决计算、诊断与 conclusionTrustFor 全部使用同一份经授权的实体上下文，不混用新旧对象。
  const adjudication = adjudicatePredicates(authContext.claim.predicates, payload);
  const adjudicatedAt = Date.now();
  const adjudicated: EvaluationClaim = {
    ...finalEntities.claim,
    status: 'adjudicated',
    adjudicatedAt,
    verdict: adjudication.verdict,
    predicateResults: adjudication.results,
    classificationDiagnostics: payload.taskType === 'image_classification'
      ? buildClassificationDiagnostics(payload, authContext.study.datasetContract.identity.classNames)
      : null,
    conclusionTrust: conclusionTrustFor(authContext.study, authContext.attempt, unsealSequence),
    updatedAt: adjudicatedAt,
  };
  const diagnosticsHash = adjudicated.classificationDiagnostics
    ? await sha256ProtocolValue(adjudicated.classificationDiagnostics)
    : null;
  finalState.replaceClaim(adjudicated);
  finalState.appendEvent('claim', authContext.claim.id, 'claim_adjudicated', {
    frozenHash: authContext.claim.frozenHash,
    unsealSequence,
    verdict: adjudicated.verdict,
    conclusionTrust: adjudicated.conclusionTrust,
    predicateResults: adjudicated.predicateResults,
    diagnosticsHash,
    perClassRecall: adjudicated.classificationDiagnostics?.perClassRecall ?? null,
  }, adjudicatedAt);
  if (!await verifyExperimentLedgerAudit()) {
    throw new ExperimentProtocolError('裁决已计算并保留在本地，但只追加审计结果尚未持久化；报告会保持档案不完整标记');
  }
  return adjudicated;
}
