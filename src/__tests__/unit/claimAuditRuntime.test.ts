import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attempt, ClaimPredicate, EvaluationClaim, Experiment, LedgerEvent, Study } from '@/types/experiment';
import { sha256ProtocolValue } from '@/utils/experimentProtocol';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/tauri', () => ({ invoke: invokeMock }));

// 事件总线 mock（D 组）：捕获 listen 回调，测试可手动 emit sidecar 结果/错误。
const eventBus = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (channel: string, handler: (event: { payload: unknown }) => void) => {
    eventBus.listeners.set(channel, handler);
    return () => { eventBus.listeners.delete(channel); };
  },
}));

import { evaluateFrozenClaim, freezeRegisteredClaim, saveClaimDraft } from '@/claimRuntime';
import { useExperimentStore } from '@/stores/useExperimentStore';

const STUDY: Study = {
  id: 'study-audit', protocolVersion: 1, name: '审计原子性', kind: 'candidate_selection', status: 'active',
  question: '审计失败能否阻止解封？', comparisonKey: 'key', selectionRule: '手动选择',
  budget: { maxExperiments: 1, maxGpuMinutes: 60 }, createdAt: 1, updatedAt: 1, lockedAt: 1,
  selectedExperimentId: 'experiment-audit', selectedAttemptId: 'attempt-audit',
  datasetContract: {
    identity: { id: 'data', name: 'MNIST', taskType: 'image_classification', contentHash: 'sha256:data', fingerprintAlgorithm: 'sha256-v1', sampleCount: 100, classCount: 2, importedAt: 1 },
    split: { strategy: 'predefined', seed: 42, validationRatio: 0.2, testRatio: 0.2, sampleUnit: 'image', independence: 'machine_verified', machineChecks: [], splitHash: 'sha256:split' },
    preprocessing: { configHash: 'sha256:pre', summary: 'fixed' },
  },
};

const EXPERIMENT: Experiment = {
  id: 'experiment-audit', protocolVersion: 1, studyId: STUDY.id, name: 'candidate',
  config: { epochs: 1, learningRate: 0.001, batchSize: 8, dataset: 'mnist', device: 'cuda', layers: [] },
  configHash: 'sha256:config', createdAt: 1,
};

const ATTEMPT: Attempt = {
  id: 'attempt-audit', protocolVersion: 1, experimentId: EXPERIMENT.id, runId: 'run-audit', modelId: 'model-audit',
  config: EXPERIMENT.config, ordinal: 1, parentAttemptId: null, restartCount: 0, resumeType: 'fresh',
  status: 'completed', startedAt: 1, endedAt: 2, metrics: [], executionMode: 'native',
  artifacts: { weights: true, fullModel: true, numpy: true, perModel: true },
  provenance: {
    source: 'controlled', executionTrust: 'trusted', witnessedByPipeline: true,
    environment: { applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cuda', cudaVersion: '12' },
    datasetContentHash: 'sha256:data', splitHash: 'sha256:split', testSetHash: 'sha256:test',
    machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'passed' }],
    testSampleCount: 40, testLabelCounts: { '0': 20, '1': 20 }, preprocessingHash: 'sha256:pre',
    configHash: 'sha256:config', modelWeightsHash: 'sha256:weights',
  },
};

const PREDICATE: ClaimPredicate = {
  id: 'primary', role: 'primary', metric: 'recall', operator: 'gte', threshold: 0.9,
  targetClass: '1', aggregation: 'binary', confidenceLevel: 0.95, intervalMethod: 'wilson',
  minimumEffectiveSampleSize: 10,
};

function setNativeRuntime(enabled: boolean): void {
  if (enabled) Object.defineProperty(window, '__TAURI_IPC__', { configurable: true, value: vi.fn() });
  else Reflect.deleteProperty(window, '__TAURI_IPC__');
}

describe('claim unseal audit atomicity', () => {
  let diskEvents: LedgerEvent[];

  beforeEach(async () => {
    setNativeRuntime(false);
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(EXPERIMENT);
    useExperimentStore.getState().registerAttempt(ATTEMPT);
    // 模块 08 最终补丁：冻结必须在 healthy 审计前提下进行。
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
    const draft = saveClaimDraft(ATTEMPT.id, [PREDICATE]);
    await freezeRegisteredClaim(draft.id, true);
    diskEvents = useExperimentStore.getState().ledger.events.map(event => ({ ...event }));
    setNativeRuntime(true);
  });

  afterEach(() => {
    setNativeRuntime(false);
    invokeMock.mockReset();
    useExperimentStore.getState().resetLedgerForTests();
  });

  it('keeps the claim unarmed when the unseal permission cannot be durably verified', async () => {
    const expectedLedgerId = useExperimentStore.getState().ledger.ledgerId;
    invokeMock.mockImplementation(async (command: string, args?: { ledgerId?: string; event?: LedgerEvent; events?: LedgerEvent[] }) => {
      if (command === 'verify_experiment_ledger') {
        if (args?.ledgerId !== expectedLedgerId) throw new Error('wrong ledger stream');
        return {
          eventCount: diskEvents.length,
          lastEventId: diskEvents[diskEvents.length - 1]?.eventId ?? null,
          contentHash: await sha256ProtocolValue(diskEvents),
        };
      }
      if (command === 'hash_experiment_ledger_events') {
        const events = args?.events ?? [];
        return {
          eventCount: events.length,
          lastEventId: events[events.length - 1]?.eventId ?? null,
          contentHash: await sha256ProtocolValue(events),
        };
      }
      if (command === 'append_experiment_ledger_event') {
        if (args?.ledgerId !== expectedLedgerId) throw new Error('wrong ledger stream');
        if (args?.event?.eventType === 'claim_unsealed') throw new Error('simulated disk failure');
        if (args?.event) diskEvents.push(args.event);
        return;
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const claimId = useExperimentStore.getState().ledger.claims[0].id;
    const firstEvaluation = evaluateFrozenClaim(claimId);
    await expect(evaluateFrozenClaim(claimId)).rejects.toThrow(/已经在进行/);
    await expect(firstEvaluation).rejects.toThrow(/主张仍保持冻结|审计链尚未恢复健康/);
    const claim = useExperimentStore.getState().ledger.claims.find(item => item.id === claimId)!;
    expect(claim.status).toBe('frozen');
    expect(claim.unsealSequence).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith('start_training', expect.anything());
  });
});

/* ---------------- 模块 08 最终补丁：评估运行时异步边界原子性 ---------------- */

describe('evaluateFrozenClaim 运行时原子性（真实 mock 全链路）', () => {
  let diskEvents: LedgerEvent[];
  let startTrainingCalls: Array<Record<string, unknown>>;

  beforeEach(async () => {
    setNativeRuntime(false);
    eventBus.listeners.clear();
    startTrainingCalls = [];
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(EXPERIMENT);
    useExperimentStore.getState().registerAttempt(ATTEMPT);
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
    const draft = saveClaimDraft(ATTEMPT.id, [PREDICATE]);
    await freezeRegisteredClaim(draft.id, true);
    diskEvents = useExperimentStore.getState().ledger.events.map(event => ({ ...event }));
    setNativeRuntime(true);
  });

  afterEach(() => {
    setNativeRuntime(false);
    invokeMock.mockReset();
    eventBus.listeners.clear();
    useExperimentStore.getState().resetLedgerForTests();
  });

  interface InvokeArgs {
    ledgerId?: string;
    event?: LedgerEvent;
    events?: LedgerEvent[];
    config?: Record<string, unknown>;
  }

  function mockInvoke(options: {
    onFirstVerify?: () => void;
    onStartTraining?: (config: Record<string, unknown>) => void;
  } = {}): void {
    const expectedLedgerId = useExperimentStore.getState().ledger.ledgerId;
    let verifyCount = 0;
    invokeMock.mockImplementation(async (command: string, args?: InvokeArgs) => {
      if (command === 'verify_experiment_ledger') {
        verifyCount += 1;
        if (verifyCount === 1) options.onFirstVerify?.();
        if (args?.ledgerId !== expectedLedgerId) throw new Error('wrong ledger stream');
        return {
          eventCount: diskEvents.length,
          lastEventId: diskEvents[diskEvents.length - 1]?.eventId ?? null,
          contentHash: await sha256ProtocolValue(diskEvents),
        };
      }
      if (command === 'hash_experiment_ledger_events') {
        const events = args?.events ?? [];
        return {
          eventCount: events.length,
          lastEventId: events[events.length - 1]?.eventId ?? null,
          contentHash: await sha256ProtocolValue(events),
        };
      }
      if (command === 'append_experiment_ledger_event') {
        if (args?.ledgerId !== expectedLedgerId) throw new Error('wrong ledger stream');
        if (args?.event) diskEvents.push(args.event);
        return;
      }
      if (command === 'start_training') {
        const config = args?.config ?? {};
        startTrainingCalls.push(config);
        options.onStartTraining?.(config);
        return;
      }
      throw new Error(`unexpected command: ${command}`);
    });
  }

  function emit(channel: string, payload: unknown): void {
    const listener = eventBus.listeners.get(channel);
    if (!listener) throw new Error(`监听器未注册：${channel}`);
    listener({ payload });
  }

  async function waitForCondition(check: () => boolean): Promise<void> {
    for (let index = 0; index < 400; index += 1) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('等待条件超时未满足');
  }

  function currentClaim(claimId: string): EvaluationClaim {
    const claim = useExperimentStore.getState().ledger.claims.find(item => item.id === claimId);
    if (!claim) throw new Error(`Claim 不存在：${claimId}`);
    return claim;
  }

  function claimResultPayload(claim: EvaluationClaim, runId: string): Record<string, unknown> {
    return {
      type: 'claim_result',
      runId,
      claimId: claim.id,
      frozenHash: claim.frozenHash,
      modelWeightsHash: claim.modelWeightsHash,
      testSetHash: claim.testDatasetHash,
      preprocessingHash: claim.preprocessingHash,
      taskType: 'image_classification',
      classCount: 2,
      targets: [...Array(20).fill(0), ...Array(20).fill(1)],
      predictions: [...Array(20).fill(0), ...Array(20).fill(1)],
    };
  }

  function mutateAttempt(mutator: (attempt: Attempt) => Attempt): void {
    useExperimentStore.setState(state => ({
      ledger: {
        ...state.ledger,
        attempts: state.ledger.attempts.map(attempt => (attempt.id === ATTEMPT.id ? mutator(attempt) : attempt)),
      },
    }));
  }

  function eventTypes(): string[] {
    return useExperimentStore.getState().ledger.events.map(event => event.eventType);
  }

  it('正常首次解封：写 claim_unsealed sequence=1，并以最新授权上下文启动 sidecar', async () => {
    const claim = currentClaim(useExperimentStore.getState().ledger.claims[0].id);
    mockInvoke({
      onStartTraining: (config) => {
        const runId = config.runId as string;
        queueMicrotask(() => emit('claim-evaluation', claimResultPayload(claim, runId)));
      },
    });
    const adjudicated = await evaluateFrozenClaim(claim.id);
    expect(adjudicated.status).toBe('adjudicated');
    expect(adjudicated.unsealSequence).toBe(1);
    expect(adjudicated.conclusionTrust).toBe('gold');
    const unsealedEvents = useExperimentStore.getState().ledger.events.filter(event => event.eventType === 'claim_unsealed');
    expect(unsealedEvents).toHaveLength(1);
    expect(unsealedEvents[0].payload).toMatchObject({
      frozenHash: claim.frozenHash, testSetHash: claim.testDatasetHash, unsealSequence: 1,
    });
    expect(eventTypes()).toContain('claim_adjudicated');
    expect(startTrainingCalls).toHaveLength(1);
    expect(startTrainingCalls[0]).toMatchObject({
      mode: 'evaluate_claim', attemptId: 'attempt-audit', modelId: 'model-audit',
    });
    expect(startTrainingCalls[0].evaluationClaim).toMatchObject({
      claimId: claim.id, frozenHash: claim.frozenHash, modelWeightsHash: 'sha256:weights',
      testSetHash: 'sha256:test', taskType: 'image_classification', classCount: 2,
    });
  });

  it('同测试集另一 Claim 已用 sequence=1：当前写 sequence=2，不授予首次资格', async () => {
    const claim = currentClaim(useExperimentStore.getState().ledger.claims[0].id);
    mockInvoke({
      onStartTraining: (config) => {
        const runId = config.runId as string;
        queueMicrotask(() => emit('claim-evaluation', claimResultPayload(claim, runId)));
      },
    });
    useExperimentStore.getState().appendEvent('claim', 'claim-other', 'claim_unsealed', {
      frozenHash: 'sha256:other-frozen', testSetHash: claim.testDatasetHash, unsealSequence: 1,
    });
    const adjudicated = await evaluateFrozenClaim(claim.id);
    expect(adjudicated.unsealSequence).toBe(2);
    // 事后验证：第二次解封不再具有首次独立验证资格
    expect(adjudicated.conclusionTrust).toBe('exploratory');
    const ownUnsealed = useExperimentStore.getState().ledger.events.filter(event => (
      event.eventType === 'claim_unsealed' && event.entityId === claim.id
    ));
    expect(ownUnsealed).toHaveLength(1);
    expect(ownUnsealed[0].payload.unsealSequence).toBe(2);
  });

  it('自身已有合法解封事件、快照 null：写 claim_evaluation_retried 沿用原序号', async () => {
    const claim = currentClaim(useExperimentStore.getState().ledger.claims[0].id);
    expect(claim.unsealSequence).toBeNull();
    mockInvoke({
      onStartTraining: (config) => {
        const runId = config.runId as string;
        queueMicrotask(() => emit('claim-evaluation', claimResultPayload(claim, runId)));
      },
    });
    useExperimentStore.getState().appendEvent('claim', claim.id, 'claim_unsealed', {
      frozenHash: claim.frozenHash, testSetHash: claim.testDatasetHash, unsealSequence: 1,
    });
    const adjudicated = await evaluateFrozenClaim(claim.id);
    expect(adjudicated.unsealSequence).toBe(1);
    const retriedEvents = useExperimentStore.getState().ledger.events.filter(event => event.eventType === 'claim_evaluation_retried');
    expect(retriedEvents).toHaveLength(1);
    expect(retriedEvents[0].payload.unsealSequence).toBe(1);
    // 不重复分配序号：全档案仍只有原有的一条 claim_unsealed
    expect(useExperimentStore.getState().ledger.events.filter(event => event.eventType === 'claim_unsealed')).toHaveLength(1);
  });

  it('审计验证期间 Claim 身份变化：不追加旧身份 claim_unsealed，不启动 sidecar', async () => {
    const claimId = useExperimentStore.getState().ledger.claims[0].id;
    mockInvoke({
      onFirstVerify: () => {
        const claim = currentClaim(claimId);
        useExperimentStore.getState().replaceClaim({ ...claim, modelWeightsHash: 'sha256:drift-weights' });
      },
    });
    await expect(evaluateFrozenClaim(claimId)).rejects.toThrow(/身份漂移|发生变化/);
    expect(eventTypes()).not.toContain('claim_unsealed');
    expect(eventTypes()).not.toContain('claim_evaluation_retried');
    expect(invokeMock).not.toHaveBeenCalledWith('start_training', expect.anything());
    expect(currentClaim(claimId).status).toBe('frozen');
  });

  it('审计验证期间 Attempt modelId 变化：不追加解封事件，不启动 sidecar', async () => {
    const claimId = useExperimentStore.getState().ledger.claims[0].id;
    mockInvoke({
      onFirstVerify: () => mutateAttempt(attempt => ({ ...attempt, modelId: 'model-swapped' })),
    });
    await expect(evaluateFrozenClaim(claimId)).rejects.toThrow(/发生变化/);
    expect(eventTypes()).not.toContain('claim_unsealed');
    expect(invokeMock).not.toHaveBeenCalledWith('start_training', expect.anything());
    expect(currentClaim(claimId).status).toBe('frozen');
  });

  it('sidecar 运行期间身份变化：保留已落盘解封事件，不写裁决，诚实报告留痕未采信', async () => {
    const claim = currentClaim(useExperimentStore.getState().ledger.claims[0].id);
    let capturedRunId = '';
    mockInvoke({ onStartTraining: (config) => { capturedRunId = config.runId as string; } });
    const evaluation = evaluateFrozenClaim(claim.id);
    await waitForCondition(() => startTrainingCalls.length === 1);
    // sidecar 运行期间替换 Attempt 身份
    mutateAttempt(attempt => ({ ...attempt, modelId: 'model-swapped-midway' }));
    // sidecar 返回旧授权身份对应的结果
    emit('claim-evaluation', claimResultPayload(claim, capturedRunId));
    await expect(evaluation).rejects.toThrow(/已留痕.*未被采信/);
    // 解封事件保留（测试集可能已被访问）
    expect(eventTypes()).toContain('claim_unsealed');
    // 不写入裁决，不追加 claim_adjudicated
    expect(eventTypes()).not.toContain('claim_adjudicated');
    const claimAfter = currentClaim(claim.id);
    expect(claimAfter.status).toBe('frozen');
    expect(claimAfter.unsealSequence).toBe(1);
    expect(claimAfter.verdict).toBeNull();
  });

  it('同测试集两个 Claim 并发：全局锁拒绝第二个，不分配重复/竞态序号', async () => {
    let capturedRunId = '';
    // 先配置 invoke mock：native 模式下第二个冻结的 append 镜像必须同步进 diskEvents，
    // 否则后续审计验证会因磁盘/内存分叉失败。
    mockInvoke({ onStartTraining: (config) => { capturedRunId = config.runId as string; } });
    // 第二个冻结 Claim（同 Attempt、同测试集）
    const draft2 = saveClaimDraft(ATTEMPT.id, [{ ...PREDICATE, id: 'primary-2' }]);
    await freezeRegisteredClaim(draft2.id, true);
    const claimA = currentClaim(useExperimentStore.getState().ledger.claims[0].id);
    const claimB = currentClaim(draft2.id);
    const evaluationA = evaluateFrozenClaim(claimA.id);
    await waitForCondition(() => startTrainingCalls.length === 1);
    // A 进行中时并发提交 B → 全局串行锁拒绝
    await expect(evaluateFrozenClaim(claimB.id)).rejects.toThrow(/另一项解封评估正在进行/);
    // B 零事件、快照不变
    const bEvents = useExperimentStore.getState().ledger.events.filter(event => (
      event.entityId === claimB.id
      && (event.eventType === 'claim_unsealed' || event.eventType === 'claim_evaluation_retried')
    ));
    expect(bEvents).toHaveLength(0);
    expect(currentClaim(claimB.id).status).toBe('frozen');
    // 完成 A：获得唯一序号 1，全档案只有一条 claim_unsealed
    emit('claim-evaluation', claimResultPayload(claimA, capturedRunId));
    const resultA = await evaluationA;
    expect(resultA.status).toBe('adjudicated');
    expect(resultA.unsealSequence).toBe(1);
    const unsealedEvents = useExperimentStore.getState().ledger.events.filter(event => event.eventType === 'claim_unsealed');
    expect(unsealedEvents).toHaveLength(1);
    expect(unsealedEvents[0].entityId).toBe(claimA.id);
  });
});
