/**
 * 有效信任单一来源测试（模块 06 跨界补丁）：
 * - projectEffectiveClaimTrust 表驱动全闸门；
 * - 强化后的 isClaimAuditComplete 失败关闭；
 * - 跨界一致性：同一 Claim 在 Study 总览、ClaimComposer 消费路径、
 *   Study 报告 manifest、实验包最高等级四个消费面得到完全相同的有效等级。
 */
import { describe, expect, it } from 'vitest';
import {
  isClaimAuditComplete,
  maxConclusionTrust,
  projectEffectiveClaimTrust,
} from '@/utils/claimProtocol';
import { projectStudyClaimEvidence } from '@/components/panels/study/studyOverviewViewModel';
import { generateStudyReport } from '@/utils/studyReport';
import {
  TRUST_PROTOCOL_VERSION,
  type Attempt,
  type EvaluationClaim,
  type Experiment,
  type ExperimentLedgerV1,
  type LedgerEvent,
  type Study,
} from '@/types/experiment';

type AuditPersistence = 'unavailable' | 'healthy' | 'degraded';

/* ---------------- 夹具 ---------------- */

const STUDY: Study = {
  id: 'study-1',
  protocolVersion: TRUST_PROTOCOL_VERSION,
  name: '一致性课题',
  kind: 'candidate_selection',
  status: 'active',
  question: '跨界等级是否一致？',
  datasetContract: {
    identity: {
      id: 'ds-1', name: 'MNIST', taskType: 'image_classification',
      contentHash: 'sha256:data', fingerprintAlgorithm: 'sha256-v1', sampleCount: 100, importedAt: 1,
    },
    split: {
      strategy: 'random', seed: 42, validationRatio: 0.2, testRatio: 0.2,
      sampleUnit: 'image', independence: 'machine_verified',
      machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'passed' }],
      splitHash: 'sha256:split',
    },
    preprocessing: { configHash: 'sha256:pre', summary: 'fixed' },
  },
  comparisonKey: 'key-1',
  selectionRule: '手动选择',
  budget: { maxExperiments: null, maxGpuMinutes: null },
  selectedExperimentId: 'exp-1',
  selectedAttemptId: 'att-1',
  createdAt: 1,
  updatedAt: 1,
  lockedAt: 1,
};

const EXPERIMENT: Experiment = {
  id: 'exp-1',
  protocolVersion: TRUST_PROTOCOL_VERSION,
  studyId: STUDY.id,
  name: '方案 1',
  config: { seed: 42 } as Experiment['config'],
  configHash: 'sha256:config',
  createdAt: 1,
};

function makeAttempt(overrides: Partial<Attempt['provenance']> = {}, id = 'att-1'): Attempt {
  return {
    id,
    protocolVersion: TRUST_PROTOCOL_VERSION,
    experimentId: EXPERIMENT.id,
    runId: 'run-1',
    modelId: 'model-1',
    config: { seed: 42 } as Attempt['config'],
    ordinal: 1,
    parentAttemptId: null,
    restartCount: 0,
    resumeType: 'fresh',
    status: 'completed',
    startedAt: 1,
    endedAt: 2,
    provenance: {
      source: 'controlled',
      executionTrust: 'trusted',
      environment: { applicationVersion: '0', torchVersion: null, pythonVersion: null, device: 'cpu', cudaVersion: null },
      datasetContentHash: 'sha256:data',
      splitHash: 'sha256:split',
      testSetHash: 'sha256:test',
      machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'passed' }],
      testSampleCount: 10,
      testLabelCounts: null,
      testTargetSummary: null,
      preprocessingHash: 'sha256:pre',
      configHash: 'sha256:config',
      modelWeightsHash: 'sha256:weights',
      witnessedByPipeline: true,
      ...overrides,
    },
    metrics: [],
    artifacts: null,
    executionMode: 'native',
  };
}

function makeClaim(overrides: Partial<EvaluationClaim> = {}): EvaluationClaim {
  return {
    id: 'claim-1',
    protocolVersion: TRUST_PROTOCOL_VERSION,
    studyId: STUDY.id,
    attemptId: 'att-1',
    modelWeightsHash: 'sha256:weights',
    testDatasetHash: 'sha256:test',
    preprocessingHash: 'sha256:pre',
    status: 'adjudicated',
    revision: 1,
    predicates: [],
    frozenHash: 'sha256:frozen',
    frozenAt: 2,
    unsealSequence: 1,
    adjudicatedAt: 3,
    verdict: 'pass',
    predicateResults: [],
    classificationDiagnostics: null,
    conclusionTrust: 'gold',
    createdAt: 1,
    updatedAt: 3,
    ...overrides,
  };
}

interface ChainOptions {
  omitDraft?: boolean;
  duplicateFreeze?: boolean;
  omitAdjudication?: boolean;
  /** 模块 08 最终补丁：解封许可见证变体。 */
  omitUnsealed?: boolean;
  duplicateUnsealed?: boolean;
  unsealedBeforeFreeze?: boolean;
  retriedInsteadOfUnsealed?: boolean;
}

function eventChain(claim: EvaluationClaim, options: ChainOptions = {}): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  let sequence = 1;
  const base = (eventType: string, payload: Record<string, unknown>): LedgerEvent => ({
    eventId: `event-${sequence++}`,
    protocolVersion: TRUST_PROTOCOL_VERSION,
    sequence,
    occurredAt: 1,
    entityType: 'claim',
    entityId: claim.id,
    eventType,
    payload,
  });
  // 测试集历史连续性：序号 >1 时需要其他 Claim 的前序合法解封事件（同一 testSetHash）。
  const ownSequence = claim.unsealSequence ?? 1;
  for (let prior = 1; prior < ownSequence; prior += 1) {
    events.push({
      eventId: `event-prev-${prior}`,
      protocolVersion: TRUST_PROTOCOL_VERSION,
      sequence: 0,
      occurredAt: 1,
      entityType: 'claim',
      entityId: `claim-prev-${prior}`,
      eventType: 'claim_unsealed',
      payload: { frozenHash: `sha256:prev-frozen-${prior}`, testSetHash: claim.testDatasetHash, unsealSequence: prior },
    });
  }
  if (!options.omitDraft) {
    events.push(base('claim_draft_created', {
      revision: claim.revision,
      attemptId: claim.attemptId,
      modelWeightsHash: claim.modelWeightsHash,
      testSetHash: claim.testDatasetHash,
      preprocessingHash: claim.preprocessingHash,
      predicates: claim.predicates,
    }));
  }
  const freezePayload = {
    frozenHash: claim.frozenHash,
    revision: claim.revision,
    attemptId: claim.attemptId,
    modelWeightsHash: claim.modelWeightsHash,
    testSetHash: claim.testDatasetHash,
    preprocessingHash: claim.preprocessingHash,
  };
  const unsealedPayload = {
    frozenHash: claim.frozenHash,
    testSetHash: claim.testDatasetHash,
    unsealSequence: claim.unsealSequence,
  };
  // 生命周期顺序：draft → frozen → unsealed → adjudicated（可选变体制造顺序错误）。
  if (options.unsealedBeforeFreeze && !options.omitUnsealed) {
    events.push(base(options.retriedInsteadOfUnsealed ? 'claim_evaluation_retried' : 'claim_unsealed', unsealedPayload));
  }
  events.push(base('claim_frozen', freezePayload));
  if (options.duplicateFreeze) events.push(base('claim_frozen', freezePayload));
  if (!options.unsealedBeforeFreeze && !options.omitUnsealed) {
    events.push(base(options.retriedInsteadOfUnsealed ? 'claim_evaluation_retried' : 'claim_unsealed', unsealedPayload));
    if (options.duplicateUnsealed) {
      events.push(base(options.retriedInsteadOfUnsealed ? 'claim_evaluation_retried' : 'claim_unsealed', unsealedPayload));
    }
  }
  if (!options.omitAdjudication) {
    events.push(base('claim_adjudicated', {
      frozenHash: claim.frozenHash,
      unsealSequence: claim.unsealSequence,
      verdict: claim.verdict,
      conclusionTrust: claim.conclusionTrust,
      predicateResults: claim.predicateResults,
    }));
  }
  return events;
}

function makeLedger(claim: EvaluationClaim, attempt: Attempt, events: LedgerEvent[]): ExperimentLedgerV1 {
  return {
    protocolVersion: TRUST_PROTOCOL_VERSION,
    ledgerId: 'ledger-consistency',
    studies: [STUDY],
    experiments: [EXPERIMENT],
    attempts: [attempt],
    claims: [claim],
    events,
  };
}

/* ---------------- 统一投影表驱动 ---------------- */

describe('projectEffectiveClaimTrust：统一闸门', () => {
  const attempt = makeAttempt();

  it.each([
    ['pass', 'gold'],
    ['fail', 'gold'],
    ['inconclusive', 'gold'],
  ] as const)('完整链 + 健康审计：%s 与 PASS 获得相同等级（%s），verdict 不影响资格', (verdict) => {
    const claim = makeClaim({ verdict });
    const projection = projectEffectiveClaimTrust({
      study: STUDY, claim, attempt, events: eventChain(claim), auditPersistence: 'healthy',
    });
    expect(projection.eligible).toBe(true);
    expect(projection.effectiveTrust).toBe('gold');
    expect(projection.verdict).toBe(verdict);
    expect(projection.reasons).toHaveLength(0);
  });

  it('重算 iid_only（machineChecks 为空）：存档一致时有效等级 iid_only', () => {
    const weakAttempt = makeAttempt({ machineChecks: [] });
    const claim = makeClaim({ conclusionTrust: 'iid_only' });
    const projection = projectEffectiveClaimTrust({
      study: STUDY, claim, attempt: weakAttempt, events: eventChain(claim), auditPersistence: 'healthy',
    });
    expect(projection.recomputedTrust).toBe('iid_only');
    expect(projection.effectiveTrust).toBe('iid_only');
    expect(projection.trustMismatch).toBe(false);
  });

  it('重算 exploratory（第二次解封）：有效等级 exploratory', () => {
    const claim = makeClaim({ unsealSequence: 2, conclusionTrust: 'exploratory' });
    const projection = projectEffectiveClaimTrust({
      study: STUDY, claim, attempt, events: eventChain(claim), auditPersistence: 'healthy',
    });
    expect(projection.recomputedTrust).toBe('exploratory');
    expect(projection.effectiveTrust).toBe('exploratory');
  });

  it.each([
    ['存档 gold、重算 iid_only', { conclusionTrust: 'gold' as const }, { machineChecks: [] }, 'iid_only'],
    ['存档 gold、重算 exploratory', { conclusionTrust: 'gold' as const, unsealSequence: 2 }, {}, 'exploratory'],
    ['存档 not_evaluated、重算 gold', { conclusionTrust: 'not_evaluated' as const }, {}, 'not_evaluated'],
  ])('%s：取更低等级并标记不一致', (_label, claimOverrides, attemptOverrides, expected) => {
    const claim = makeClaim(claimOverrides);
    const scenarioAttempt = makeAttempt(attemptOverrides as Partial<Attempt['provenance']>);
    // 事件链与存档保持一致（哈希/verdict 不变），只改变信任语境
    const events = eventChain(claim);
    const projection = projectEffectiveClaimTrust({
      study: STUDY, claim, attempt: scenarioAttempt, events, auditPersistence: 'healthy',
    });
    expect(projection.effectiveTrust).toBe(expected);
    expect(projection.trustMismatch).toBe(true);
    expect(projection.reasons).toContain('trust_mismatch');
  });

  it.each([
    ['future_gold', 'future_gold'],
    ['空字符串', ''],
    ['null', null],
    ['undefined', undefined],
    ['数字', 42],
  ])('存档 conclusionTrust=%s：任何出口不得升级（eligible=false，等级 not_evaluated）', (_label, badTrust) => {
    const claim = makeClaim({ conclusionTrust: badTrust as EvaluationClaim['conclusionTrust'] });
    // 事件与存档使用同一未知值（“互相一致”）也必须失败关闭
    const projection = projectEffectiveClaimTrust({
      study: STUDY, claim, attempt, events: eventChain(claim), auditPersistence: 'healthy',
    });
    expect(projection.eligible).toBe(false);
    expect(projection.effectiveTrust).toBe('not_evaluated');
    expect(projection.archivedTrust).toBeNull();
    expect(projection.archivedTrustRaw).toBe(badTrust);
    expect(projection.reasons).toContain('unknown_conclusion_trust');
    expect(projection.auditComplete).toBe(false);
  });

  it('verdict 未知/缺失：不授予等级，不伪装 INCONCLUSIVE', () => {
    for (const verdict of ['PASS_UPPER', null] as const) {
      const claim = makeClaim({ verdict: verdict as EvaluationClaim['verdict'] });
      const projection = projectEffectiveClaimTrust({
        study: STUDY, claim, attempt, events: eventChain(claim), auditPersistence: 'healthy',
      });
      expect(projection.verdict).toBeNull();
      expect(projection.effectiveTrust).toBe('not_evaluated');
      expect(projection.eligible).toBe(false);
    }
  });

  it('Claim 跨 Study / Attempt 缺失 / Attempt 绑定不一致：全部失败关闭', () => {
    const crossStudy = makeClaim({ studyId: 'study-other' });
    expect(projectEffectiveClaimTrust({
      study: STUDY, claim: crossStudy, attempt, events: eventChain(crossStudy), auditPersistence: 'healthy',
    }).reasons).toContain('claim_not_in_study');

    const missingAttempt = projectEffectiveClaimTrust({
      study: STUDY, claim: makeClaim(), attempt: null, events: [], auditPersistence: 'healthy',
    });
    expect(missingAttempt.reasons).toContain('attempt_missing');
    expect(missingAttempt.effectiveTrust).toBe('not_evaluated');

    const mismatch = projectEffectiveClaimTrust({
      study: STUDY, claim: makeClaim(), attempt: makeAttempt({}, 'att-other'), events: [], auditPersistence: 'healthy',
    });
    expect(mismatch.reasons).toContain('attempt_mismatch');
    expect(mismatch.effectiveTrust).toBe('not_evaluated');
  });

  it('auditPersistence degraded/unavailable：不背书且给出明确原因', () => {
    const claim = makeClaim();
    for (const persistence of ['degraded', 'unavailable'] as const) {
      const projection = projectEffectiveClaimTrust({
        study: STUDY, claim, attempt, events: eventChain(claim), auditPersistence: persistence,
      });
      expect(projection.effectiveTrust).toBe('not_evaluated');
      expect(projection.eligible).toBe(false);
      expect(projection.reasons).toContain('audit_persistence_not_healthy');
    }
  });

  it('post_hoc 与 draft/frozen：not_adjudicated，不背书；post_hoc 带明确原因', () => {
    const postHoc = makeClaim({ status: 'post_hoc' });
    const projection = projectEffectiveClaimTrust({
      study: STUDY, claim: postHoc, attempt, events: eventChain(postHoc), auditPersistence: 'healthy',
    });
    expect(projection.reasons).toContain('post_hoc');
    expect(projection.effectiveTrust).toBe('not_evaluated');

    const draft = makeClaim({ status: 'draft', verdict: null, frozenHash: null, unsealSequence: null, conclusionTrust: 'not_evaluated' });
    const draftProjection = projectEffectiveClaimTrust({
      study: STUDY, claim: draft, attempt, events: [], auditPersistence: 'healthy',
    });
    expect(draftProjection.reasons).toContain('not_adjudicated');
    expect(draftProjection.reasons).not.toContain('post_hoc');
    expect(draftProjection.effectiveTrust).toBe('not_evaluated');
  });

  it('未知 Claim status：失败关闭且不冒充 adjudicated', () => {
    const claim = makeClaim({ status: 'approved' as EvaluationClaim['status'] });
    const projection = projectEffectiveClaimTrust({
      study: STUDY, claim, attempt, events: eventChain(claim), auditPersistence: 'healthy',
    });
    expect(projection.reasons).toContain('unknown_claim_status');
    expect(projection.reasons).toContain('not_adjudicated');
    expect(projection.effectiveTrust).toBe('not_evaluated');
  });
});

/* ---------------- 强化后的 isClaimAuditComplete ---------------- */

describe('isClaimAuditComplete：持久化异常失败关闭', () => {
  const attempt = makeAttempt();

  it('未知 conclusionTrust 即使与事件一致也不通过', () => {
    const claim = makeClaim({ conclusionTrust: 'future_gold' as EvaluationClaim['conclusionTrust'] });
    expect(isClaimAuditComplete(claim, attempt, eventChain(claim))).toBe(false);
  });

  it('未知 verdict 不通过', () => {
    const claim = makeClaim({ verdict: 'PASS_UPPER' as EvaluationClaim['verdict'] });
    expect(isClaimAuditComplete(claim, attempt, eventChain(claim))).toBe(false);
  });

  it('PredicateResult verdict 未知不通过', () => {
    const claim = makeClaim({
      predicates: [{ id: 'p', role: 'primary', metric: 'accuracy', operator: 'gte', threshold: 0.5, confidenceLevel: 0.95, intervalMethod: 'wilson', minimumEffectiveSampleSize: 10 }],
      predicateResults: [{
        predicateId: 'p', pointEstimate: 0.8, lowerBound: 0.7, upperBound: 0.9,
        effectiveSampleSize: 100, confidenceLevel: 0.95, verdict: 'maybe' as never,
      }],
    });
    expect(isClaimAuditComplete(claim, attempt, eventChain(claim))).toBe(false);
  });

  it('非有限点估计/区间、下界大于上界不通过', () => {
    const basePredicate = { id: 'p', role: 'primary' as const, metric: 'accuracy' as const, operator: 'gte' as const, threshold: 0.5, confidenceLevel: 0.95, intervalMethod: 'wilson' as const, minimumEffectiveSampleSize: 10 };
    const badResults = [
      { predicateId: 'p', pointEstimate: Number.NaN, lowerBound: 0.7, upperBound: 0.9, effectiveSampleSize: 100, confidenceLevel: 0.95, verdict: 'pass' as const },
      { predicateId: 'p', pointEstimate: 0.8, lowerBound: 0.7, upperBound: Number.POSITIVE_INFINITY, effectiveSampleSize: 100, confidenceLevel: 0.95, verdict: 'pass' as const },
      { predicateId: 'p', pointEstimate: 0.8, lowerBound: 0.95, upperBound: 0.9, effectiveSampleSize: 100, confidenceLevel: 0.95, verdict: 'pass' as const },
    ];
    for (const result of badResults) {
      const claim = makeClaim({ predicates: [basePredicate], predicateResults: [result] });
      expect(isClaimAuditComplete(claim, attempt, eventChain(claim))).toBe(false);
    }
  });

  it('非法 unsealSequence（0/负数/小数）不通过', () => {
    for (const unsealSequence of [0, -1, 1.5]) {
      const claim = makeClaim({ unsealSequence });
      expect(isClaimAuditComplete(claim, attempt, eventChain(claim))).toBe(false);
    }
  });

  it('事件缺失/重复不通过；完整链通过', () => {
    const claim = makeClaim();
    expect(isClaimAuditComplete(claim, attempt, eventChain(claim, { omitDraft: true }))).toBe(false);
    expect(isClaimAuditComplete(claim, attempt, eventChain(claim, { omitAdjudication: true }))).toBe(false);
    expect(isClaimAuditComplete(claim, attempt, eventChain(claim, { duplicateFreeze: true }))).toBe(false);
    expect(isClaimAuditComplete(claim, attempt, eventChain(claim))).toBe(true);
  });
});

/* ---------------- 跨界一致性：四个消费面 ---------------- */

interface Scenario {
  label: string;
  claim: EvaluationClaim;
  attempt: Attempt;
  events: LedgerEvent[];
  auditPersistence: AuditPersistence;
  expected: 'gold' | 'iid_only' | 'exploratory' | 'not_evaluated';
  /** 跨 Study 场景不进入报告面（报告按 studyId 过滤后天然不含该 Claim）。 */
  skipReport?: boolean;
}

function scenarioGrades(scenario: Scenario) {
  const { claim, attempt, events, auditPersistence } = scenario;
  // 面 1：Study 总览
  const overview = projectStudyClaimEvidence(STUDY, [attempt], [claim], events, auditPersistence);
  const overviewGrade = claim.studyId === STUDY.id
    ? overview.records[0].effectiveTrust ?? 'not_evaluated'
    : 'not_evaluated';
  // 面 2：ClaimComposer（其 displayedTrust 直接消费统一投影）
  const composerGrade = projectEffectiveClaimTrust({ study: STUDY, claim, attempt, events, auditPersistence }).effectiveTrust;
  // 面 3：Study 报告 manifest
  let reportGrade: string = 'not_evaluated';
  if (!scenario.skipReport) {
    const ledger = makeLedger(claim, attempt, events);
    const report = generateStudyReport(ledger, STUDY.id, auditPersistence, new Date('2026-01-01T00:00:00Z'));
    const manifest = JSON.parse(report.manifestJson) as { claims: Array<{ id: string; conclusionTrust: string }> };
    reportGrade = manifest.claims.find(item => item.id === claim.id)?.conclusionTrust ?? 'not_evaluated';
  }
  // 面 4：实验包最高等级（ExportPanel 同构：统一投影 + 协议层安全排序）
  const packageGrade = [projectEffectiveClaimTrust({ study: STUDY, claim, attempt, events, auditPersistence })]
    .reduce((best, projection) => maxConclusionTrust(best, projection.effectiveTrust), 'not_evaluated' as const);
  return { overviewGrade, composerGrade, reportGrade, packageGrade };
}

describe('跨界一致性：同一 Claim 在四个消费面等级完全一致', () => {
  const goodAttempt = makeAttempt();
  const goldClaim = makeClaim();
  const scenarios: Scenario[] = [
    { label: '完整 gold PASS', claim: goldClaim, attempt: goodAttempt, events: eventChain(goldClaim), auditPersistence: 'healthy', expected: 'gold' },
    { label: '完整 gold FAIL', claim: makeClaim({ verdict: 'fail' }), attempt: goodAttempt, events: eventChain(makeClaim({ verdict: 'fail' })), auditPersistence: 'healthy', expected: 'gold' },
    { label: '完整 gold INCONCLUSIVE', claim: makeClaim({ verdict: 'inconclusive' }), attempt: goodAttempt, events: eventChain(makeClaim({ verdict: 'inconclusive' })), auditPersistence: 'healthy', expected: 'gold' },
    { label: '重算 iid_only', claim: makeClaim({ conclusionTrust: 'iid_only' }), attempt: makeAttempt({ machineChecks: [] }), events: eventChain(makeClaim({ conclusionTrust: 'iid_only' })), auditPersistence: 'healthy', expected: 'iid_only' },
    { label: '重算 exploratory', claim: makeClaim({ unsealSequence: 2, conclusionTrust: 'exploratory' }), attempt: goodAttempt, events: eventChain(makeClaim({ unsealSequence: 2, conclusionTrust: 'exploratory' })), auditPersistence: 'healthy', expected: 'exploratory' },
    { label: '存档 gold、重算 iid_only', claim: makeClaim(), attempt: makeAttempt({ machineChecks: [] }), events: eventChain(makeClaim()), auditPersistence: 'healthy', expected: 'iid_only' },
    { label: '存档 gold、重算 exploratory', claim: makeClaim({ unsealSequence: 2 }), attempt: goodAttempt, events: eventChain(makeClaim({ unsealSequence: 2 })), auditPersistence: 'healthy', expected: 'exploratory' },
    { label: '存档 not_evaluated、重算 gold', claim: makeClaim({ conclusionTrust: 'not_evaluated' }), attempt: goodAttempt, events: eventChain(makeClaim({ conclusionTrust: 'not_evaluated' })), auditPersistence: 'healthy', expected: 'not_evaluated' },
    { label: '存档未知', claim: makeClaim({ conclusionTrust: 'future_gold' as EvaluationClaim['conclusionTrust'] }), attempt: goodAttempt, events: eventChain(makeClaim({ conclusionTrust: 'future_gold' as EvaluationClaim['conclusionTrust'] })), auditPersistence: 'healthy', expected: 'not_evaluated' },
    { label: 'verdict 未知', claim: makeClaim({ verdict: 'PASS_UPPER' as EvaluationClaim['verdict'] }), attempt: goodAttempt, events: eventChain(makeClaim({ verdict: 'PASS_UPPER' as EvaluationClaim['verdict'] })), auditPersistence: 'healthy', expected: 'not_evaluated' },
    { label: 'draft 事件缺失', claim: makeClaim(), attempt: goodAttempt, events: eventChain(makeClaim(), { omitDraft: true }), auditPersistence: 'healthy', expected: 'not_evaluated' },
    { label: 'freeze 事件重复', claim: makeClaim(), attempt: goodAttempt, events: eventChain(makeClaim(), { duplicateFreeze: true }), auditPersistence: 'healthy', expected: 'not_evaluated' },
    { label: '权重哈希不匹配', claim: makeClaim(), attempt: makeAttempt({ modelWeightsHash: 'sha256:other' }), events: eventChain(makeClaim()), auditPersistence: 'healthy', expected: 'not_evaluated' },
    { label: 'audit degraded', claim: makeClaim(), attempt: goodAttempt, events: eventChain(makeClaim()), auditPersistence: 'degraded', expected: 'not_evaluated' },
    { label: 'audit unavailable', claim: makeClaim(), attempt: goodAttempt, events: eventChain(makeClaim()), auditPersistence: 'unavailable', expected: 'not_evaluated' },
    { label: 'post_hoc', claim: makeClaim({ status: 'post_hoc' }), attempt: goodAttempt, events: eventChain(makeClaim({ status: 'post_hoc' })), auditPersistence: 'healthy', expected: 'not_evaluated' },
    { label: '跨 Study Claim', claim: makeClaim({ studyId: 'study-other' }), attempt: goodAttempt, events: eventChain(makeClaim({ studyId: 'study-other' })), auditPersistence: 'healthy', expected: 'not_evaluated', skipReport: true },
  ];

  it.each(scenarios)('$label：四个消费面等级一致且等于预期', (scenario) => {
    const grades = scenarioGrades(scenario);
    expect(grades.overviewGrade).toBe(scenario.expected);
    expect(grades.composerGrade).toBe(scenario.expected);
    expect(grades.packageGrade).toBe(scenario.expected);
    if (!scenario.skipReport) expect(grades.reportGrade).toBe(scenario.expected);
  });
});

describe('报告与实验包安全', () => {
  it('README 不泄露未知原始枚举，manifest 有效字段是合法枚举、archived 字段保留原始事实', () => {
    const claim = makeClaim({ conclusionTrust: 'future_gold' as EvaluationClaim['conclusionTrust'] });
    const ledger = makeLedger(claim, makeAttempt(), eventChain(claim));
    const report = generateStudyReport(ledger, STUDY.id, 'healthy', new Date('2026-01-01T00:00:00Z'));
    // 可见文案使用安全标签，不插入原始未知值
    expect(report.readme).toContain('存档结论信任字段异常');
    expect(report.readme).not.toContain('future_gold');
    const manifest = JSON.parse(report.manifestJson) as {
      claims: Array<{ conclusionTrust: string; archivedConclusionTrust: string }>;
    };
    expect(manifest.claims[0].conclusionTrust).toBe('not_evaluated');
    // archived/raw 字段允许保留原始事实（字段名已明确 archived）
    expect(manifest.claims[0].archivedConclusionTrust).toBe('future_gold');
  });

  it('实验包最高等级只从统一投影选择：异常 Claim 不抹掉合法 gold，也不从 archived 读取', () => {
    const goodClaim = makeClaim();
    const badClaim = makeClaim({
      id: 'claim-2',
      conclusionTrust: 'future_gold' as EvaluationClaim['conclusionTrust'],
      attemptId: 'att-missing',
      // 不同测试集：避免其解封事件与 goodClaim 在同一 testSetHash 上占用重复序号（真实档案冲突）
      testDatasetHash: 'sha256:test-2',
    });
    const attempt = makeAttempt();
    const events = [...eventChain(goodClaim), ...eventChain(badClaim).map(event => ({ ...event, entityId: 'claim-2', eventId: `${event.eventId}-b` }))];
    const projections = [goodClaim, badClaim].map(claim => projectEffectiveClaimTrust({
      study: STUDY, claim, attempt, events, auditPersistence: 'healthy',
    }));
    const highest = projections.reduce((best, projection) => maxConclusionTrust(best, projection.effectiveTrust), 'not_evaluated' as const);
    // 一条异常 Claim 不抹掉另一条合法 gold
    expect(highest).toBe('gold');
    // 异常 Claim 自身不因 archived 'future_gold' 获得任何等级
    expect(projections[1].effectiveTrust).toBe('not_evaluated');
    expect(projections[1].eligible).toBe(false);
  });

  it('报告不因异常 Claim 崩溃（异常留档但不背书，未知原始值不泄露）', () => {
    const claim = makeClaim({
      conclusionTrust: 'BROKEN_ENUM_XYZ' as unknown as EvaluationClaim['conclusionTrust'],
      verdict: 'NOPE' as EvaluationClaim['verdict'],
    });
    const ledger = makeLedger(claim, makeAttempt(), eventChain(claim));
    const report = generateStudyReport(ledger, STUDY.id, 'healthy', new Date('2026-01-01T00:00:00Z'));
    expect(report.readme).toContain('存档结论信任字段异常');
    expect(report.readme).not.toContain('BROKEN_ENUM_XYZ');
    const manifest = JSON.parse(report.manifestJson) as { claims: Array<{ conclusionTrust: string }> };
    expect(manifest.claims[0].conclusionTrust).toBe('not_evaluated');
  });
});

/* ---------------- 模块 08 最终补丁：解封许可见证 ---------------- */

describe('解封许可见证：可信档案必须包含有序且唯一的 claim_unsealed', () => {
  function project(claim: EvaluationClaim, events: LedgerEvent[], attempt: Attempt = makeAttempt()) {
    return projectEffectiveClaimTrust({ study: STUDY, claim, attempt, events, auditPersistence: 'healthy' });
  }

  it('draft+freeze+adjudication 但无 claim_unsealed → not_evaluated（快照序号不能替代授权事件）', () => {
    const claim = makeClaim();
    const projection = project(claim, eventChain(claim, { omitUnsealed: true }));
    expect(projection.effectiveTrust).toBe('not_evaluated');
    expect(projection.reasons).toContain('audit_incomplete');
  });

  it('完整 draft→freeze→unseal→adjudication → 原有等级正常授予（gold）', () => {
    const claim = makeClaim();
    const projection = project(claim, eventChain(claim));
    expect(projection.effectiveTrust).toBe('gold');
    expect(projection.auditComplete).toBe(true);
  });

  it('claim_unsealed 在 claim_frozen 之前（顺序颠倒）→ not_evaluated', () => {
    const claim = makeClaim();
    const projection = project(claim, eventChain(claim, { unsealedBeforeFreeze: true }));
    expect(projection.effectiveTrust).toBe('not_evaluated');
    expect(projection.reasons).toContain('audit_incomplete');
  });

  it('重复 claim_unsealed → not_evaluated', () => {
    const claim = makeClaim();
    const projection = project(claim, eventChain(claim, { duplicateUnsealed: true }));
    expect(projection.effectiveTrust).toBe('not_evaluated');
    expect(projection.reasons).toContain('audit_incomplete');
  });

  it('只有 claim_evaluation_retried、没有首次 claim_unsealed 授权 → not_evaluated', () => {
    const claim = makeClaim();
    const projection = project(claim, eventChain(claim, { retriedInsteadOfUnsealed: true }));
    expect(projection.effectiveTrust).toBe('not_evaluated');
    expect(projection.reasons).toContain('audit_incomplete');
  });

  it('unseal 事件 frozenHash 与 Claim 不匹配 → not_evaluated', () => {
    const claim = makeClaim();
    const events = eventChain(claim).map(event => (
      event.eventType === 'claim_unsealed'
        ? { ...event, payload: { ...event.payload, frozenHash: 'sha256:other-frozen' } }
        : event
    ));
    const projection = project(claim, events);
    expect(projection.effectiveTrust).toBe('not_evaluated');
    expect(projection.reasons).toContain('audit_incomplete');
  });

  it('unseal 事件序号与快照不匹配 → not_evaluated', () => {
    const claim = makeClaim({ unsealSequence: 2 });
    const events = eventChain(claim).map(event => (
      event.eventType === 'claim_unsealed' && event.entityId === claim.id
        ? { ...event, payload: { ...event.payload, unsealSequence: 1 } }
        : event
    ));
    const projection = project(claim, events);
    expect(projection.effectiveTrust).toBe('not_evaluated');
    expect(projection.reasons).toContain('audit_incomplete');
  });
});

describe('Attempt 资格门：非已知完成状态或不受信执行不授予有效信任', () => {
  it.each([
    ['running', { ...makeAttempt(), status: 'running' as Attempt['status'] }],
    ['failed', { ...makeAttempt(), status: 'failed' as Attempt['status'] }],
    ['paused', { ...makeAttempt(), status: 'paused' as Attempt['status'] }],
    ['interrupted', { ...makeAttempt(), status: 'interrupted' as Attempt['status'] }],
    ['未知状态', { ...makeAttempt(), status: 'weird_status' as Attempt['status'] }],
    ['untrusted', makeAttempt({ executionTrust: 'unverified' as Attempt['provenance']['executionTrust'] })],
  ])('Attempt 为 %s → not_evaluated + attempt_not_eligible（完整事件链也不能背书）', (_label, attempt) => {
    const claim = makeClaim();
    const projection = projectEffectiveClaimTrust({
      study: STUDY, claim, attempt, events: eventChain(claim), auditPersistence: 'healthy',
    });
    expect(projection.effectiveTrust).toBe('not_evaluated');
    expect(projection.reasons).toContain('attempt_not_eligible');
  });
});
