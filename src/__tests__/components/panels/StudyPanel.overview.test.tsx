/**
 * StudyPanel 总览组件测试（模块 06）：
 * 快速探索、无效活动 Study 回退、切换即时更新、创建防重入与草稿保留、
 * 归档语义、审计状态、候选锁定展示。
 * 断言真实行为与真实 store 写入，不只检查类名。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import StudyPanel from '@/components/panels/StudyPanel';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { TRUST_PROTOCOL_VERSION, type Attempt, type EvaluationClaim, type Experiment, type Study } from '@/types/experiment';
import type { TrainConfig } from '@/types/training';

const LAYERS: TrainConfig['layers'] = [
  { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
  { type: 'Flatten', params: {} },
  { type: 'Linear', params: { inFeatures: 784, outFeatures: 10 } },
];

function makeStudy(overrides: Partial<Study> = {}): Study {
  return {
    id: 'study-a',
    protocolVersion: TRUST_PROTOCOL_VERSION,
    name: '课题 A',
    kind: 'candidate_selection',
    status: 'draft',
    question: '问题 A',
    datasetContract: {
      identity: {
        id: 'ds-1', name: 'MNIST', taskType: 'image_classification',
        contentHash: 'hash-a', fingerprintAlgorithm: 'sha256-v1', sampleCount: 100, importedAt: 1,
      },
      split: {
        strategy: 'random', seed: 42, validationRatio: 0.2, testRatio: 0.2,
        sampleUnit: 'image', independence: 'machine_verified', machineChecks: [], splitHash: 'split-a',
      },
      preprocessing: { configHash: 'prep-a', summary: 'dataset=mnist' },
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

function makeExperiment(id: string, studyId: string, name: string): Experiment {
  return {
    id,
    protocolVersion: TRUST_PROTOCOL_VERSION,
    studyId,
    name,
    config: { seed: 42 } as Experiment['config'],
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
      datasetContentHash: null, splitHash: null, testSetHash: null, machineChecks: [],
      testSampleCount: null, testLabelCounts: null, testTargetSummary: null,
      preprocessingHash: null, configHash: 'hash', modelWeightsHash: null, witnessedByPipeline: false,
    },
    metrics: [],
    artifacts: null,
    executionMode: 'native',
    ...overrides,
  };
}

function setLedger(
  studies: Study[],
  data: { experiments?: Experiment[]; attempts?: Attempt[]; claims?: EvaluationClaim[] } = {},
  activeStudyId: string | null = null,
) {
  useExperimentStore.setState({
    ledger: {
      protocolVersion: TRUST_PROTOCOL_VERSION,
      ledgerId: 'ledger-test',
      studies,
      experiments: data.experiments ?? [],
      attempts: data.attempts ?? [],
      claims: data.claims ?? [],
      events: [],
    },
    activeStudyId,
    auditPersistence: 'unavailable',
    auditError: null,
  });
}

describe('StudyPanel 总览', () => {
  beforeEach(() => {
    localStorage.clear();
    useExperimentStore.getState().resetLedgerForTests();
    useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
  });

  it('无活动 Study 时显示快速探索状态', () => {
    setLedger([], {}, null);
    render(<StudyPanel />);
    expect(screen.getByText(/当前为快速路径/)).toBeInTheDocument();
    // 切换器占位项也含“自动草稿课题”文案，这里只要求至少出现。
    expect(screen.getAllByText(/草稿课题/).length).toBeGreaterThanOrEqual(1);
  });

  it('activeStudyId 无效时安全回退（不白屏、不读取其他 Study，选择器 value 回到快速路径）', () => {
    setLedger([makeStudy()], { experiments: [makeExperiment('exp-a', 'study-a', 'A 的实验')] }, 'missing-id');
    render(<StudyPanel />);
    expect(screen.getByText(/当前为快速路径/)).toBeInTheDocument();
    // DOM 断言：选择器真实 value 必须是快速路径空值，不残留无效 ID
    expect((screen.getByLabelText('活动 Study') as HTMLSelectElement).value).toBe('');
    // 不得把其他 Study 的证据拿来顶替显示
    expect(screen.queryByText('A 的实验')).not.toBeInTheDocument();
  });

  it('已归档的 activeStudyId 同样回退到快速路径', () => {
    setLedger([makeStudy({ archivedAt: 5 })], {}, 'study-a');
    render(<StudyPanel />);
    expect((screen.getByLabelText('活动 Study') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText(/当前为快速路径/)).toBeInTheDocument();
  });

  it('裁决记录存在但无完整审计链时，面板显示“审计链不完整”而非结论可信', () => {
    const claim: EvaluationClaim = {
      id: 'claim-broken',
      protocolVersion: TRUST_PROTOCOL_VERSION,
      studyId: 'study-a',
      attemptId: 'att-missing',
      modelWeightsHash: 'w',
      testDatasetHash: 't',
      preprocessingHash: 'p',
      status: 'adjudicated',
      revision: 1,
      predicates: [],
      frozenHash: 'f',
      frozenAt: 1,
      unsealSequence: 1,
      adjudicatedAt: 2,
      verdict: 'pass',
      predicateResults: [],
      classificationDiagnostics: null,
      conclusionTrust: 'gold',
      createdAt: 1,
      updatedAt: 1,
    };
    setLedger([makeStudy()], { claims: [claim] }, 'study-a');
    render(<StudyPanel />);
    // 存档 gold + 裁决存在，但无审计事件链且 Attempt 缺失 → 不得显示金标/结论可信
    expect(screen.getByText(/结论记录异常，不能授予可信等级/)).toBeInTheDocument();
    expect(screen.queryByText(/金标裁决/)).not.toBeInTheDocument();
    expect(screen.queryByText(/存在独立测试裁决/)).not.toBeInTheDocument();
    // 逐条 Claim 明细可见（不隐藏异常记录）；计数行与明细行均含“记录异常”，用 getAllByText。
    expect(screen.getAllByText(/记录异常/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/PASS · 记录异常/)).toBeInTheDocument();
  });

  it('切换 Study 后总览立即更新（证据作用域随身份切换）', () => {
    setLedger(
      [makeStudy(), makeStudy({ id: 'study-b', name: '课题 B', question: '问题 B', comparisonKey: 'key-b' })],
      {
        experiments: [
          makeExperiment('exp-a', 'study-a', 'A 的实验'),
          makeExperiment('exp-b', 'study-b', 'B 的实验'),
        ],
      },
      'study-a',
    );
    render(<StudyPanel />);
    expect(screen.getByText('课题 A')).toBeInTheDocument();
    expect(screen.getByText('A 的实验')).toBeInTheDocument();
    expect(screen.queryByText('B 的实验')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('活动 Study'), { target: { value: 'study-b' } });
    expect(screen.getByText('课题 B')).toBeInTheDocument();
    expect(screen.getByText('B 的实验')).toBeInTheDocument();
    expect(screen.queryByText('A 的实验')).not.toBeInTheDocument();
  });

  it('归档按钮使用“归档”语义；确认后证据仍保留在 ledger', () => {
    setLedger([makeStudy()], { experiments: [makeExperiment('exp-a', 'study-a', 'A 的实验')] }, 'study-a');
    render(<StudyPanel />);
    expect(screen.queryByRole('button', { name: /删除课题/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '归档课题' }));
    const dialog = screen.getByRole('alertdialog', { name: '归档这个课题？' });
    expect(dialog.textContent).toContain('均保留');
    expect(dialog.textContent).not.toContain('物理抹除');
    fireEvent.click(screen.getByRole('button', { name: '确认归档' }));

    const state = useExperimentStore.getState();
    expect(state.ledger.studies[0].archivedAt).not.toBeNull();
    expect(state.ledger.experiments).toHaveLength(1);
    expect(state.activeStudyId).toBeNull();
  });

  it('存在运行中 Attempt 时归档被 runtime 拒绝，界面保留', () => {
    setLedger(
      [makeStudy()],
      {
        experiments: [makeExperiment('exp-a', 'study-a', 'A 的实验')],
        attempts: [makeAttempt({ id: 'att-run', experimentId: 'exp-a', status: 'running', endedAt: null })],
      },
      'study-a',
    );
    render(<StudyPanel />);
    fireEvent.click(screen.getByRole('button', { name: '归档课题' }));
    fireEvent.click(screen.getByRole('button', { name: '确认归档' }));

    const state = useExperimentStore.getState();
    expect(state.ledger.studies[0].archivedAt ?? null).toBeNull();
    expect(state.activeStudyId).toBe('study-a');
  });

  it('审计降级显示告警，不得显示为健康', () => {
    setLedger([makeStudy()], {}, 'study-a');
    useExperimentStore.setState({ auditPersistence: 'degraded', auditError: '磁盘写入失败' });
    render(<StudyPanel />);
    expect(screen.getByText(/磁盘审计写入失败/)).toBeInTheDocument();
    expect(screen.getAllByText(/磁盘写入失败/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/审计状态：降级/)).toBeInTheDocument();
  });

  it('候选选择被 runtime 拒绝时保留界面状态并允许重试（不丢候选、不锁死）', () => {
    const attempt = makeAttempt({ id: 'att-cand', experimentId: 'exp-a', status: 'completed' });
    setLedger(
      [makeStudy()],
      { experiments: [makeExperiment('exp-a', 'study-a', 'A 的实验')], attempts: [attempt] },
      'study-a',
    );
    render(<StudyPanel />);

    fireEvent.click(screen.getByRole('button', { name: /选择方案 1/ }));
    expect(screen.getByRole('alertdialog', { name: '确认选择这个候选？' })).toBeInTheDocument();

    // 确认前突然出现主张：runtime 将拒绝候选变更。
    act(() => {
      useExperimentStore.getState().registerClaim({
        id: 'claim-block',
        protocolVersion: TRUST_PROTOCOL_VERSION,
        studyId: 'study-a',
        attemptId: 'att-cand',
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
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
    // 拒绝：真实原因可见，候选未被写入，弹窗保留可重试。
    expect(useExperimentStore.getState().ledger.studies[0].selectedAttemptId ?? null).toBeNull();
    expect(screen.getByRole('alertdialog', { name: '确认选择这个候选？' })).toBeInTheDocument();
  });

  it('已有 Claim 时展示候选锁定原因', () => {
    const claim: EvaluationClaim = {
      id: 'claim-1',
      protocolVersion: TRUST_PROTOCOL_VERSION,
      studyId: 'study-a',
      attemptId: 'att-1',
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
    };
    setLedger(
      [makeStudy({ lockedAt: 2 })],
      { claims: [claim] },
      'study-a',
    );
    render(<StudyPanel />);
    expect(screen.getByText(/已有主张，候选已锁定/)).toBeInTheDocument();
    expect(screen.getByText(/首个运行已经开始/)).toBeInTheDocument();
  });
});

describe('StudyPanel 创建表单', () => {
  beforeEach(() => {
    localStorage.clear();
    useExperimentStore.getState().resetLedgerForTests();
    useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
    useLayerStore.setState({
      ...useLayerStore.getInitialState(),
      layers: LAYERS.map((layer, order) => ({
        id: `layer-${order}`,
        type: layer.type,
        params: layer.params,
        order,
        position: [0, 0, 0],
        outputShape: null,
        paramCount: 0,
        validationError: null,
      })),
    });
  });

  function openCreateForm() {
    fireEvent.click(screen.getByRole('button', { name: '新建课题' }));
  }

  it('三种 Study 类型的结论边界解释正确，且表单均有可见 label', () => {
    setLedger([], {}, null);
    render(<StudyPanel />);
    openCreateForm();
    expect(screen.getByLabelText('课题名称')).toBeInTheDocument();
    expect(screen.getByLabelText('要回答的问题')).toBeInTheDocument();
    expect(screen.getByLabelText('课题类型')).toBeInTheDocument();
    expect(screen.getByLabelText('最大实验数')).toBeInTheDocument();
    expect(screen.getByLabelText(/GPU 时间预算/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('课题类型'), { target: { value: 'free_exploration' } });
    expect(screen.getByText(/不能产生正式排序或因果归因/)).toBeInTheDocument();
    // 自由探索不显示选择规则
    expect(screen.queryByLabelText('候选选择规则')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('课题类型'), { target: { value: 'candidate_selection' } });
    expect(screen.getByText(/哪个候选被选中/)).toBeInTheDocument();
    expect(screen.getByLabelText('候选选择规则')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('课题类型'), { target: { value: 'controlled_ablation' } });
    expect(screen.getByText(/配对 seed/)).toBeInTheDocument();
  });

  it('没有数据集时显示诚实提示，创建由 runtime 拒绝且草稿保留', async () => {
    setLedger([], {}, null);
    render(<StudyPanel />);
    openCreateForm();
    expect(screen.getByText(/尚未选择数据集/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('课题名称'), { target: { value: '草稿课题' } });
    fireEvent.change(screen.getByLabelText('要回答的问题'), { target: { value: '草稿问题' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '建立并激活' }));
      await Promise.resolve();
    });

    // 创建失败：真实错误可见，草稿保留，表单不关闭
    expect(screen.getByText(/请先选择数据集/)).toBeInTheDocument();
    expect((screen.getByLabelText('课题名称') as HTMLInputElement).value).toBe('草稿课题');
    expect(useExperimentStore.getState().ledger.studies).toHaveLength(0);
  });

  it('快速双击创建按钮只创建一个 Study', async () => {
    useDatasetStore.setState({
      ...useDatasetStore.getInitialState(),
      datasetType: 'mnist',
      datasetInfo: {
        datasetId: 'builtin-mnist-torchvision-v1',
        name: 'MNIST',
        type: 'mnist',
        contentHash: 'builtin:mnist:torchvision-v1',
        importedAt: 1,
        sampleUnit: 'image',
        sampleIndependence: 'machine_verified',
        sampleCount: 70_000,
        classCount: 10,
      },
    });
    setLedger([], {}, null);
    render(<StudyPanel />);
    openCreateForm();
    fireEvent.change(screen.getByLabelText('课题名称'), { target: { value: '防重入课题' } });
    fireEvent.change(screen.getByLabelText('要回答的问题'), { target: { value: '双击会创建几个？' } });

    const submit = screen.getByRole('button', { name: /建立并激活/ });
    await act(async () => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(useExperimentStore.getState().ledger.studies).toHaveLength(1);
    });
    expect(useExperimentStore.getState().activeStudyId).toBe(useExperimentStore.getState().ledger.studies[0].id);
  });

  it('创建成功后才清空草稿并关闭表单', async () => {
    useDatasetStore.setState({
      ...useDatasetStore.getInitialState(),
      datasetType: 'mnist',
      datasetInfo: {
        datasetId: 'builtin-mnist-torchvision-v1',
        name: 'MNIST',
        type: 'mnist',
        contentHash: 'builtin:mnist:torchvision-v1',
        importedAt: 1,
        sampleCount: 70_000,
        classCount: 10,
      },
    });
    setLedger([], {}, null);
    render(<StudyPanel />);
    openCreateForm();
    fireEvent.change(screen.getByLabelText('课题名称'), { target: { value: '成功课题' } });
    fireEvent.change(screen.getByLabelText('要回答的问题'), { target: { value: '问题' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /建立并激活/ }));
    });

    await waitFor(() => {
      expect(useExperimentStore.getState().ledger.studies).toHaveLength(1);
    });
    // 表单关闭；再次打开时草稿已被清空
    expect(screen.queryByLabelText('课题名称')).not.toBeInTheDocument();
    openCreateForm();
    expect((screen.getByLabelText('课题名称') as HTMLInputElement).value).toBe('');
  });
});
