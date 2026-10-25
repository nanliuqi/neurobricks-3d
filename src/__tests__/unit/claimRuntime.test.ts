import { beforeEach, describe, expect, it, vi } from 'vitest';

// 冻结哈希计算窗口 hook（A4-A7）：在 freezeClaim 异步计算期间变更 store，
// 验证运行时在计算后重新复核并失败关闭。
const freezeHooks = vi.hoisted(() => ({ onCompute: null as null | (() => void) }));
vi.mock('@/utils/claimProtocol', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/claimProtocol')>();
  return {
    ...actual,
    freezeClaim: async (...args: Parameters<typeof actual.freezeClaim>) => {
      freezeHooks.onCompute?.();
      return actual.freezeClaim(...args);
    },
  };
});

import { freezeRegisteredClaim, saveClaimDraft } from '@/claimRuntime';
import { useExperimentStore } from '@/stores/useExperimentStore';
import type { Attempt, ClaimPredicate, Experiment, Study } from '@/types/experiment';

const STUDY: Study = {
  id: 'study-1', protocolVersion: 1, name: '主张版本', kind: 'candidate_selection', status: 'active',
  question: '是否达到召回线？', comparisonKey: 'key', selectionRule: '手动选择（行为留痕）',
  budget: { maxExperiments: 2, maxGpuMinutes: 60 }, createdAt: 1, updatedAt: 1, lockedAt: 1,
  selectedExperimentId: 'experiment-1', selectedAttemptId: 'attempt-1',
  datasetContract: {
    identity: { id: 'data', name: 'data', taskType: 'image_classification', contentHash: 'sha256:data', fingerprintAlgorithm: 'sha256-v1', sampleCount: 100, classCount: 2, importedAt: 1 },
    split: { strategy: 'predefined', seed: 42, validationRatio: 0.2, testRatio: 0.2, sampleUnit: 'image', independence: 'machine_verified', machineChecks: [], splitHash: 'sha256:split' },
    preprocessing: { configHash: 'sha256:pre', summary: 'fixed' },
  },
};

const EXPERIMENT: Experiment = {
  id: 'experiment-1', protocolVersion: 1, studyId: STUDY.id, name: 'candidate',
  config: { epochs: 1, learningRate: 0.001, batchSize: 8, dataset: 'mnist', device: 'cuda', layers: [] },
  configHash: 'sha256:config', createdAt: 1,
};

const ATTEMPT: Attempt = {
  id: 'attempt-1', protocolVersion: 1, experimentId: EXPERIMENT.id, runId: 'run-1', modelId: 'model-1',
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

function predicate(threshold: number): ClaimPredicate {
  return {
    id: 'primary', role: 'primary', metric: 'recall', operator: 'gte', threshold,
    targetClass: '1', aggregation: 'binary', confidenceLevel: 0.95, intervalMethod: 'wilson',
    minimumEffectiveSampleSize: 10,
  };
}

describe('claim draft lifecycle', () => {
  beforeEach(() => {
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(EXPERIMENT);
    useExperimentStore.getState().registerAttempt(ATTEMPT);
    // 模块 08 最终补丁：冻结必须留痕，正常冻结测试必须显式建立 healthy 审计前提，
    // 不得继续利用 unavailable 漏洞。
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
  });

  it('keeps each saved draft revision in the append-only event history before freezing', async () => {
    const first = saveClaimDraft(ATTEMPT.id, [predicate(0.9)]);
    const second = saveClaimDraft(ATTEMPT.id, [predicate(0.95)], first.id);
    expect(second.revision).toBe(2);
    expect(useExperimentStore.getState().ledger.claims).toHaveLength(1);
    expect(useExperimentStore.getState().ledger.events.map(event => event.eventType)).toEqual([
      'claim_draft_created', 'claim_draft_revised',
    ]);
    expect(useExperimentStore.getState().ledger.events[0].payload).toMatchObject({ revision: 1 });
    const frozen = await freezeRegisteredClaim(second.id, true);
    expect(frozen.claim).toMatchObject({ status: 'frozen', revision: 2 });
    expect(frozen.claim.frozenHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('returns statistical warnings without freezing until the caller explicitly confirms', async () => {
    const draft = saveClaimDraft(ATTEMPT.id, [predicate(1)]);
    const preview = await freezeRegisteredClaim(draft.id, false);
    expect(preview.preflight.warnings).toContain('recall 即使结果最理想也无法 PASS，但仍可能得到确定 FAIL');
    expect(preview.claim.status).toBe('draft');
    expect(useExperimentStore.getState().ledger.claims[0].status).toBe('draft');
    expect(useExperimentStore.getState().ledger.events.map(event => event.eventType)).toEqual([
      'claim_draft_created',
    ]);
  });
});

/* ---------------- 模块 08 最终补丁：冻结审计失败关闭与异步窗口攻击 ---------------- */

describe('freezeRegisteredClaim：审计绝对闸门与计算窗口复核', () => {
  beforeEach(() => {
    freezeHooks.onCompute = null;
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(EXPERIMENT);
    useExperimentStore.getState().registerAttempt(ATTEMPT);
  });

  function setAudit(state: 'healthy' | 'degraded' | 'unavailable'): void {
    useExperimentStore.setState({ auditPersistence: state, auditError: null });
  }

  function frozenEventCount(): number {
    return useExperimentStore.getState().ledger.events.filter(event => event.eventType === 'claim_frozen').length;
  }

  function claimStatus(claimId: string): string {
    return useExperimentStore.getState().ledger.claims.find(item => item.id === claimId)?.status ?? 'missing';
  }

  it('auditPersistence=unavailable → 拒绝冻结，Claim 保持 draft，零 claim_frozen 事件', async () => {
    setAudit('unavailable');
    const draft = saveClaimDraft(ATTEMPT.id, [predicate(0.9)]);
    await expect(freezeRegisteredClaim(draft.id, true)).rejects.toThrow(/档案持久化状态为 unavailable/);
    expect(claimStatus(draft.id)).toBe('draft');
    expect(frozenEventCount()).toBe(0);
  });

  it('auditPersistence=degraded → 拒绝冻结，Claim 保持 draft，零 claim_frozen 事件', async () => {
    setAudit('degraded');
    const draft = saveClaimDraft(ATTEMPT.id, [predicate(0.9)]);
    await expect(freezeRegisteredClaim(draft.id, true)).rejects.toThrow(/档案持久化状态为 degraded/);
    expect(claimStatus(draft.id)).toBe('draft');
    expect(frozenEventCount()).toBe(0);
  });

  it('哈希计算期间 healthy→unavailable → 拒绝冻结，不显示冻结成功', async () => {
    setAudit('healthy');
    const draft = saveClaimDraft(ATTEMPT.id, [predicate(0.9)]);
    freezeHooks.onCompute = () => setAudit('unavailable');
    await expect(freezeRegisteredClaim(draft.id, true)).rejects.toThrow(/审计持久化不再健康/);
    expect(claimStatus(draft.id)).toBe('draft');
    expect(frozenEventCount()).toBe(0);
  });

  it('哈希计算期间候选 Attempt 改变 → 拒绝冻结', async () => {
    setAudit('healthy');
    const draft = saveClaimDraft(ATTEMPT.id, [predicate(0.9)]);
    freezeHooks.onCompute = () => {
      useExperimentStore.setState(state => ({
        ledger: {
          ...state.ledger,
          studies: state.ledger.studies.map(study => (
            study.id === STUDY.id ? { ...study, selectedAttemptId: 'attempt-other' } : study
          )),
        },
      }));
    };
    await expect(freezeRegisteredClaim(draft.id, true)).rejects.toThrow(/候选已变化/);
    expect(claimStatus(draft.id)).toBe('draft');
    expect(frozenEventCount()).toBe(0);
  });

  it('selectedExperimentId 与绑定 Attempt 所属实验不一致 → 拒绝冻结', async () => {
    setAudit('healthy');
    useExperimentStore.setState(state => ({
      ledger: {
        ...state.ledger,
        studies: state.ledger.studies.map(study => (
          study.id === STUDY.id ? { ...study, selectedExperimentId: 'experiment-other' } : study
        )),
      },
    }));
    const draft = saveClaimDraft(ATTEMPT.id, [predicate(0.9)]);
    await expect(freezeRegisteredClaim(draft.id, true)).rejects.toThrow(/候选实验与绑定 Attempt 所属实验不一致/);
    expect(claimStatus(draft.id)).toBe('draft');
    expect(frozenEventCount()).toBe(0);
  });

  it.each([
    ['running', (attempt: Attempt): Attempt => ({ ...attempt, status: 'running' as Attempt['status'] })],
    ['untrusted', (attempt: Attempt): Attempt => ({
      ...attempt,
      provenance: { ...attempt.provenance, executionTrust: 'unverified' as Attempt['provenance']['executionTrust'] },
    })],
    ['hash-drift', (attempt: Attempt): Attempt => ({
      ...attempt,
      provenance: { ...attempt.provenance, modelWeightsHash: 'sha256:drift' },
    })],
  ])('哈希计算期间 Attempt 变为 %s → 拒绝冻结', async (_label, mutate) => {
    setAudit('healthy');
    const draft = saveClaimDraft(ATTEMPT.id, [predicate(0.9)]);
    freezeHooks.onCompute = () => {
      useExperimentStore.setState(state => ({
        ledger: {
          ...state.ledger,
          attempts: state.ledger.attempts.map(attempt => (attempt.id === ATTEMPT.id ? mutate(attempt) : attempt)),
        },
      }));
    };
    await expect(freezeRegisteredClaim(draft.id, true)).rejects.toThrow(/身份发生变化或不完整|受控可信/);
    expect(claimStatus(draft.id)).toBe('draft');
    expect(frozenEventCount()).toBe(0);
  });
});
