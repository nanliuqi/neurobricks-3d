/**
 * Study 总览视图模型纯函数测试（模块 06）：
 * 证据作用域、活动 Study 解析、ordinal 选择、证据摘要、预算（与 runtime 同算法）、
 * 指标安全展示、契约摘要诚实性。
 */
import { describe, expect, it } from 'vitest';
import {
  buildBudgetView,
  buildContractRows,
  buildEvidenceSummary,
  claimRecordSummary,
  conclusionGradeText,
  formatMetricValue,
  projectStudyClaimEvidence,
  resolveActiveStudy,
  scopeStudyEvidence,
  selectLatestAttempt,
  selectLatestSelectableCandidate,
  shortHash,
  strictlyComparable,
} from '@/components/panels/study/studyOverviewViewModel';
import { allowedStudyConclusion, studyUsedGpuMinutes } from '@/utils/studyProtocol';
import { metricNameLabel } from '@/components/panels/study/studyLabels';
import type {
  Attempt,
  EvaluationClaim,
  Experiment,
  ExperimentLedgerV1,
  LedgerEvent,
  Study,
} from '@/types/experiment';
import { TRUST_PROTOCOL_VERSION } from '@/types/experiment';

/* ---------------- 夹具工厂 ---------------- */

function makeStudy(overrides: Partial<Study> = {}): Study {
  return {
    id: 'study-a',
    protocolVersion: TRUST_PROTOCOL_VERSION,
    name: 'Study A',
    kind: 'candidate_selection',
    status: 'draft',
    question: '问题 A',
    datasetContract: {
      identity: {
        id: 'ds-1',
        name: 'MNIST',
        taskType: 'image_classification',
        contentHash: 'hash-a',
        fingerprintAlgorithm: 'sha256-v1',
        sampleCount: 100,
        importedAt: 1,
      },
      split: {
        strategy: 'random',
        seed: 42,
        validationRatio: 0.2,
        testRatio: 0.2,
        sampleUnit: 'image',
        independence: 'machine_verified',
        machineChecks: [],
        splitHash: 'split-hash-a',
      },
      preprocessing: { configHash: 'prep-hash-a', summary: 'dataset=mnist' },
    },
    comparisonKey: 'key-a',
    selectionRule: '手动选择',
    budget: { maxExperiments: 3, maxGpuMinutes: 60 },
    selectedExperimentId: null,
    selectedAttemptId: null,
    createdAt: 1,
    updatedAt: 1,
    lockedAt: null,
    ...overrides,
  };
}

function makeExperiment(id: string, studyId: string): Experiment {
  return {
    id,
    protocolVersion: TRUST_PROTOCOL_VERSION,
    studyId,
    name: `实验 ${id}`,
    config: {} as Experiment['config'],
    configHash: `hash-${id}`,
    createdAt: 1,
  };
}

function makeAttempt(overrides: Partial<Attempt> & { id: string; experimentId: string }): Attempt {
  return {
    protocolVersion: TRUST_PROTOCOL_VERSION,
    runId: `run-${overrides.id}`,
    modelId: null,
    config: { seed: 42, learningRate: 0.001, weightDecay: 0 } as Attempt['config'],
    ordinal: 1,
    parentAttemptId: null,
    restartCount: 0,
    resumeType: 'fresh',
    status: 'completed',
    startedAt: 1000,
    endedAt: 61_000,
    provenance: {
      source: 'controlled',
      executionTrust: 'trusted',
      environment: { applicationVersion: '0', torchVersion: null, pythonVersion: null, device: 'cpu', cudaVersion: null },
      datasetContentHash: null,
      splitHash: null,
      testSetHash: null,
      machineChecks: [],
      testSampleCount: null,
      testLabelCounts: null,
      testTargetSummary: null,
      preprocessingHash: null,
      configHash: 'hash',
      modelWeightsHash: null,
      witnessedByPipeline: false,
    },
    metrics: [],
    artifacts: null,
    executionMode: 'native',
    ...overrides,
  };
}

function makeClaim(id: string, studyId: string, overrides: Partial<EvaluationClaim> = {}): EvaluationClaim {
  return {
    id,
    protocolVersion: TRUST_PROTOCOL_VERSION,
    studyId,
    attemptId: 'attempt-a1',
    modelWeightsHash: 'w',
    testDatasetHash: 't',
    preprocessingHash: 'p',
    status: 'draft',
    revision: 1,
    predicates: [],
    frozenHash: null,
    frozenAt: null,
    unsealSequence: null,
    adjudicatedAt: null,
    verdict: null,
    predicateResults: [],
    classificationDiagnostics: null,
    conclusionTrust: 'not_evaluated',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeLedger(overrides: Partial<ExperimentLedgerV1> = {}): ExperimentLedgerV1 {
  return {
    protocolVersion: TRUST_PROTOCOL_VERSION,
    ledgerId: 'ledger-1',
    studies: [],
    experiments: [],
    attempts: [],
    claims: [],
    events: [],
    ...overrides,
  };
}

/* ---------------- 证据作用域 ---------------- */

describe('证据作用域：Study A/B 交错不串用', () => {
  it('交错排列的 Experiment/Attempt/Claim 严格按归属过滤', () => {
    const ledger = makeLedger({
      experiments: [
        makeExperiment('exp-a1', 'study-a'),
        makeExperiment('exp-b1', 'study-b'),
        makeExperiment('exp-a2', 'study-a'),
        makeExperiment('exp-b2', 'study-b'),
      ],
      attempts: [
        makeAttempt({ id: 'att-a1', experimentId: 'exp-a1', ordinal: 1 }),
        makeAttempt({ id: 'att-b1', experimentId: 'exp-b1', ordinal: 1 }),
        makeAttempt({ id: 'att-a2', experimentId: 'exp-a2', ordinal: 2 }),
        makeAttempt({ id: 'att-b2', experimentId: 'exp-b2', ordinal: 2 }),
        // 名称相似但归属不同的干扰项
        makeAttempt({ id: 'att-a-lookalike', experimentId: 'exp-b2', ordinal: 3 }),
      ],
      claims: [
        makeClaim('claim-a', 'study-a'),
        makeClaim('claim-b', 'study-b'),
      ],
    });

    const scopeA = scopeStudyEvidence(ledger, 'study-a');
    expect(scopeA.experiments.map(item => item.id)).toEqual(['exp-a1', 'exp-a2']);
    expect(scopeA.attempts.map(item => item.id)).toEqual(['att-a1', 'att-a2']);
    expect(scopeA.claims.map(item => item.id)).toEqual(['claim-a']);

    const scopeB = scopeStudyEvidence(ledger, 'study-b');
    expect(scopeB.experiments.map(item => item.id)).toEqual(['exp-b1', 'exp-b2']);
    expect(scopeB.attempts.map(item => item.id)).toEqual(['att-b1', 'att-b2', 'att-a-lookalike']);
    expect(scopeB.claims.map(item => item.id)).toEqual(['claim-b']);
  });
});

describe('resolveActiveStudy：无效身份安全回退', () => {
  const ledger = makeLedger({
    studies: [makeStudy(), makeStudy({ id: 'study-archived', archivedAt: 2 })],
  });

  it('activeStudyId 不存在时返回 null（不读取其他 Study 替代）', () => {
    expect(resolveActiveStudy(ledger, 'missing')).toBeNull();
    expect(resolveActiveStudy(ledger, null)).toBeNull();
  });

  it('activeStudyId 指向已归档 Study 时返回 null', () => {
    expect(resolveActiveStudy(ledger, 'study-archived')).toBeNull();
  });

  it('有效活动 Study 正常返回', () => {
    expect(resolveActiveStudy(ledger, 'study-a')?.id).toBe('study-a');
  });
});

/* ---------------- Attempt 选择规则 ---------------- */

describe('最新 Attempt 按 ordinal 选择（不依赖数组顺序）', () => {
  const attempts = [
    makeAttempt({ id: 'a3', experimentId: 'e', ordinal: 3 }),
    makeAttempt({ id: 'a1', experimentId: 'e', ordinal: 1 }),
    makeAttempt({ id: 'a2', experimentId: 'e', ordinal: 2 }),
  ];

  it('数组乱序时仍选中 ordinal 最大者', () => {
    expect(selectLatestAttempt(attempts)?.id).toBe('a3');
    expect(selectLatestAttempt([...attempts].reverse())?.id).toBe('a3');
  });

  it('空列表返回 null', () => {
    expect(selectLatestAttempt([])).toBeNull();
  });

  it('候选入口只接受完成且执行可信的 Attempt，并按 ordinal 取最新', () => {
    const pool = [
      makeAttempt({ id: 'c1', experimentId: 'e', ordinal: 1, status: 'completed', provenance: { ...makeAttempt({ id: 'x', experimentId: 'e' }).provenance, executionTrust: 'trusted' } }),
      makeAttempt({ id: 'c2', experimentId: 'e', ordinal: 2, status: 'running' }),
      makeAttempt({ id: 'c3', experimentId: 'e', ordinal: 3, status: 'completed', provenance: { ...makeAttempt({ id: 'x', experimentId: 'e' }).provenance, executionTrust: 'unverified' } }),
      makeAttempt({ id: 'c4', experimentId: 'e', ordinal: 4, status: 'completed', provenance: { ...makeAttempt({ id: 'x', experimentId: 'e' }).provenance, executionTrust: 'trusted' } }),
    ];
    expect(selectLatestSelectableCandidate(pool)?.id).toBe('c4');
    expect(selectLatestSelectableCandidate([...pool].reverse())?.id).toBe('c4');
  });
});

/* ---------------- 证据摘要 ---------------- */

describe('buildEvidenceSummary：计数与信任区分', () => {
  it('状态计数准确；未知状态按非完成处理', () => {
    const attempts = [
      makeAttempt({ id: 't1', experimentId: 'e', status: 'completed', provenance: { ...makeAttempt({ id: 'x', experimentId: 'e' }).provenance, executionTrust: 'trusted' } }),
      makeAttempt({ id: 't2', experimentId: 'e', status: 'running', startedAt: 1000, endedAt: null }),
      makeAttempt({ id: 't3', experimentId: 'e', status: 'failed' }),
      makeAttempt({ id: 't4', experimentId: 'e', status: 'cancelled' }),
      makeAttempt({ id: 't5', experimentId: 'e', status: 'interrupted' }),
      makeAttempt({ id: 't6', experimentId: 'e', status: 'paused', startedAt: 1000, endedAt: null }),
      makeAttempt({ id: 't7', experimentId: 'e', status: 'completed', provenance: { ...makeAttempt({ id: 'x', experimentId: 'e' }).provenance, executionTrust: 'unverified' } }),
      makeAttempt({ id: 't8', experimentId: 'e', status: 'mystery' as Attempt['status'] }),
    ];
    const summary = buildEvidenceSummary([makeExperiment('e', 'study-a')], attempts, []);
    expect(summary.attemptCount).toBe(8);
    expect(summary.completedCount).toBe(2);
    expect(summary.activeCount).toBe(2);
    expect(summary.failedCount).toBe(3);
    expect(summary.trustedCompletedCount).toBe(1);
    expect(summary.unverifiedOrExternalCount).toBe(1);
  });

  it('有部分曲线但不可比较的 Attempt 单独计数', () => {
    const attempts = [
      makeAttempt({ id: 'p1', experimentId: 'e', status: 'interrupted', metrics: [{ epoch: 1, step: 1, loss: 1, accuracy: 0.5, timestamp: 1 }] }),
      makeAttempt({ id: 'p2', experimentId: 'e', status: 'completed', metrics: [{ epoch: 1, step: 1, loss: 1, accuracy: 0.5, timestamp: 1 }] }),
    ];
    const summary = buildEvidenceSummary([], attempts, []);
    expect(summary.partialCurveOnlyCount).toBe(1);
  });

  it('执行可信不升级成结论可信：裁决存在但存档信任为 not_evaluated 且无审计事件链时不得采信', () => {
    // 旧版本这里断言 hasAdjudicatedVerdict=true 并据此显示结论可信，
    // 固化了“裁决存在即结论可信”的错误行为；验收补丁后必须失败关闭。
    const attempts = [makeAttempt({ id: 't1', experimentId: 'e' })];
    const withoutClaim = buildEvidenceSummary([], attempts, []);
    expect(withoutClaim.trustedCompletedCount).toBe(1);

    const projection = projectStudyClaimEvidence(
      makeStudy(),
      attempts,
      [makeClaim('c1', 'study-a', { status: 'adjudicated', verdict: 'pass' })], // conclusionTrust 仍为 not_evaluated，无事件
      [],
      'healthy',
    );
    expect(projection.adjudicatedRecords).toBe(1);
    expect(projection.formalVerdictRecords).toBe(1);
    // 审计链不完整 + Attempt 缺失 → 不得授予任何有效信任等级，不得显示结论可信/金标。
    expect(projection.auditCompleteRecords).toBe(0);
    expect(projection.highestEffectiveTrust).toBeNull();
    expect(projection.structuralAnomalyCount).toBe(1);
    expect(conclusionGradeText(projection)).toBe('结论记录异常，不能授予可信等级');
    expect(conclusionGradeText(projection)).not.toContain('金标');
  });

  it('未知状态/未知信任值的 Attempt 计入记录异常，不算完成也不算活动', () => {
    const attempts = [
      makeAttempt({ id: 'u1', experimentId: 'e', status: 'mystery' as Attempt['status'] }),
      makeAttempt({
        id: 'u2', experimentId: 'e', status: 'completed',
        provenance: { ...makeAttempt({ id: 'x', experimentId: 'e' }).provenance, executionTrust: 'mystery' as Attempt['provenance']['executionTrust'] },
      }),
    ];
    const summary = buildEvidenceSummary([], attempts, []);
    expect(summary.anomalousAttemptRecordCount).toBe(2);
    expect(summary.completedCount).toBe(1); // u2 状态已知；u1 未知不算完成
    expect(summary.activeCount).toBe(0);
    expect(summary.trustedCompletedCount).toBe(0); // 未知信任不算可信
  });
});

/* ---------------- 预算：与 runtime 同一算法 ---------------- */

describe('GPU 预算计算与 experimentRuntime 语义一致', () => {
  it('运行态按 now 计时；终止态缺 endedAt 保守计 0；未开始不计', () => {
    const attempts = [
      makeAttempt({ id: 'g1', experimentId: 'e', status: 'running', startedAt: 0, endedAt: null }),
      makeAttempt({ id: 'g2', experimentId: 'e', status: 'completed', startedAt: 0, endedAt: 120_000 }),
      makeAttempt({ id: 'g3', experimentId: 'e', status: 'failed', startedAt: 0, endedAt: null }),
      makeAttempt({ id: 'g4', experimentId: 'e', status: 'pending', startedAt: null, endedAt: null }),
    ];
    // 60_000ms 时刻：running=1 分钟，completed=2 分钟，failed 缺 endedAt=0，pending 不计。
    expect(studyUsedGpuMinutes(attempts, 60_000)).toBeCloseTo(3, 10);
  });

  it('预算视图：超额时文字显示真实值，视觉进度钳制 100%', () => {
    const study = makeStudy({ budget: { maxExperiments: 1, maxGpuMinutes: 1 } });
    const attempts = [
      makeAttempt({ id: 'g1', experimentId: 'e', status: 'completed', startedAt: 0, endedAt: 180_000 }),
    ];
    const view = buildBudgetView(study, [makeExperiment('e', 'study-a')], attempts, 0);
    expect(view.gpuMinutesUsed).toBeCloseTo(3, 10);
    expect(view.gpuBudgetReached).toBe(true);
    expect(view.gpuProgressPercent).toBe(100);
    expect(view.experimentBudgetReached).toBe(true);
  });

  it('无预算上限时不声称达到预算', () => {
    const study = makeStudy({ budget: { maxExperiments: null, maxGpuMinutes: null } });
    const view = buildBudgetView(study, [], [makeAttempt({ id: 'g1', experimentId: 'e' })], 0);
    expect(view.gpuBudgetReached).toBe(false);
    expect(view.experimentBudgetReached).toBe(false);
  });
});

/* ---------------- 指标安全展示 ---------------- */

describe('指标展示安全', () => {
  it('NaN/Infinity/缺失指标值返回 null（不得渲染到界面）', () => {
    expect(formatMetricValue({ epoch: 1, step: 1, loss: 0, accuracy: Number.NaN, metricValue: Number.NaN, timestamp: 1 })).toBeNull();
    expect(formatMetricValue({ epoch: 1, step: 1, loss: 0, accuracy: Number.POSITIVE_INFINITY, timestamp: 1 })).toBeNull();
    expect(formatMetricValue(null)).toBeNull();
    expect(formatMetricValue({ epoch: 1, step: 1, loss: 0, accuracy: 0.9, timestamp: 1 })).toBe('0.9000');
    expect(formatMetricValue({ epoch: 1, step: 1, loss: 0, accuracy: Number.NaN, metricValue: 1.5, timestamp: 1 })).toBe('1.5000');
  });

  it('指标标签来自真实 metricName：回归指标不显示成 Accuracy，未知指标不冒充', () => {
    expect(metricNameLabel('mae', 'tabular_regression')).toBe('MAE');
    expect(metricNameLabel('rmse', 'tabular_regression')).toBe('RMSE');
    expect(metricNameLabel('accuracy', 'image_classification')).toBe('Accuracy');
    expect(metricNameLabel('macro_f1', 'image_classification')).toBe('Macro-F1');
    expect(metricNameLabel(undefined, 'tabular_regression')).toBe('回归指标');
    expect(metricNameLabel(undefined, 'image_classification')).toBe('分类指标');
    expect(metricNameLabel(undefined)).toBe('指标');
    expect(metricNameLabel('unknown_metric' as never, 'image_classification')).toBe('分类指标');
  });
});

/* ---------------- 契约摘要诚实性 ---------------- */

describe('契约摘要：缺失字段诚实展示', () => {
  it('缺失身份/划分字段显示“未记录/未声明”，不猜测', () => {
    const study = makeStudy({
      datasetContract: {
        identity: {
          id: 'ds-x',
          name: '',
          taskType: 'tabular_regression' as const,
          contentHash: null,
          fingerprintAlgorithm: 'missing',
          sampleCount: 0,
          importedAt: 1,
        },
        split: {
          strategy: 'random',
          seed: null,
          validationRatio: 0.2,
          testRatio: 0.2,
          sampleUnit: null,
          independence: 'iid_assumed',
          machineChecks: [],
          splitHash: null,
        },
        preprocessing: { configHash: null, summary: '' },
      },
      comparisonKey: null,
    });
    const rows = buildContractRows(study);
    const byLabel = new Map(rows.map(row => [row.label, row.value]));
    expect(byLabel.get('数据集')).toBe('未记录');
    expect(byLabel.get('内容指纹')).toContain('未记录');
    expect(byLabel.get('seed')).toBe('未记录');
    expect(byLabel.get('样本单位')).toBe('未声明');
    expect(byLabel.get('泄漏检查')).toBe('无检查记录');
    // 缺失身份时不得宣称严格可比：指纹行必须明确说“不能进入”
    expect(byLabel.get('内容指纹')).toContain('不能进入');
  });

  it('哈希默认截断并提供完整值入口', () => {
    const longHash = 'f'.repeat(64);
    expect(shortHash(longHash)).toBe(`${'f'.repeat(16)}…`);
    expect(shortHash('short')).toBe('short');
    expect(shortHash(null)).toBeNull();

    const rows = buildContractRows(makeStudy());
    const fingerprint = rows.find(row => row.label === '内容指纹');
    expect(fingerprint?.fullValue).toBe('hash-a');
    expect(fingerprint?.value.length).toBeLessThan(64);
  });

  it('泄漏检查存在未通过项时如实标注', () => {
    const study = makeStudy();
    study.datasetContract.split.machineChecks = [
      { check: 'group_disjoint', status: 'failed' },
      { check: 'temporal_order', status: 'passed' },
    ];
    const rows = buildContractRows(study);
    expect(rows.find(row => row.label === '泄漏检查')?.value).toBe('存在未通过项');
  });

  it('未知切分策略不直接渲染原始字符串', () => {
    const study = makeStudy();
    study.datasetContract.split.strategy = 'mystery' as typeof study.datasetContract.split.strategy;
    const rows = buildContractRows(study);
    expect(rows.find(row => row.label === '切分策略')?.value).toBe('未知切分策略');
  });

  it('CSV 契约：目标列/特征列只读快照，缺失时诚实标注', () => {
    const csvStudy = makeStudy();
    csvStudy.datasetContract.identity.taskType = 'tabular_regression';
    csvStudy.datasetContract.identity.targetField = 'target';
    csvStudy.datasetContract.identity.featureFields = ['a', 'b'];
    let rows = buildContractRows(csvStudy);
    expect(rows.find(row => row.label === '目标列')?.value).toBe('target');
    expect(rows.find(row => row.label === '特征列')?.value).toContain('2 列');
    expect(rows.find(row => row.label === '特征列')?.fullValue).toBe('a、b');

    // 快照缺失：不猜末列，诚实标注任务定义不完整
    csvStudy.datasetContract.identity.targetField = undefined;
    csvStudy.datasetContract.identity.featureFields = undefined;
    rows = buildContractRows(csvStudy);
    expect(rows.find(row => row.label === '目标列')?.value).toBe('未记录（回归任务定义不完整）');
    expect(rows.find(row => row.label === '特征列')?.value).toBe('未记录');
  });
});

/* ---------------- Claim 证据投影（模块 06 验收补丁） ---------------- */

function claimAttempt(id: string, overrides: Partial<Attempt['provenance']> = {}): Attempt {
  const base = makeAttempt({ id, experimentId: 'exp-a', status: 'completed' });
  return {
    ...base,
    provenance: {
      ...base.provenance,
      executionTrust: 'trusted',
      modelWeightsHash: 'w',
      testSetHash: 't',
      preprocessingHash: 'p',
      machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'passed' }],
      ...overrides,
    },
  };
}

function adjudicatedClaim(overrides: Partial<EvaluationClaim> = {}): EvaluationClaim {
  return makeClaim('claim-1', 'study-a', {
    attemptId: 'att-1',
    status: 'adjudicated',
    verdict: 'pass',
    frozenHash: 'f',
    unsealSequence: 1,
    conclusionTrust: 'gold',
    revision: 1,
    modelWeightsHash: 'w',
    testDatasetHash: 't',
    preprocessingHash: 'p',
    ...overrides,
  });
}

function claimEvent(eventType: string, payload: Record<string, unknown>, sequence: number): LedgerEvent {
  return {
    eventId: `event-${sequence}`,
    protocolVersion: TRUST_PROTOCOL_VERSION,
    sequence,
    occurredAt: 1,
    entityType: 'claim',
    entityId: 'claim-1',
    eventType,
    payload,
  };
}

interface EventChainOptions {
  omitDraft?: boolean;
  omitFreeze?: boolean;
  omitAdjudication?: boolean;
  duplicateFreeze?: boolean;
  /** 模块 08 最终补丁：解封许可见证变体。 */
  omitUnsealed?: boolean;
  duplicateUnsealed?: boolean;
}

function fullEventChain(claim: EvaluationClaim, options: EventChainOptions = {}): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  let sequence = 1;
  // 测试集历史连续性（模块 08 最终补丁）：序号 >1 时补其他 Claim 的前序合法解封事件。
  const ownSequence = claim.unsealSequence ?? 1;
  for (let prior = 1; prior < ownSequence; prior += 1) {
    events.push({
      eventId: `event-prev-${prior}`, protocolVersion: 1, sequence: 0, occurredAt: 1,
      entityType: 'claim', entityId: `claim-prev-${prior}`, eventType: 'claim_unsealed',
      payload: { frozenHash: `sha256:prev-frozen-${prior}`, testSetHash: claim.testDatasetHash, unsealSequence: prior },
    } as LedgerEvent);
  }
  if (!options.omitDraft) {
    events.push(claimEvent('claim_draft_created', {
      revision: claim.revision,
      attemptId: claim.attemptId,
      modelWeightsHash: claim.modelWeightsHash,
      testSetHash: claim.testDatasetHash,
      preprocessingHash: claim.preprocessingHash,
      predicates: claim.predicates,
    }, sequence++));
  }
  if (!options.omitFreeze) {
    events.push(claimEvent('claim_frozen', {
      frozenHash: claim.frozenHash,
      revision: claim.revision,
      attemptId: claim.attemptId,
      modelWeightsHash: claim.modelWeightsHash,
      testSetHash: claim.testDatasetHash,
      preprocessingHash: claim.preprocessingHash,
    }, sequence++));
    if (options.duplicateFreeze) {
      events.push(claimEvent('claim_frozen', {
        frozenHash: claim.frozenHash,
        revision: claim.revision,
        attemptId: claim.attemptId,
        modelWeightsHash: claim.modelWeightsHash,
        testSetHash: claim.testDatasetHash,
        preprocessingHash: claim.preprocessingHash,
      }, sequence++));
    }
  }
  if (!options.omitAdjudication) {
    // 解封许可见证：生命周期 draft → frozen → unsealed → adjudicated（缺它则审计不完整）。
    if (!options.omitUnsealed) {
      events.push(claimEvent('claim_unsealed', {
        frozenHash: claim.frozenHash,
        testSetHash: claim.testDatasetHash,
        unsealSequence: claim.unsealSequence,
      }, sequence++));
    }
    events.push(claimEvent('claim_adjudicated', {
      frozenHash: claim.frozenHash,
      unsealSequence: claim.unsealSequence,
      verdict: claim.verdict,
      conclusionTrust: claim.conclusionTrust,
      predicateResults: claim.predicateResults,
    }, sequence++));
  }
  return events;
}

describe('projectStudyClaimEvidence：裁决记录、审计完整性与结论信任分离', () => {
  const attempts = [claimAttempt('att-1')];

  it('完整证据链 + 健康审计：重算金标，存档一致无 mismatch', () => {
    const claim = adjudicatedClaim();
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    expect(projection.auditCompleteRecords).toBe(1);
    expect(projection.highestEffectiveTrust).toBe('gold');
    expect(projection.trustCounts.gold).toBe(1);
    expect(projection.structuralAnomalyCount).toBe(0);
    expect(projection.nonAuthoritativeCount).toBe(0);
    expect(projection.persistenceBlockedCount).toBe(0);
    expect(conclusionGradeText(projection)).toBe('结论等级：金标裁决');
  });

  it('adjudicated + 未知 verdict：不算正式裁决，不伪装成 INCONCLUSIVE', () => {
    const claim = adjudicatedClaim({ verdict: 'PASS_UPPER' as EvaluationClaim['verdict'] });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    expect(projection.formalVerdictRecords).toBe(0);
    expect(projection.records[0].issues).toContain('unknown_verdict');
    expect(projection.records[0].verdict).toBeNull();
    expect(projection.highestEffectiveTrust).toBeNull();
    expect(conclusionGradeText(projection)).toBe('结论记录异常，不能授予可信等级');
  });

  it('verdict=null：显示记录不完整', () => {
    const claim = adjudicatedClaim({ verdict: null });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    expect(projection.records[0].issues).toContain('missing_verdict');
    expect(projection.formalVerdictRecords).toBe(0);
    expect(projection.highestEffectiveTrust).toBeNull();
  });

  it('post_hoc 永远不能作为独立验证背书', () => {
    const claim = adjudicatedClaim({ status: 'post_hoc' });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    expect(projection.adjudicatedRecords).toBe(0);
    expect(projection.records[0].issues).toContain('post_hoc');
    expect(projection.highestEffectiveTrust).toBeNull();
  });

  it('Claim 引用其他 Study 的 Attempt（不在作用域内）：不得采信', () => {
    const claim = adjudicatedClaim({ attemptId: 'att-other-study' });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    expect(projection.records[0].issues).toContain('attempt_not_in_study');
    expect(projection.auditCompleteRecords).toBe(0);
    expect(projection.highestEffectiveTrust).toBeNull();
  });

  it('Attempt 不存在：不得采信', () => {
    const claim = adjudicatedClaim({ attemptId: 'att-missing' });
    const projection = projectStudyClaimEvidence(makeStudy(), [], [claim], fullEventChain(claim), 'healthy');
    expect(projection.records[0].issues).toContain('attempt_not_in_study');
    expect(projection.highestEffectiveTrust).toBeNull();
  });

  it.each([
    ['draft 事件缺失', { omitDraft: true }],
    ['freeze 事件缺失', { omitFreeze: true }],
    ['adjudication 事件缺失', { omitAdjudication: true }],
    ['freeze 事件重复', { duplicateFreeze: true }],
  ] as const)('%s：审计不完整，不得采信', (_label, options) => {
    const claim = adjudicatedClaim();
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim, options), 'healthy');
    expect(projection.auditCompleteRecords).toBe(0);
    expect(projection.records[0].issues).toContain('audit_incomplete');
    expect(projection.highestEffectiveTrust).toBeNull();
  });

  it.each([
    ['权重哈希', { modelWeightsHash: 'other' }],
    ['测试集哈希', { testSetHash: 'other' }],
    ['预处理哈希', { preprocessingHash: 'other' }],
  ] as const)('%s不一致：不得采信', (_label, provenanceOverrides) => {
    const claim = adjudicatedClaim();
    const mismatched = [claimAttempt('att-1', provenanceOverrides)];
    const projection = projectStudyClaimEvidence(makeStudy(), mismatched, [claim], fullEventChain(claim), 'healthy');
    expect(projection.auditCompleteRecords).toBe(0);
    expect(projection.highestEffectiveTrust).toBeNull();
  });

  it('auditPersistence=degraded/unavailable：即使事件链完整也不得背书金标或档案完整，且不算 Claim 结构损坏', () => {
    for (const persistence of ['degraded', 'unavailable'] as const) {
      const claim = adjudicatedClaim();
      const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), persistence);
      expect(projection.records[0].issues).toContain('audit_persistence_not_healthy');
      expect(projection.highestEffectiveTrust).toBeNull();
      expect(projection.trustCounts.gold).toBe(0);
      // 全局档案阻断不是 Claim 结构损坏，必须单独计数
      expect(projection.structuralAnomalyCount).toBe(0);
      expect(projection.persistenceBlockedCount).toBe(1);
      expect(conclusionGradeText(projection)).toBe('裁决记录完整，但当前档案持久化状态无法背书');
      expect(conclusionGradeText(projection)).not.toContain('金标');
      // 与实体审计链不完整使用不同文案
      expect(conclusionGradeText(projection)).not.toBe('裁决记录存在，但实体审计链不完整');
    }
  });

  it('存档 gold 但协议重算为 iid_only：必须降级并标记不一致', () => {
    // machineChecks 为空 → 重算只能到 iid_only
    const attemptsNoChecks = [claimAttempt('att-1', { machineChecks: [] })];
    const claim = adjudicatedClaim({ conclusionTrust: 'gold' });
    const projection = projectStudyClaimEvidence(makeStudy(), attemptsNoChecks, [claim], fullEventChain(claim), 'healthy');
    expect(projection.highestEffectiveTrust).toBe('iid_only');
    expect(projection.trustCounts.gold).toBe(0);
    expect(projection.records[0].issues).toContain('trust_mismatch');
    expect(conclusionGradeText(projection)).toBe('结论等级：仅在样本 IID 假设下成立');
  });

  it('存档 gold 但协议重算为 exploratory：必须降级并标记不一致', () => {
    // 第二次解封（unsealSequence=2）→ conclusionTrustFor 只能给 exploratory。
    // 注：executionTrust 非 trusted 时现行协议连 exploratory 也不授予（attempt_not_eligible 资格门），
    // 不再用它构造重算降级路径。
    const claim = adjudicatedClaim({ conclusionTrust: 'gold', unsealSequence: 2 });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    expect(projection.highestEffectiveTrust).toBe('exploratory');
    expect(projection.records[0].issues).toContain('trust_mismatch');
    expect(conclusionGradeText(projection)).toBe('结论等级：探索性裁决，不构成独立验证背书');
  });

  it.each([
    ['pass', 'PASS'],
    ['fail', 'FAIL'],
    ['inconclusive', 'INCONCLUSIVE'],
  ] as const)('相同完整证据下 %s 与其他 verdict 获得相同信任等级（%s 不被羞辱性降级）', (verdict) => {
    const claim = adjudicatedClaim({ verdict });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    expect(projection.highestEffectiveTrust).toBe('gold');
    expect(projection.records[0].verdict).toBe(verdict);
    expect(projection.records[0].issues).toHaveLength(0);
  });

  it('无裁决记录时：尚未形成正式裁决', () => {
    // draft 引用作用域内存在的 Attempt：干净草稿不计异常，不触发结构异常文案。
    const projection = projectStudyClaimEvidence(
      makeStudy(),
      attempts,
      [makeClaim('c-draft', 'study-a', { attemptId: 'att-1' })],
      [],
      'healthy',
    );
    expect(projection.adjudicatedRecords).toBe(0);
    expect(projection.structuralAnomalyCount).toBe(0);
    expect(conclusionGradeText(projection)).toBe('结论等级：尚未形成正式裁决');
  });
});

/* ---------------- 最终失败关闭（模块 06 最终补丁） ---------------- */

describe('projectStudyClaimEvidence：未知枚举与作用域失败关闭', () => {
  const attempts = [claimAttempt('att-1')];

  it.each([
    ['future_gold', 'future_gold'],
    ['空字符串', ''],
    ['null', null],
    ['undefined', undefined],
    ['数字', 42],
  ])('存档 conclusionTrust=%s：即使事件链完整且重算为 gold，也不得获得任何有效等级', (_label, badTrust) => {
    const claim = adjudicatedClaim({ conclusionTrust: badTrust as EvaluationClaim['conclusionTrust'] });
    // 事件链完整（adjudication 事件 payload 与存档一致）、健康审计、协议重算可达 gold。
    let projection!: ReturnType<typeof projectStudyClaimEvidence>;
    expect(() => {
      projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    }).not.toThrow(); // 不得抛出运行时异常
    expect(projection.records[0].issues).toContain('unknown_conclusion_trust');
    expect(projection.records[0].effectiveTrust).toBeNull();
    expect(projection.records[0].archivedTrust).toBeNull(); // 不伪装成合法 ConclusionTrust
    expect(projection.highestEffectiveTrust).toBeNull();
    // trustCounts 不被污染
    expect(projection.trustCounts).toEqual({ not_evaluated: 0, exploratory: 0, iid_only: 0, gold: 0 });
    expect(projection.structuralAnomalyCount).toBe(1);
    expect(conclusionGradeText(projection)).not.toContain('金标');
    expect(conclusionGradeText(projection)).toBe('结论记录异常，不能授予可信等级');
  });

  it('未知 Claim status（如 approved）：不算 adjudicated，带 PASS+gold 也不获得背书，不伪装成其他状态', () => {
    const claim = adjudicatedClaim({ status: 'approved' as EvaluationClaim['status'] });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    expect(projection.adjudicatedRecords).toBe(0);
    expect(projection.formalVerdictRecords).toBe(0);
    expect(projection.records[0].issues).toContain('unknown_claim_status');
    expect(projection.records[0].verdict).toBeNull();
    expect(projection.records[0].effectiveTrust).toBeNull();
    expect(projection.records[0].classification).toBe('structural_anomaly');
    expect(projection.structuralAnomalyCount).toBe(1);
  });

  it('draft/frozen 是合法未裁决状态：不计任何异常', () => {
    for (const status of ['draft', 'frozen'] as const) {
      const claim = makeClaim(`c-${status}`, 'study-a', { status, attemptId: 'att-1' });
      const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], [], 'healthy');
      expect(projection.records[0].classification).toBe('normal');
      expect(projection.structuralAnomalyCount).toBe(0);
      expect(projection.nonAuthoritativeCount).toBe(0);
      expect(projection.persistenceBlockedCount).toBe(0);
      expect(projection.records[0].issues).toHaveLength(0);
    }
  });

  it('post_hoc 是合法记录：不计结构异常，但永不获得有效信任', () => {
    const claim = adjudicatedClaim({ status: 'post_hoc' });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    expect(projection.structuralAnomalyCount).toBe(0);
    expect(projection.nonAuthoritativeCount).toBe(1);
    expect(projection.records[0].classification).toBe('non_authoritative');
    expect(projection.records[0].effectiveTrust).toBeNull();
    expect(conclusionGradeText(projection)).toBe('仅有事后主张，不具备独立验证资格');
  });

  it('投影自身拒绝跨 Study Claim（不依赖调用方预过滤）', () => {
    // Study B 的 Claim 直接传给 Study A 的投影
    const foreignClaim = adjudicatedClaim({ studyId: 'study-b' });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [foreignClaim], fullEventChain(foreignClaim), 'healthy');
    expect(projection.records[0].issues).toEqual(['claim_not_in_study']);
    expect(projection.adjudicatedRecords).toBe(0);
    expect(projection.formalVerdictRecords).toBe(0);
    expect(projection.auditCompleteRecords).toBe(0);
    expect(projection.highestEffectiveTrust).toBeNull();
    expect(projection.structuralAnomalyCount).toBe(1);
  });

  it('claim.studyId=B 但 attemptId 指向 Study A 的 Attempt：仍按越界拒绝', () => {
    const foreignClaim = adjudicatedClaim({ studyId: 'study-b', attemptId: 'att-1' });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [foreignClaim], fullEventChain(foreignClaim), 'healthy');
    expect(projection.records[0].issues).toEqual(['claim_not_in_study']);
    expect(projection.highestEffectiveTrust).toBeNull();
  });

  it('claim.studyId=A 但 attemptId 指向 Study B 的 Attempt：失败关闭', () => {
    const claim = adjudicatedClaim({ attemptId: 'att-of-study-b' });
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [claim], fullEventChain(claim), 'healthy');
    expect(projection.records[0].issues).toContain('attempt_not_in_study');
    expect(projection.highestEffectiveTrust).toBeNull();
    expect(projection.structuralAnomalyCount).toBe(1);
  });

  it('同时存在有效金标与异常 Claim：最高等级仍为 gold，异常计数不消失', () => {
    const goodClaim = adjudicatedClaim();
    const badClaim = adjudicatedClaim({
      id: 'claim-2',
      verdict: 'PASS_UPPER' as EvaluationClaim['verdict'],
      attemptId: 'att-missing',
      // 不同测试集：避免其解封事件与 goodClaim 在同一 testSetHash 上序号重复占用（真实档案冲突）
      testDatasetHash: 'sha256:test-2',
    });
    const events = [...fullEventChain(goodClaim), ...fullEventChain(badClaim).map(event => ({ ...event, entityId: 'claim-2', eventId: `${event.eventId}-2` }))];
    const projection = projectStudyClaimEvidence(makeStudy(), attempts, [goodClaim, badClaim], events, 'healthy');
    expect(projection.highestEffectiveTrust).toBe('gold');
    expect(projection.structuralAnomalyCount).toBe(1);
    expect(conclusionGradeText(projection)).toBe('结论等级：金标裁决');
    // 金标只归属具体 Claim：逐条摘要同时展示真实差异
    const summaries = projection.records.map(record => claimRecordSummary(record));
    expect(summaries[0]).toContain('PASS · 金标');
    expect(summaries[1]).toContain('未知 verdict · 记录异常');
  });

  it('逐条 Claim 摘要：裁决结果与自身等级分别展示，不只显示最高等级', () => {
    const goldPass = adjudicatedClaim();
    const projectionPass = projectStudyClaimEvidence(makeStudy(), attempts, [goldPass], fullEventChain(goldPass), 'healthy');
    expect(claimRecordSummary(projectionPass.records[0])).toMatch(/PASS · 金标$/);

    const iidFail = adjudicatedClaim({
      verdict: 'fail',
      conclusionTrust: 'iid_only',
    });
    // 重算为 gold（machineChecks 齐全）但存档 iid_only → 取低为 iid_only + mismatch
    const projectionFail = projectStudyClaimEvidence(makeStudy(), attempts, [iidFail], fullEventChain(iidFail), 'healthy');
    expect(claimRecordSummary(projectionFail.records[0])).toContain('FAIL · 仅 IID 假设');

    const inconclusive = adjudicatedClaim({ verdict: 'inconclusive' });
    const projectionInc = projectStudyClaimEvidence(makeStudy(), attempts, [inconclusive], fullEventChain(inconclusive), 'healthy');
    expect(claimRecordSummary(projectionInc.records[0])).toContain('INCONCLUSIVE · 金标');

    // 审计不完整：PASS 也不获得等级
    const noChain = adjudicatedClaim();
    const projectionNoChain = projectStudyClaimEvidence(makeStudy(), attempts, [noChain], [], 'healthy');
    expect(claimRecordSummary(projectionNoChain.records[0])).toContain('PASS · 审计不完整');
    expect(conclusionGradeText(projectionNoChain)).toBe('裁决记录存在，但实体审计链不完整');
  });
});

/* ---------------- 严格可比资格（保守判定） ---------------- */

describe('strictlyComparable：不能只看 comparisonKey', () => {
  function completeStudy(): Study {
    const study = makeStudy();
    study.comparisonKey = 'key-a';
    study.datasetContract.split.splitHash = 'split-a';
    study.datasetContract.preprocessing.configHash = 'prep-a';
    return study;
  }

  it('全部必要字段完整才具备资格', () => {
    expect(strictlyComparable(completeStudy())).toBe(true);
  });

  it('comparisonKey 非空但关键哈希缺失 → 无法验证', () => {
    const noContent = completeStudy();
    noContent.datasetContract.identity.contentHash = null;
    expect(strictlyComparable(noContent)).toBe(false);

    const noSplit = completeStudy();
    noSplit.datasetContract.split.splitHash = null;
    expect(strictlyComparable(noSplit)).toBe(false);

    const noPrep = completeStudy();
    noPrep.datasetContract.preprocessing.configHash = null;
    expect(strictlyComparable(noPrep)).toBe(false);
  });

  it('未知 taskType / 未知切分策略 → 无法验证', () => {
    const unknownTask = completeStudy();
    unknownTask.datasetContract.identity.taskType = 'object_detection' as typeof unknownTask.datasetContract.identity.taskType;
    expect(strictlyComparable(unknownTask)).toBe(false);

    const unknownStrategy = completeStudy();
    unknownStrategy.datasetContract.split.strategy = 'mystery' as typeof unknownStrategy.datasetContract.split.strategy;
    expect(strictlyComparable(unknownStrategy)).toBe(false);
  });
});

/* ---------------- 未知 Study kind 失败关闭 ---------------- */

describe('allowedStudyConclusion：未知类型失败关闭', () => {
  it('未知 kind 不得冒充对照消融', () => {
    const study = makeStudy({ kind: 'mystery' as Study['kind'] });
    const text = allowedStudyConclusion(study);
    expect(text).toBe('课题类型无法识别，不能生成结论语言。');
    expect(text).not.toContain('对照消融');
  });

  it('三种已知类型结论语言不变', () => {
    expect(allowedStudyConclusion(makeStudy({ kind: 'free_exploration' }))).toContain('描述性观察');
    expect(allowedStudyConclusion(makeStudy({ kind: 'candidate_selection' }))).toContain('候选选择');
    expect(allowedStudyConclusion(makeStudy({ kind: 'controlled_ablation' }), undefined, ['a', 'b'])).toContain('改动组合');
  });
});
