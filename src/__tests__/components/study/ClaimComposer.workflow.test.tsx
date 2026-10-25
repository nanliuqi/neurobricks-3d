/**
 * Claim 工作流组件测试（模块 08）：
 * 审计闸门、候选绑定卡、冻结复核内容与确认篡改拒绝、双击单次执行、
 * 首次解封/重试语义、未知枚举失败关闭、post_hoc、混淆矩阵 key、非有限值、
 * 跨 Study 隔离、草稿漂移、role 结构校验、收起展开状态保持。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClaimComposer from '@/components/study/ClaimComposer';
import { useExperimentStore } from '@/stores/useExperimentStore';
import type { Attempt, EvaluationClaim, Experiment, Study } from '@/types/experiment';
import type { TrainMetric } from '@/types/training';

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
  metrics: [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, metricName: 'accuracy', metricValue: 0.8, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 1 }],
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

function frozenClaim(overrides: Partial<EvaluationClaim> = {}): EvaluationClaim {
  return {
    id: 'claim-frozen', protocolVersion: 1, studyId: STUDY.id, attemptId: ATTEMPT.id,
    modelWeightsHash: 'sha256:weights', testDatasetHash: 'sha256:test', preprocessingHash: 'sha256:pre',
    status: 'frozen', revision: 1, predicates: [],
    frozenHash: 'sha256:frozen', frozenAt: 2, unsealSequence: null, adjudicatedAt: null,
    verdict: null, predicateResults: [], classificationDiagnostics: null,
    conclusionTrust: 'not_evaluated', createdAt: 1, updatedAt: 2,
    ...overrides,
  } as EvaluationClaim;
}

/** 直接注入 claims（绕过 registerClaim 的引用校验，用于构造异常/跨 Study 夹具）。 */
function setClaims(claims: EvaluationClaim[]) {
  useExperimentStore.setState(state => ({ ledger: { ...state.ledger, claims } }));
}

describe('ClaimComposer 工作流（模块 08）', () => {
  beforeEach(() => {
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(EXPERIMENT);
    useExperimentStore.getState().registerAttempt(ATTEMPT);
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
  });

  afterEach(() => {
    act(() => useExperimentStore.getState().resetLedgerForTests());
  });

  it('unavailable：诚实显示档案持久化不可用，冻结与解封入口都不可执行', async () => {
    useExperimentStore.setState({ auditPersistence: 'unavailable' });
    setClaims([frozenClaim()]);
    render(<ClaimComposer study={STUDY} />);

    expect(await screen.findByText('档案持久化不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '冻结主张' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '档案不可用：修复后解封' })).toBeDisabled();
    // 不伪装健康：没有可执行的解封入口
    expect(screen.queryByRole('button', { name: '解封并裁决' })).not.toBeInTheDocument();
  });

  it('无候选：引导先完成候选选择，不显示可用冻结入口', async () => {
    useExperimentStore.setState(state => ({
      ledger: { ...state.ledger, studies: state.ledger.studies.map(item => ({ ...item, selectedAttemptId: null })) },
    }));
    render(<ClaimComposer study={{ ...STUDY, selectedAttemptId: null }} />);
    expect(await screen.findByText('尚无候选 Attempt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '冻结主张' })).toBeDisabled();
  });

  it('候选卡展示绑定身份与严格指标；严格元数据缺失时诚实降级但不阻止创建', async () => {
    render(<ClaimComposer study={STUDY} />);
    expect(await screen.findByText('当前候选绑定（只读）')).toBeInTheDocument();
    expect(screen.getByText(/严格验证指标：validation accuracy=80.0%（epoch 1）/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '冻结主张' })).toBeEnabled();

    // 旧档案形态：仅 accuracy 字段（无 metricValue/split/scope）→ 严格指标不可用，但不阻止创建
    act(() => {
      useExperimentStore.setState(state => ({
        ledger: {
          ...state.ledger,
          attempts: state.ledger.attempts.map(item => ({
            ...item,
            metrics: [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, timestamp: 1 } as TrainMetric],
          })),
        },
      }));
    });
    expect(await screen.findByText(/严格验证指标不可用/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '冻结主张' })).toBeEnabled();
  });

  it('冻结复核展示身份哈希与完整统计规格；确认期间篡改哈希则拒绝冻结', async () => {
    render(<ClaimComposer study={STUDY} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '冻结主张' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '冻结主张' }));

    const dialog = await screen.findByRole('alertdialog', { name: '确认冻结这条评估主张？' });
    expect(dialog).toHaveTextContent('草稿版本：v1');
    expect(dialog).toHaveTextContent('权重：');
    expect(dialog).toHaveTextContent('测试集：');
    expect(dialog).toHaveTextContent('预处理：');
    expect(dialog).toHaveTextContent('主指标');
    expect(dialog).toHaveTextContent('recall ≥ 0.95');
    expect(dialog).toHaveTextContent('置信度');
    expect(dialog).toHaveTextContent('区间方法');
    expect(dialog).toHaveTextContent('最小有效样本 n');
    expect(dialog).toHaveTextContent('统计预演警告');

    // 攻击：确认框打开期间同步篡改绑定 Attempt 的权重哈希
    await act(async () => {
      useExperimentStore.setState(state => ({
        ledger: {
          ...state.ledger,
          attempts: state.ledger.attempts.map(item => ({
            ...item,
            provenance: { ...item.provenance, modelWeightsHash: 'sha256:tampered' },
          })),
        },
      }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认冻结' }));
    });

    const claims = useExperimentStore.getState().ledger.claims;
    expect(claims).toHaveLength(1);
    expect(claims[0].status).toBe('draft'); // 拒绝冻结：仍是草稿
    expect(useExperimentStore.getState().ledger.events.some(event => event.eventType === 'claim_frozen')).toBe(false);
  });

  it('双击冻结确认只执行一次', async () => {
    render(<ClaimComposer study={STUDY} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '冻结主张' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '冻结主张' }));
    const confirmButton = await screen.findByRole('button', { name: '确认冻结' });
    await act(async () => {
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
    });
    await waitFor(() => {
      const claims = useExperimentStore.getState().ledger.claims;
      expect(claims.some(claim => claim.status === 'frozen')).toBe(true);
    });
    const freezeEvents = useExperimentStore.getState().ledger.events.filter(event => event.eventType === 'claim_frozen');
    expect(freezeEvents).toHaveLength(1);
  });

  it('首次解封确认展示完整身份与资格消耗文案；取消不访问封存集', async () => {
    setClaims([frozenClaim()]);
    render(<ClaimComposer study={STUDY} />);
    fireEvent.click(await screen.findByRole('button', { name: '解封并裁决' }));

    const dialog = await screen.findByRole('alertdialog', { name: '确认解封并裁决？' });
    expect(dialog).toHaveTextContent('claim-frozen');
    expect(dialog).toHaveTextContent('frozenHash');
    expect(dialog).toHaveTextContent('第 1 次（首次独立验证）');
    expect(dialog).toHaveTextContent('永久消耗这份测试集的一次独立验证资格');
    expect(dialog).toHaveTextContent('取消不会访问封存集');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(useExperimentStore.getState().ledger.events.some(event => event.eventType === 'claim_unsealed')).toBe(false);
  });

  it('有合法 claim_unsealed 事件：显示重试语义与原序号；仅快照 unsealSequence 无事件 → 档案冲突关闭', async () => {
    // 仅可变快照有 unsealSequence、无审计事件 → invalid（快照声称已解封但缺授权），不冒充首次/重试
    setClaims([frozenClaim({ unsealSequence: 1 })]);
    const { unmount } = render(<ClaimComposer study={STUDY} />);
    expect(await screen.findByRole('button', { name: '档案冲突：解封已关闭' })).toBeDisabled();
    expect(screen.getByText(/快照声称已解封/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解封并裁决' })).not.toBeInTheDocument();
    unmount();

    // 补上只追加事件 → 重试语义（事件权威，快照 null 也不误判）
    setClaims([frozenClaim()]);
    useExperimentStore.getState().appendEvent('claim', 'claim-frozen', 'claim_unsealed', {
      frozenHash: 'sha256:frozen', testSetHash: 'sha256:test', unsealSequence: 1,
    });
    render(<ClaimComposer study={STUDY} />);
    fireEvent.click(await screen.findByRole('button', { name: '继续既定裁决（不创建新主张）' }));
    const dialog = await screen.findByRole('alertdialog', { name: '继续既定裁决？' });
    expect(dialog).toHaveTextContent('原解封序号');
    expect(dialog).toHaveTextContent('不创建新主张、不分配新解封序号');
    // 快照缺失警示：以只追加事件为准
    expect(dialog).toHaveTextContent('档案不一致警告');
  });

  it('未知 verdict → 裁决记录异常；未知 status → 主张状态异常并关闭全部动作', async () => {
    setClaims([
      frozenClaim({ id: 'claim-bad-verdict', status: 'adjudicated', verdict: 'PASS_UPPER' as never, unsealSequence: 1, adjudicatedAt: 3 }),
      frozenClaim({ id: 'claim-bad-status', status: 'approved' as never }),
    ]);
    render(<ClaimComposer study={STUDY} />);
    expect(await screen.findByText('裁决记录异常')).toBeInTheDocument();
    expect(screen.getAllByText(/主张状态异常/).length).toBeGreaterThanOrEqual(1);
    // 原始未知字符串不展示给用户
    expect(screen.queryByText(/PASS_UPPER/)).not.toBeInTheDocument();
    expect(screen.queryByText(/approved/)).not.toBeInTheDocument();
    // 信任动作全部关闭
    expect(screen.queryByRole('button', { name: '解封并裁决' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /继续既定裁决/ })).not.toBeInTheDocument();
  });

  it('post_hoc：显示不具备独立验证资格，无冻结/解封入口，不显示金标', async () => {
    setClaims([frozenClaim({ status: 'post_hoc', conclusionTrust: 'gold' })]);
    render(<ClaimComposer study={STUDY} />);
    expect(await screen.findByText(/事后主张，不具备独立验证资格/)).toBeInTheDocument();
    expect(screen.queryByText(/金标结论/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解封并裁决' })).not.toBeInTheDocument();
  });

  it('INCONCLUSIVE 显示补数据行动建议；结果表非有限值渲染“不可用”', async () => {
    setClaims([frozenClaim({
      status: 'adjudicated', verdict: 'inconclusive', unsealSequence: 1, adjudicatedAt: 3,
      predicates: [{
        id: 'primary-0', role: 'primary', metric: 'recall', operator: 'gte', threshold: 0.95,
        targetClass: '1', aggregation: 'binary', confidenceLevel: 0.95, intervalMethod: 'wilson', minimumEffectiveSampleSize: 20,
      }],
      predicateResults: [{
        predicateId: 'primary-0', pointEstimate: Number.NaN, lowerBound: 0.4, upperBound: Number.POSITIVE_INFINITY,
        effectiveSampleSize: 100, confidenceLevel: 0.95, verdict: 'inconclusive',
      }],
      classificationDiagnostics: {
        classIndices: [0, 1],
        classLabels: ['相同名', '相同名'],
        entries: [{ actual: 0, predicted: 0, count: 5 }],
        perClassRecall: [{ classIndex: 0, label: '相同名', support: 10, recall: Number.NaN }],
      },
    })]);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<ClaimComposer study={STUDY} />);
      expect(await screen.findByText(/优先补充对应有效样本/)).toBeInTheDocument();
      expect(screen.getAllByText('不可用').length).toBeGreaterThan(0);
      expect(screen.queryByText('NaN')).not.toBeInTheDocument();
      // 彽章与结果表标题都展示总裁决（同一信息层级）
      expect(screen.getAllByText('INCONCLUSIVE').length).toBeGreaterThanOrEqual(1);
      // 相同类别名不产生 duplicate key warning（key 使用 classIndex）
      expect(errorSpy.mock.calls.filter(call => String(call[0]).includes('same key'))).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('跨 Study Claim 不进入当前列表', async () => {
    setClaims([
      frozenClaim({ id: 'claim-mine' }),
      frozenClaim({ id: 'claim-foreign', studyId: 'study-other', attemptId: 'attempt-foreign' }),
    ]);
    render(<ClaimComposer study={STUDY} />);
    // 记录卡展示绑定 Attempt 身份：当前 Study 的卡在（绑定卡+记录卡多处匹配），跨 Study 的卡不在
    expect((await screen.findAllByText(/attempt-ui/)).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/attempt-foreign/)).not.toBeInTheDocument();
  });

  it('候选变化后旧草稿标记漂移：禁止以新候选保存/冻结', async () => {
    setClaims([frozenClaim({ id: 'claim-old-draft', status: 'draft', attemptId: 'attempt-old', frozenHash: null, frozenAt: null })]);
    render(<ClaimComposer study={STUDY} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑草稿' }));

    expect(await screen.findByText('候选绑定已变化')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存新版本' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '冻结主张' })).toBeDisabled();
  });

  it('predicate 按 role 判定：primary 不在第一项也不被误标，primary 无删除按钮', async () => {
    setClaims([frozenClaim({
      id: 'claim-role-order', status: 'draft', frozenHash: null, frozenAt: null,
      predicates: [
        { id: 'guardrail-1', role: 'guardrail', metric: 'accuracy', operator: 'gte', threshold: 0.8, confidenceLevel: 0.95, intervalMethod: 'wilson', minimumEffectiveSampleSize: 20 },
        { id: 'primary-0', role: 'primary', metric: 'recall', operator: 'gte', threshold: 0.95, targetClass: '1', aggregation: 'binary', confidenceLevel: 0.95, intervalMethod: 'wilson', minimumEffectiveSampleSize: 20 },
      ],
    })]);
    render(<ClaimComposer study={STUDY} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑草稿' }));

    await waitFor(() => expect(screen.getByText('正在编辑主张草稿 v1')).toBeInTheDocument());
    const cards = document.querySelectorAll('[data-role]');
    // 第一张卡是 guardrail（数组顺序），第二张才是 primary —— role 判定不按 index
    expect(cards[0].getAttribute('data-role')).toBe('guardrail');
    expect(cards[1].getAttribute('data-role')).toBe('primary');
    expect(screen.getByText('AND 护栏 1')).toBeInTheDocument();
    // primary 卡内无删除按钮；guardrail 有
    expect(screen.getAllByRole('button', { name: '移除此护栏' })).toHaveLength(1);
  });

  it('重复 primary：显示结构错误并禁止保存/冻结', async () => {
    setClaims([frozenClaim({
      id: 'claim-two-primary', status: 'draft', frozenHash: null, frozenAt: null,
      predicates: [
        { id: 'primary-0', role: 'primary', metric: 'recall', operator: 'gte', threshold: 0.95, confidenceLevel: 0.95, intervalMethod: 'wilson', minimumEffectiveSampleSize: 20 },
        { id: 'primary-1', role: 'primary', metric: 'accuracy', operator: 'gte', threshold: 0.8, confidenceLevel: 0.95, intervalMethod: 'wilson', minimumEffectiveSampleSize: 20 },
      ],
    })]);
    render(<ClaimComposer study={STUDY} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑草稿' }));

    expect(await screen.findByText('子句结构错误')).toBeInTheDocument();
    expect(screen.getByText(/存在 2 个主指标/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存新版本' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '冻结主张' })).toBeDisabled();
  });

  it('右栏收起（CSS 隐藏）再展开：未提交表单状态保持', async () => {
    const { container } = render(<ClaimComposer study={STUDY} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '冻结主张' })).toBeEnabled());
    const thresholdInput = screen.getByLabelText('验收线') as HTMLInputElement;
    fireEvent.change(thresholdInput, { target: { value: '0.77' } });
    expect(thresholdInput.value).toBe('0.77');

    // 模拟右栏收起：仅 CSS 隐藏，子树保持挂载（MainLayout 的既定行为）
    const wrapper = document.createElement('div');
    wrapper.style.display = 'none';
    container.parentElement?.appendChild(wrapper);
    wrapper.appendChild(container);
    // 展开
    wrapper.style.display = '';

    expect((screen.getByLabelText('验收线') as HTMLInputElement).value).toBe('0.77');
  });

  it('Study 切换：表单与 pending 确认无残留', async () => {
    const { rerender } = render(<ClaimComposer study={STUDY} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '冻结主张' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '冻结主张' }));
    await screen.findByRole('alertdialog', { name: '确认冻结这条评估主张？' });

    const studyB: Study = { ...STUDY, id: 'study-b', name: '另一个课题', selectedAttemptId: null };
    await act(async () => {
      useExperimentStore.getState().registerStudy(studyB);
    });
    rerender(<ClaimComposer study={studyB} />);

    // pending 冻结确认被清除，且不会把 Study A 的草稿冻结进 Study B
    expect(screen.queryByRole('alertdialog', { name: '确认冻结这条评估主张？' })).not.toBeInTheDocument();
    expect(screen.getByText('尚无候选 Attempt')).toBeInTheDocument();
    expect(useExperimentStore.getState().ledger.events.some(event => event.eventType === 'claim_frozen')).toBe(false);
  });

  /* ---------- 模块 08 可信边界补丁：新增攻击测试 ---------- */

  it('冻结确认打开后更换候选 → 拒绝冻结，主张保持草稿，零冻结事件', async () => {
    render(<ClaimComposer study={STUDY} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '冻结主张' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '冻结主张' }));
    await screen.findByRole('alertdialog', { name: '确认冻结这条评估主张？' });

    // 攻击：确认框打开期间把 Study 候选改为另一个 Attempt
    await act(async () => {
      useExperimentStore.setState(state => ({
        ledger: {
          ...state.ledger,
          studies: state.ledger.studies.map(item => ({ ...item, selectedAttemptId: 'attempt-other' })),
        },
      }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认冻结' }));
    });

    const claims = useExperimentStore.getState().ledger.claims;
    expect(claims).toHaveLength(1);
    expect(claims[0].status).toBe('draft');
    expect(useExperimentStore.getState().ledger.events.some(event => event.eventType === 'claim_frozen')).toBe(false);
  });

  it('确认期间统计预演警告变化 → 拒绝冻结并要求重新复核', async () => {
    render(<ClaimComposer study={STUDY} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '冻结主张' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '冻结主张' }));
    const dialog = await screen.findByRole('alertdialog', { name: '确认冻结这条评估主张？' });
    expect(dialog).toHaveTextContent('统计预演警告');

    // 攻击：确认期间扩大测试规模使欠功率警告消失（哈希不变，仅警告变化）
    await act(async () => {
      useExperimentStore.setState(state => ({
        ledger: {
          ...state.ledger,
          attempts: state.ledger.attempts.map(item => ({
            ...item,
            provenance: { ...item.provenance, testSampleCount: 4000, testLabelCounts: { '0': 2000, '1': 2000 } },
          })),
        },
      }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认冻结' }));
    });

    const claims = useExperimentStore.getState().ledger.claims;
    expect(claims[0].status).toBe('draft');
    expect(useExperimentStore.getState().ledger.events.some(event => event.eventType === 'claim_frozen')).toBe(false);
  });

  it('候选资格与按钮权限同源：running/untrusted/缺哈希时保存与冻结都禁用；未知状态不泄露原始字符串', async () => {
    const cases: Array<[Partial<Attempt> | { provenance: Partial<Attempt['provenance']> }, string | null]> = [
      [{ status: 'running' as Attempt['status'] }, null],
      [{ provenance: { executionTrust: 'unverified' as const } }, null],
      [{ provenance: { modelWeightsHash: '' } }, null],
      [{ status: 'weird_status' as Attempt['status'] }, 'weird_status'],
    ];
    for (const [patch, leakedRaw] of cases) {
      const { unmount } = render(<ClaimComposer study={STUDY} />);
      await waitFor(() => expect(screen.getByText('当前候选绑定（只读）')).toBeInTheDocument());
      act(() => {
        useExperimentStore.setState(state => ({
          ledger: {
            ...state.ledger,
            attempts: state.ledger.attempts.map(item => ({
              ...item,
              ...patch,
              provenance: { ...item.provenance, ...((patch as { provenance?: Partial<Attempt['provenance']> }).provenance ?? {}) },
            })),
          },
        }));
      });
      // 卡片写“暂不可创建主张”时，保存/冻结按钮必须同样禁用（不允许权限漂移）
      await waitFor(() => expect(screen.getByText('暂不可创建主张')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '冻结主张' })).toBeDisabled();
      if (leakedRaw) {
        expect(screen.queryByText(new RegExp(leakedRaw))).not.toBeInTheDocument();
        expect(screen.getByText(/Attempt 状态异常/)).toBeInTheDocument();
      }
      unmount();
    }
  });

  it('冻结身份漂移（权重/预处理哈希不一致、modelId 缺失）：解封关闭并说明原因', async () => {
    // 权重哈希漂移
    setClaims([frozenClaim({ modelWeightsHash: 'sha256:drifted' })]);
    const first = render(<ClaimComposer study={STUDY} />);
    expect(await screen.findByRole('button', { name: '身份漂移：解封已关闭' })).toBeDisabled();
    expect(screen.getByText(/冻结权重哈希与当前 Attempt 不一致/)).toBeInTheDocument();
    first.unmount();

    // 预处理哈希漂移
    setClaims([frozenClaim({ preprocessingHash: 'sha256:drifted-pre' })]);
    const second = render(<ClaimComposer study={STUDY} />);
    expect(await screen.findByRole('button', { name: '身份漂移：解封已关闭' })).toBeDisabled();
    expect(screen.getByText(/冻结预处理哈希与当前 Attempt 不一致/)).toBeInTheDocument();
    second.unmount();

    // modelId 缺失
    setClaims([frozenClaim()]);
    act(() => {
      useExperimentStore.setState(state => ({
        ledger: { ...state.ledger, attempts: state.ledger.attempts.map(item => ({ ...item, modelId: '' })) },
      }));
    });
    const third = render(<ClaimComposer study={STUDY} />);
    expect(await screen.findByRole('button', { name: '身份漂移：解封已关闭' })).toBeDisabled();
    expect(screen.getByText(/modelId/)).toBeInTheDocument();
    third.unmount();
  });

  it('同一 Claim 多个解封序号（档案冲突）：解封关闭，不提供确认入口', async () => {
    setClaims([frozenClaim()]);
    useExperimentStore.getState().appendEvent('claim', 'claim-frozen', 'claim_unsealed', {
      frozenHash: 'sha256:frozen', testSetHash: 'sha256:test', unsealSequence: 1,
    });
    useExperimentStore.getState().appendEvent('claim', 'claim-frozen', 'claim_unsealed', {
      frozenHash: 'sha256:frozen', testSetHash: 'sha256:test', unsealSequence: 2,
    });
    render(<ClaimComposer study={STUDY} />);
    expect(await screen.findByRole('button', { name: '档案冲突：解封已关闭' })).toBeDisabled();
    expect(screen.getByText(/多个不同解封序号/)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('同测试集已被其他 Claim 解封：subsequent 确认框展示真实第 2 次，不含“首次独立验证”', async () => {
    setClaims([frozenClaim()]);
    // 另一条 Claim 已对同一测试集完成首次解封
    useExperimentStore.getState().appendEvent('claim', 'claim-other', 'claim_unsealed', {
      frozenHash: 'sha256:frozen-other', testSetHash: 'sha256:test', unsealSequence: 1,
    });
    render(<ClaimComposer study={STUDY} />);
    fireEvent.click(await screen.findByRole('button', { name: '解封并裁决' }));

    const dialog = await screen.findByRole('alertdialog', { name: '确认解封并裁决？' });
    expect(dialog).toHaveTextContent('第 2 次（事后验证，不具首次独立验证资格）');
    expect(dialog).toHaveTextContent('该测试集此前已被解封');
    expect(dialog).toHaveTextContent('不会恢复金标资格');
    expect(dialog.textContent).not.toContain('首次独立验证）');
    // 冻结身份与当前 Attempt 身份分区展示
    expect(dialog).toHaveTextContent('冻结 Claim 身份（冻结时刻的值）');
    expect(dialog).toHaveTextContent('当前 Attempt 身份');
  });

  it('渲染失败关闭：重复结果 ID/重复 classIndices 无 duplicate key，未知角色不冒充护栏，非法计数不可用', async () => {
    setClaims([frozenClaim({
      id: 'claim-render', status: 'adjudicated', verdict: 'fail', unsealSequence: 1, adjudicatedAt: 3,
      predicates: [
        { id: 'primary-0', role: 'primary', metric: 'recall', operator: 'gte', threshold: 0.95, confidenceLevel: 0.95, intervalMethod: 'wilson', minimumEffectiveSampleSize: 20 },
        { id: 'weird-0', role: 'secondary' as never, metric: 'accuracy', operator: 'gte', threshold: 0.5, confidenceLevel: 0.95, intervalMethod: 'wilson', minimumEffectiveSampleSize: 10 },
      ],
      predicateResults: [
        { predicateId: 'primary-0', pointEstimate: 0.6, lowerBound: 0.4, upperBound: 0.75, effectiveSampleSize: 100, confidenceLevel: 0.95, verdict: 'fail' },
        { predicateId: 'primary-0', pointEstimate: 0.61, lowerBound: 0.41, upperBound: 0.76, effectiveSampleSize: 100, confidenceLevel: 0.95, verdict: 'fail' },
        { predicateId: 'weird-0', pointEstimate: 0.5, lowerBound: 0.4, upperBound: 0.6, effectiveSampleSize: 100, confidenceLevel: 0.95, verdict: 'pass' },
      ],
      classificationDiagnostics: {
        classIndices: [0, 0],
        classLabels: ['重复名'],
        entries: [{ actual: 0, predicted: 0, count: -5 }, { actual: 0, predicted: 1, count: 1.5 }],
        perClassRecall: [{ classIndex: 0, label: '重复名', support: -1, recall: 0.5 }],
      },
    })]);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<ClaimComposer study={STUDY} />);
      // 重复 predicateId → 结果记录异常提示，不静默覆盖
      expect(await screen.findByText(/结果记录异常：predicateResults 出现重复 predicateId/)).toBeInTheDocument();
      // 未知角色 → 角色异常，不冒充护栏
      expect(screen.getAllByText('角色异常').length).toBeGreaterThanOrEqual(1);
      // 非法计数（负数/小数）→ 不可用，不输出原始非法值
      expect(screen.getAllByText('不可用').length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText('-5')).not.toBeInTheDocument();
      expect(screen.queryByText('1.5')).not.toBeInTheDocument();
      // 标签与索引长度不一致 → 诚实降级声明
      expect(screen.getByText(/类别标签与索引长度不一致/)).toBeInTheDocument();
      // 重复结果 ID 与重复 classIndices 都不产生 duplicate key warning
      expect(errorSpy.mock.calls.filter(call => String(call[0]).includes('same key'))).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('trustReason 与统一投影一致：投影降级时不声称满足金标条件', async () => {
    // 结构条件全满足（unseal=1、trusted、machine_verified、机器检查通过）但无完整审计事件链 → 投影降级
    setClaims([frozenClaim({
      status: 'adjudicated', verdict: 'pass', unsealSequence: 1, adjudicatedAt: 3, conclusionTrust: 'gold',
    })]);
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
    render(<ClaimComposer study={STUDY} />);
    // 存档 gold 但审计链不完整 → 投影降级，不得显示金标，也不得声称满足金标条件
    await waitFor(() => expect(screen.queryByText(/金标结论/)).not.toBeInTheDocument());
    expect(screen.getByText(/不声称满足金标条件/)).toBeInTheDocument();
    expect(screen.queryByText(/均满足金标条件/)).not.toBeInTheDocument();
    expect(screen.getByText(/降级原因：/)).toBeInTheDocument();
  });
});
