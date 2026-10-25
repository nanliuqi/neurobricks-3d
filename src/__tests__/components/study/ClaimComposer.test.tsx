import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ClaimComposer from '@/components/study/ClaimComposer';
import { useExperimentStore } from '@/stores/useExperimentStore';
import type { Attempt, EvaluationClaim, Experiment, Study } from '@/types/experiment';

const STUDY: Study = {
  id: 'study-ui', protocolVersion: 1, name: '主张界面', kind: 'candidate_selection', status: 'active',
  question: '是否达标？', comparisonKey: 'key', selectionRule: '手动选择',
  budget: { maxExperiments: 2, maxGpuMinutes: 60 }, createdAt: 1, updatedAt: 1, lockedAt: 1,
  selectedExperimentId: 'experiment-ui', selectedAttemptId: 'attempt-ui',
  datasetContract: {
    identity: { id: 'data', name: 'MNIST', taskType: 'image_classification', contentHash: 'sha256:data', fingerprintAlgorithm: 'sha256-v1', sampleCount: 100, classCount: 2, classNames: ['正常', '缺陷'], importedAt: 1 },
    split: { strategy: 'predefined', seed: 42, validationRatio: 0.2, testRatio: 0.2, sampleUnit: 'image', independence: 'machine_verified', machineChecks: [], splitHash: 'sha256:split' },
    preprocessing: { configHash: 'sha256:pre', summary: 'fixed' },
  },
};

const EXPERIMENT: Experiment = {
  id: 'experiment-ui', protocolVersion: 1, studyId: STUDY.id, name: 'LeNet-5',
  config: { epochs: 1, learningRate: 0.001, batchSize: 8, dataset: 'mnist', device: 'cuda', seed: 42, layers: [] },
  configHash: 'sha256:config', createdAt: 1,
};

const ATTEMPT: Attempt = {
  id: 'attempt-ui', protocolVersion: 1, experimentId: EXPERIMENT.id, runId: 'run-ui', modelId: 'model-ui',
  config: EXPERIMENT.config, ordinal: 1, parentAttemptId: null, restartCount: 0, resumeType: 'fresh',
  status: 'completed', startedAt: 1, endedAt: 2,
  metrics: [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, metricName: 'accuracy', timestamp: 1 }],
  executionMode: 'native', artifacts: { weights: true, fullModel: true, numpy: true, perModel: true },
  provenance: {
    source: 'controlled', executionTrust: 'trusted', witnessedByPipeline: true,
    environment: { applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cuda', cudaVersion: '12' },
    datasetContentHash: 'sha256:data', splitHash: 'sha256:split', testSetHash: 'sha256:test',
    machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'passed' }],
    testSampleCount: 40, testLabelCounts: { '0': 20, '1': 20 }, preprocessingHash: 'sha256:pre',
    configHash: 'sha256:config', modelWeightsHash: 'sha256:weights',
  },
};

describe('ClaimComposer protocol interactions', () => {
  beforeEach(() => {
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(EXPERIMENT);
    useExperimentStore.getState().registerAttempt(ATTEMPT);
    // 模块 08 协议前置：冻结与解封只在档案持久化 healthy 时开放（留痕失败关闭）。
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
  });

  afterEach(() => {
    act(() => useExperimentStore.getState().resetLedgerForTests());
  });

  it('always confirms irreversible freezing and keeps the same draft editable after cancel', async () => {
    render(<ClaimComposer study={STUDY} />);
    const freezeButton = screen.getByRole('button', { name: '冻结主张' });
    await waitFor(() => expect(freezeButton).toBeEnabled());

    fireEvent.click(freezeButton);
    const dialog = screen.getByRole('alertdialog', { name: '确认冻结这条评估主张？' });
    expect(dialog).toHaveTextContent('统计预演警告');
    expect(dialog).toHaveTextContent('即使结果最理想也无法 PASS');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.getByText('正在编辑主张草稿 v1')).toBeInTheDocument();
    expect(useExperimentStore.getState().ledger.claims).toHaveLength(1);
    expect(useExperimentStore.getState().ledger.claims[0].status).toBe('draft');
  });

  it('separates guardrail cards and makes their AND semantics explicit', async () => {
    render(<ClaimComposer study={STUDY} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '冻结主张' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '添加 AND 护栏（0/2）' }));

    expect(screen.getByText('AND 护栏 1')).toBeInTheDocument();
    expect(screen.getByText('主指标达标时仍必须满足的安全边界')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除此护栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加 AND 护栏（1/2）' })).toBeInTheDocument();
  });

  it('closes the unseal entrance while disk audit is degraded', () => {
    useExperimentStore.getState().registerClaim({
      id: 'claim-frozen', protocolVersion: 1, studyId: STUDY.id, attemptId: ATTEMPT.id,
      modelWeightsHash: 'sha256:weights', testDatasetHash: 'sha256:test', preprocessingHash: 'sha256:pre',
      status: 'frozen', revision: 1, predicates: [{
        id: 'primary', role: 'primary', metric: 'recall', operator: 'gte', threshold: 0.9,
        targetClass: '1', aggregation: 'binary', confidenceLevel: 0.95,
        intervalMethod: 'wilson', minimumEffectiveSampleSize: 10,
      }],
      frozenHash: 'sha256:frozen', frozenAt: 2, unsealSequence: null, adjudicatedAt: null,
      verdict: null, predicateResults: [], classificationDiagnostics: null,
      conclusionTrust: 'not_evaluated', createdAt: 1, updatedAt: 2,
    } satisfies EvaluationClaim);
    useExperimentStore.setState({ auditPersistence: 'degraded', auditError: 'sequence mismatch' });

    render(<ClaimComposer study={STUDY} />);

    expect(screen.getByRole('button', { name: '审计异常：修复后解封' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '修复并重新校验审计链' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('sequence mismatch');
  });

  /** 完整裁决链夹具：与协议层一致性测试同构（gold PASS）。 */
  function registerAdjudicatedGoldClaim() {
    const claim = {
      id: 'claim-gold', protocolVersion: 1 as const, studyId: STUDY.id, attemptId: ATTEMPT.id,
      modelWeightsHash: 'sha256:weights', testDatasetHash: 'sha256:test', preprocessingHash: 'sha256:pre',
      status: 'adjudicated' as const, revision: 1, predicates: [],
      frozenHash: 'sha256:frozen', frozenAt: 2, unsealSequence: 1, adjudicatedAt: 3,
      verdict: 'pass' as const, predicateResults: [], classificationDiagnostics: null,
      conclusionTrust: 'gold' as const, createdAt: 1, updatedAt: 3,
    } satisfies EvaluationClaim;
    useExperimentStore.getState().registerClaim(claim);
    const store = useExperimentStore.getState();
    store.appendEvent('claim', claim.id, 'claim_draft_created', {
      revision: 1, attemptId: ATTEMPT.id, modelWeightsHash: 'sha256:weights',
      testSetHash: 'sha256:test', preprocessingHash: 'sha256:pre', predicates: [],
    });
    store.appendEvent('claim', claim.id, 'claim_frozen', {
      frozenHash: 'sha256:frozen', revision: 1, attemptId: ATTEMPT.id,
      modelWeightsHash: 'sha256:weights', testSetHash: 'sha256:test', preprocessingHash: 'sha256:pre',
    });
    // 解封许可见证（模块 08 最终补丁）：可信档案必须含有序 claim_unsealed 事件
    store.appendEvent('claim', claim.id, 'claim_unsealed', {
      frozenHash: 'sha256:frozen', testSetHash: 'sha256:test', unsealSequence: 1,
    });
    store.appendEvent('claim', claim.id, 'claim_adjudicated', {
      frozenHash: 'sha256:frozen', unsealSequence: 1, verdict: 'pass',
      conclusionTrust: 'gold', predicateResults: [],
    });
    return claim;
  }

  it('健康审计 + 完整事件链：displayedTrust 消费统一投影显示金标', () => {
    registerAdjudicatedGoldClaim();
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
    render(<ClaimComposer study={STUDY} />);
    expect(screen.getByText('PASS')).toBeInTheDocument();
    expect(screen.getByText(/金标结论/)).toBeInTheDocument();
  });

  it('audit degraded：同一条完整 gold Claim 不得显示金标，并展示真实降级原因', () => {
    registerAdjudicatedGoldClaim();
    useExperimentStore.setState({ auditPersistence: 'degraded', auditError: 'disk failure' });
    render(<ClaimComposer study={STUDY} />);
    expect(screen.queryByText(/金标结论/)).not.toBeInTheDocument();
    expect(screen.getByText(/尚未形成结论信任/)).toBeInTheDocument();
    expect(screen.getByText(/降级原因：当前档案持久化状态无法背书/)).toBeInTheDocument();
  });

  it('存档信任字段异常：即使事件链完整也不显示金标，展示存档异常原因', () => {
    const claim = registerAdjudicatedGoldClaim();
    // 模拟持久化损坏：直接替换存档信任字段为未知值
    useExperimentStore.setState(state => ({
      ledger: {
        ...state.ledger,
        claims: state.ledger.claims.map(item => (
          item.id === claim.id
            ? { ...item, conclusionTrust: 'future_gold' as unknown as EvaluationClaim['conclusionTrust'] }
            : item
        )),
      },
    }));
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
    render(<ClaimComposer study={STUDY} />);
    expect(screen.queryByText(/金标结论/)).not.toBeInTheDocument();
    // 未知存档值同时导致实体审计链不完整（失败关闭），降级原因必须含存档异常
    expect(screen.getByText(/降级原因：/)).toHaveTextContent('存档结论信任字段异常');
  });
});
