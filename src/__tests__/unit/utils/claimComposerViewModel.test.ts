/**
 * Claim 工作流纯视图模型测试（模块 08）：
 * 候选绑定投影、严格指标摘要、predicate 结构校验（按 role）、
 * 状态/verdict 失败关闭标签、解封复核（首次 vs 重试）、结果行非有限值处理、草稿漂移。
 */
import { describe, expect, it } from 'vitest';
import {
  candidateBinding,
  claimLabelSet,
  draftBindingDrifted,
  finiteText,
  predicateSpecRows,
  resultRows,
  truncateHash,
  unsealReview,
  validatePredicateStructure,
} from '@/utils/claimComposerViewModel';
import type { Attempt, ClaimPredicate, EvaluationClaim, Experiment, ExperimentLedgerV1, Study } from '@/types/experiment';
import type { TrainMetric } from '@/types/training';

function makeStudy(overrides: Partial<Study> = {}): Study {
  return {
    id: 'study-1', protocolVersion: 1, name: '主张课题', kind: 'candidate_selection', status: 'active',
    question: 'q', comparisonKey: 'key', selectionRule: '手动选择',
    budget: { maxExperiments: null, maxGpuMinutes: null }, createdAt: 1, updatedAt: 1, lockedAt: 1,
    selectedExperimentId: 'exp-1', selectedAttemptId: 'att-1',
    datasetContract: {
      identity: { id: 'ds', name: 'MNIST', taskType: 'image_classification', contentHash: 'sha256:data', fingerprintAlgorithm: 'sha256-v1', sampleCount: 100, classCount: 2, classNames: ['正常', '缺陷'], importedAt: 1 },
      split: { strategy: 'random', seed: 42, validationRatio: 0.2, testRatio: 0.2, sampleUnit: 'image', independence: 'machine_verified', machineChecks: [], splitHash: 'sha256:split' },
      preprocessing: { configHash: 'sha256:pre', summary: 'fixed' },
    },
    ...overrides,
  } as Study;
}

function strictRecord(overrides: Partial<TrainMetric> = {}): TrainMetric {
  return {
    epoch: 1, step: 1, loss: 0.2, accuracy: 0.9, metricName: 'accuracy', metricValue: 0.9,
    optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 1,
    ...overrides,
  } as TrainMetric;
}

function makeAttempt(overrides: Partial<Attempt> = {}, provenance: Partial<Attempt['provenance']> = {}): Attempt {
  return {
    id: 'att-1', protocolVersion: 1, experimentId: 'exp-1', runId: 'r', modelId: 'm',
    config: { epochs: 1, learningRate: 0.01, batchSize: 8, dataset: 'mnist', device: 'cpu', seed: 42, layers: [] } as Attempt['config'],
    ordinal: 3, parentAttemptId: null, restartCount: 0, resumeType: 'fresh',
    status: 'completed', startedAt: 1, endedAt: 2, executionMode: 'native',
    metrics: [strictRecord()],
    artifacts: null,
    provenance: {
      source: 'controlled', executionTrust: 'trusted', witnessedByPipeline: true,
      environment: { applicationVersion: '0', torchVersion: null, pythonVersion: null, device: 'cpu', cudaVersion: null },
      datasetContentHash: 'sha256:data', splitHash: 'sha256:split', testSetHash: 'sha256:test', machineChecks: [],
      testSampleCount: 10, testLabelCounts: null, testTargetSummary: null,
      preprocessingHash: 'sha256:pre', configHash: 'sha256:config', modelWeightsHash: 'sha256:weights',
      ...provenance,
    },
    ...overrides,
  } as Attempt;
}

function makeLedger(studies: Study[], experiments: Experiment[], attempts: Attempt[]): ExperimentLedgerV1 {
  return { protocolVersion: 1, ledgerId: 'l', studies, experiments, attempts, claims: [], events: [] } as ExperimentLedgerV1;
}

const EXPERIMENT: Experiment = {
  id: 'exp-1', protocolVersion: 1, studyId: 'study-1', name: '方案甲',
  config: {} as Experiment['config'], configHash: 'sha256:config', createdAt: 1,
};

function predicate(overrides: Partial<ClaimPredicate> = {}): ClaimPredicate {
  return {
    id: 'primary-0', role: 'primary', metric: 'recall', operator: 'gte', threshold: 0.95,
    targetClass: '1', aggregation: 'binary', confidenceLevel: 0.95,
    intervalMethod: 'wilson', minimumEffectiveSampleSize: 20,
    ...overrides,
  } as ClaimPredicate;
}

function makeClaim(overrides: Partial<EvaluationClaim> = {}): EvaluationClaim {
  return {
    id: 'claim-1', protocolVersion: 1, studyId: 'study-1', attemptId: 'att-1',
    modelWeightsHash: 'sha256:weights', testDatasetHash: 'sha256:test', preprocessingHash: 'sha256:pre',
    status: 'frozen', revision: 1, predicates: [predicate()],
    frozenHash: 'sha256:frozen', frozenAt: 2, unsealSequence: null, adjudicatedAt: null,
    verdict: null, predicateResults: [], classificationDiagnostics: null,
    conclusionTrust: 'not_evaluated', createdAt: 1, updatedAt: 2,
    ...overrides,
  } as EvaluationClaim;
}

/* ---------------- 候选绑定 ---------------- */

describe('candidateBinding：候选绑定投影', () => {
  it('无 selectedAttemptId：no_candidate，不提供任何回退选择', () => {
    const study = makeStudy({ selectedAttemptId: null } as Partial<Study>);
    const binding = candidateBinding(study, makeLedger([study], [EXPERIMENT], [makeAttempt()]));
    expect(binding.status).toBe('no_candidate');
    expect(binding.canCreateClaim).toBe(false);
    expect(binding.attempt).toBeNull();
  });

  it('selectedAttemptId 不属于当前 Study：失败关闭', () => {
    const study = makeStudy({ selectedAttemptId: 'att-foreign' });
    const binding = candidateBinding(study, makeLedger([study], [EXPERIMENT], [makeAttempt()]));
    expect(binding.status).toBe('candidate_not_in_study');
    expect(binding.canCreateClaim).toBe(false);
    expect(binding.blockers.join('')).toContain('不属于当前 Study');
  });

  it('未完成 / 非 trusted / 缺任一身份哈希：分别给出中文阻断原因', () => {
    const study = makeStudy();
    const cases: Array<[Attempt, string]> = [
      [makeAttempt({ status: 'running' }), '不是已完成运行'],
      [makeAttempt({}, { executionTrust: 'interrupted' }), '不是受控管线可信执行'],
      [makeAttempt({}, { modelWeightsHash: '' }), '缺少模型权重哈希'],
      [makeAttempt({}, { testSetHash: '' }), '缺少测试集哈希'],
      [makeAttempt({}, { preprocessingHash: '' }), '缺少预处理哈希'],
    ];
    for (const [attempt, expected] of cases) {
      const binding = candidateBinding(study, makeLedger([study], [EXPERIMENT], [attempt]));
      expect(binding.canCreateClaim).toBe(false);
      expect(binding.blockers.join('')).toContain(expected);
    }
  });

  it('严格指标摘要不读数组尾项：尾项为 train/batch 时仍用最后合法 validation/epoch', () => {
    const study = makeStudy();
    const attempt = makeAttempt({
      metrics: [
        strictRecord({ epoch: 2, metricValue: 0.912, accuracy: 0.912, timestamp: 2 }),
        strictRecord({ epoch: 3, metricValue: 0.5, accuracy: 0.5, split: 'train', scope: 'batch' }),
      ],
    });
    const binding = candidateBinding(study, makeLedger([study], [EXPERIMENT], [attempt]));
    expect(binding.strictMetricAvailable).toBe(true);
    expect(binding.strictMetricText).toContain('accuracy=91.2%');
    expect(binding.strictMetricText).toContain('epoch 2');
    expect(binding.strictMetricText).not.toContain('50.0%');
  });

  it('严格指标元数据缺失：显示“严格验证指标不可用”，不猜 Accuracy，也不阻止合法 Claim 创建', () => {
    const study = makeStudy();
    const attempt = makeAttempt({ metrics: [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, timestamp: 1 } as TrainMetric] });
    const binding = candidateBinding(study, makeLedger([study], [EXPERIMENT], [attempt]));
    expect(binding.strictMetricAvailable).toBe(false);
    expect(binding.strictMetricText).toBe('严格验证指标不可用');
    // 指标摘要不可用不等于候选资格阻断（资格只看完成/可信/哈希）
    expect(binding.canCreateClaim).toBe(true);
  });
});

/* ---------------- predicate 结构校验（按 role） ---------------- */

describe('validatePredicateStructure：按 role 不按 index', () => {
  it('primary 不在第一项时仍按 role 识别；guardrail 计数正确', () => {
    const result = validatePredicateStructure([
      predicate({ id: 'guardrail-1', role: 'guardrail' }),
      predicate({ id: 'primary-0', role: 'primary' }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.primaryCount).toBe(1);
    expect(result.guardrailCount).toBe(1);
  });

  it('重复 primary / 缺 primary / 超过两个 guardrail / 未知角色 / 重复 ID：全部报结构错误', () => {
    expect(validatePredicateStructure([predicate(), predicate({ id: 'primary-1' })]).errors.join('')).toContain('2 个主指标');
    expect(validatePredicateStructure([predicate({ id: 'g1', role: 'guardrail' })]).errors.join('')).toContain('缺少主指标');
    expect(validatePredicateStructure([
      predicate(),
      predicate({ id: 'g1', role: 'guardrail' }),
      predicate({ id: 'g2', role: 'guardrail' }),
      predicate({ id: 'g3', role: 'guardrail' }),
    ]).errors.join('')).toContain('超过上限');
    expect(validatePredicateStructure([predicate({ role: 'secondary' as never })]).errors.join('')).toContain('角色无法识别');
    expect(validatePredicateStructure([predicate(), predicate({ id: 'primary-0', role: 'guardrail' })]).errors.join('')).toContain('子句 ID 重复');
  });
});

/* ---------------- 状态 / verdict 标签失败关闭 ---------------- */

describe('claimLabelSet：未知枚举失败关闭', () => {
  it('已知状态使用中文标签；未知状态 → 主张状态异常', () => {
    expect(claimLabelSet(makeClaim({ status: 'draft' })).statusLabel).toBe('草稿');
    expect(claimLabelSet(makeClaim({ status: 'frozen' })).statusLabel).toBe('已冻结');
    expect(claimLabelSet(makeClaim({ status: 'adjudicated' })).statusLabel).toBe('已裁决');
    expect(claimLabelSet(makeClaim({ status: 'post_hoc' })).statusLabel).toBe('事后主张');
    const abnormal = claimLabelSet(makeClaim({ status: 'approved' as never }));
    expect(abnormal.statusLabel).toBe('主张状态异常');
    expect(abnormal.statusAbnormal).toBe(true);
    // 不把未知原始字符串展示给用户
    expect(abnormal.statusLabel).not.toContain('approved');
  });

  it('verdict：null → 尚未裁决；正式值 → PASS/FAIL/INCONCLUSIVE；未知 → 裁决记录异常', () => {
    expect(claimLabelSet(makeClaim({ verdict: null })).verdictText).toBe('尚未裁决');
    expect(claimLabelSet(makeClaim({ verdict: 'pass' })).verdictText).toBe('PASS');
    expect(claimLabelSet(makeClaim({ verdict: 'fail' })).verdictText).toBe('FAIL');
    expect(claimLabelSet(makeClaim({ verdict: 'inconclusive' })).verdictText).toBe('INCONCLUSIVE');
    const abnormal = claimLabelSet(makeClaim({ verdict: 'PASS_UPPER' as never }));
    expect(abnormal.verdictText).toBe('裁决记录异常');
    expect(abnormal.verdictAbnormal).toBe(true);
    expect(abnormal.verdictText).not.toBe('INCONCLUSIVE');
    expect(abnormal.verdictText).not.toBe('尚未裁决');
  });
});

/* ---------------- 解封复核 ---------------- */

import { projectClaimUnseal } from '@/utils/claimUnsealProjection';
import type { LedgerEvent as UnsealLedgerEvent } from '@/types/experiment';

function unsealedEvent(claimId: string, testSetHash: string, frozenHash: string, sequence: number): UnsealLedgerEvent {
  return {
    eventId: `ev-${claimId}-${sequence}`, protocolVersion: 1, sequence: 10, occurredAt: 100,
    entityType: 'claim', entityId: claimId, eventType: 'claim_unsealed',
    payload: { frozenHash, testSetHash, unsealSequence: sequence },
  } as UnsealLedgerEvent;
}

describe('unsealReview：消费测试集级共享投影', () => {
  it('快照声称已解封但无授权事件：invalid，不冒充首次也不冒充重试，不生成复核视图', () => {
    const claim = makeClaim({ unsealSequence: 1 });
    const projection = projectClaimUnseal(claim, []);
    expect(projection.mode).toBe('invalid');
    expect(projection.reasons.join('')).toContain('快照声称已解封');
    expect(unsealReview(claim, makeAttempt(), projection)).toBeNull();
  });

  it('快照无序号且无事件：first，生成复核视图', () => {
    const claim = makeClaim();
    const review = unsealReview(claim, makeAttempt(), projectClaimUnseal(claim, []));
    expect(review?.mode).toBe('first');
    expect(review?.sequence).toBe(1);
  });

  it('有合法事件：retry 模式，冻结身份与当前 Attempt 身份分开展示', () => {
    const claim = makeClaim({ unsealSequence: 1 });
    const events = [unsealedEvent('claim-1', 'sha256:test', 'sha256:frozen', 1)];
    const review = unsealReview(claim, makeAttempt(), projectClaimUnseal(claim, events));
    expect(review?.mode).toBe('retry');
    expect(review?.sequence).toBe(1);
    // 冻结 Claim 自身身份（不得拿当前 Attempt 哈希冒充）
    expect(review?.claimModelWeightsHash).toBe('sha256:weights');
    expect(review?.claimTestDatasetHash).toBe('sha256:test');
    expect(review?.claimPreprocessingHash).toBe('sha256:pre');
    // 当前 Attempt 身份单独展示
    expect(review?.attemptModelWeightsHash).toBe('sha256:weights');
    expect(review?.attemptTestSetHash).toBe('sha256:test');
    expect(review?.attemptModelId).toBe('m');
    expect(review?.frozenHash).toBe('sha256:frozen');
  });

  it('同测试集已被其他 Claim 解封：subsequent 模式与真实序号', () => {
    const claim = makeClaim();
    const events = [unsealedEvent('claim-other', 'sha256:test', 'sha256:frozen-other', 1)];
    const review = unsealReview(claim, makeAttempt(), projectClaimUnseal(claim, events));
    expect(review?.mode).toBe('subsequent');
    expect(review?.sequence).toBe(2);
    expect(review?.testSetHistory).toEqual([1]);
  });

  it('invalid 投影或非 frozen 主张：不生成复核视图', () => {
    const claim = makeClaim();
    const conflictEvents = [
      unsealedEvent('claim-1', 'sha256:test', 'sha256:frozen', 1),
      unsealedEvent('claim-1', 'sha256:test', 'sha256:frozen', 2),
    ];
    expect(unsealReview(claim, makeAttempt(), projectClaimUnseal(claim, conflictEvents))).toBeNull();
    expect(unsealReview(makeClaim({ status: 'draft' }), makeAttempt(), projectClaimUnseal(claim, []))).toBeNull();
    expect(unsealReview(makeClaim({ status: 'adjudicated' }), makeAttempt(), projectClaimUnseal(claim, []))).toBeNull();
  });
});

/* ---------------- 结果行与非有限值 ---------------- */

describe('resultRows / finiteText：非有限值不冒充正式数字', () => {
  it('NaN/Infinity 渲染“不可用”；子句未知 verdict 渲染“子句裁决异常”', () => {
    const claim = makeClaim({
      status: 'adjudicated',
      verdict: 'inconclusive',
      predicateResults: [{
        predicateId: 'primary-0', pointEstimate: Number.NaN, lowerBound: 0.4, upperBound: Number.POSITIVE_INFINITY,
        effectiveSampleSize: 100, confidenceLevel: 0.95, verdict: 'maybe' as never,
      }],
    });
    const rows = resultRows(claim);
    expect(rows[0].pointEstimate).toBe('不可用');
    expect(rows[0].interval).toBe('[0.4000, 不可用]');
    expect(rows[0].clauseVerdict).toBe('子句裁决异常');
    expect(rows[0].role).toBe('主指标');
    expect(rows[0].acceptance).toBe('≥ 0.95');
  });

  it('finiteText 边界', () => {
    expect(finiteText(0.912)).toBe('0.9120');
    expect(finiteText(Number.NaN)).toBe('不可用');
    expect(finiteText(null)).toBe('不可用');
  });
});

/* ---------------- 其他纯函数 ---------------- */

describe('辅助投影', () => {
  it('predicateSpecRows 覆盖完整统计规格（含 bootstrap 参数）', () => {
    const rows = predicateSpecRows(predicate({
      metric: 'mae', operator: 'lte', intervalMethod: 'seeded_bootstrap', bootstrapSamples: 2000, bootstrapSeed: 42,
    }));
    const labels = rows.map(row => row.label);
    expect(labels).toContain('角色');
    expect(labels).toContain('指标 / 验收方向 / 阈值');
    expect(labels).toContain('置信度');
    expect(labels).toContain('区间方法');
    expect(labels).toContain('最小有效样本 n');
    expect(labels).toContain('Bootstrap 次数');
    expect(labels).toContain('Bootstrap seed');
  });

  it('truncateHash：长哈希截断、短哈希原样、缺失诚实标注', () => {
    expect(truncateHash('sha256:' + 'a'.repeat(64))).toBe(`sha256:${'a'.repeat(11)}…`);
    expect(truncateHash('short')).toBe('short');
    expect(truncateHash(null)).toBe('缺失');
  });

  it('draftBindingDrifted：候选变化后旧草稿判定漂移；无编辑草稿不漂移', () => {
    const study = makeStudy();
    const binding = candidateBinding(study, makeLedger([study], [EXPERIMENT], [makeAttempt()]));
    expect(draftBindingDrifted(null, binding)).toBe(false);
    expect(draftBindingDrifted(makeClaim({ attemptId: 'att-1', status: 'draft' }), binding)).toBe(false);
    expect(draftBindingDrifted(makeClaim({ attemptId: 'att-old', status: 'draft' }), binding)).toBe(true);
  });
});
