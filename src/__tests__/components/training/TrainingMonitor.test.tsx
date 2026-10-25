import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TRUST_PROTOCOL_VERSION, type Attempt, type ExperimentLedgerV1, type Study } from '@/types/experiment';
import type { TrainMetric, TrainRecord } from '@/types/training';
import { RESULT_READING_TOPICS, TRAIN_RESULT_READING_TOPIC_IDS } from '@/content/resultInterpretation';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import LossChart from '@/components/training/LossChart';
import TrainMonitor from '@/components/training/TrainMonitor';
import TrainProgress from '@/components/training/TrainProgress';
import TrainResultModal from '@/components/training/TrainResultModal';
import TrainingMetricChart from '@/components/training/TrainingMetricChart';

const initialTrainingState = useTrainingStore.getState();

function metric(overrides: Partial<TrainMetric> = {}): TrainMetric {
  return {
    epoch: 1,
    step: 1,
    globalStep: 1,
    split: 'validation',
    scope: 'epoch',
    loss: 0.5,
    lossValue: 0.5,
    accuracy: 0.8,
    metricName: 'accuracy',
    metricValue: 0.8,
    optimizationDirection: 'maximize',
    timestamp: 1,
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'attempt-a',
    protocolVersion: TRUST_PROTOCOL_VERSION,
    experimentId: 'experiment-a',
    runId: 'run-a',
    modelId: 'model-a',
    config: { epochs: 2, learningRate: 0.001, batchSize: 8, dataset: 'demo', device: 'cpu', layers: [] },
    ordinal: 1,
    parentAttemptId: null,
    restartCount: 0,
    resumeType: 'fresh',
    status: 'completed',
    startedAt: 100,
    endedAt: 2100,
    provenance: {
      source: 'controlled', executionTrust: 'trusted',
      environment: { applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cpu', cudaVersion: null },
      datasetContentHash: 'data', splitHash: 'split', testSetHash: null, machineChecks: [], testSampleCount: null,
      testLabelCounts: null, testTargetSummary: null, preprocessingHash: 'prep', preprocessingParameters: {},
      configHash: 'config', modelWeightsHash: 'weights', witnessedByPipeline: true,
    },
    metrics: [
      metric({ epoch: 1, split: 'train', scope: 'batch', metricValue: 0.99 }),
      metric({ epoch: 1, metricValue: 0.8 }),
      metric({ epoch: 2, globalStep: 2, step: 2, metricValue: 0.82, loss: 0.4, lossValue: 0.4, timestamp: 2 }),
    ],
    artifacts: { weights: true, fullModel: true, numpy: true, perModel: true },
    executionMode: 'native',
    ...overrides,
  };
}

function makeStudy(): Study {
  return {
    id: 'study-a', protocolVersion: TRUST_PROTOCOL_VERSION, name: 'Study A', kind: 'candidate_selection', status: 'active', question: '选择候选',
    datasetContract: {
      identity: { id: 'data', name: 'data', taskType: 'image_classification', contentHash: 'data', fingerprintAlgorithm: 'sha256-v1', sampleCount: 10, importedAt: 1 },
      split: { strategy: 'random', seed: 42, validationRatio: 0.2, testRatio: 0, sampleUnit: '图片', independence: 'iid_assumed', machineChecks: [], splitHash: 'split' },
      preprocessing: { configHash: 'prep', summary: 'resize' },
    },
    comparisonKey: 'key', selectionRule: null, budget: { maxExperiments: null, maxGpuMinutes: null }, createdAt: 1, updatedAt: 1, lockedAt: 1,
  };
}

function ledgerWithAttempt(attempt = makeAttempt()): ExperimentLedgerV1 {
  return {
    protocolVersion: TRUST_PROTOCOL_VERSION,
    ledgerId: 'ledger',
    studies: [makeStudy()],
    experiments: [{ id: 'experiment-a', protocolVersion: TRUST_PROTOCOL_VERSION, studyId: 'study-a', name: '方案 A', config: attempt.config, configHash: 'config', createdAt: 1 }],
    attempts: [attempt], claims: [], events: [],
  };
}

beforeEach(() => {
  useTrainingStore.setState(initialTrainingState, true);
  useExperimentStore.getState().resetLedgerForTests();
});

describe('TrainingMetricChart', () => {
  it('展示分离后的训练/验证图例，不把 train 指标冒充 validation', () => {
    render(<TrainingMetricChart metrics={makeAttempt().metrics} evidenceLabel="严格证据" />);
    expect(screen.getByText(/训练批次 Accuracy/)).toBeInTheDocument();
    expect(screen.getByText(/验证轮次 Accuracy/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /严格证据/ })).toBeInTheDocument();
  });

  it('指标名缺失时仍可画 Loss，但不会猜 Accuracy 主指标', () => {
    render(<TrainingMetricChart metrics={[metric({ metricName: undefined })]} evidenceLabel="诊断" />);
    expect(screen.getByText(/验证轮次 Loss/)).toBeInTheDocument();
    expect(screen.getByText(/未猜测为 Accuracy/)).toBeInTheDocument();
    expect(screen.queryByText(/验证轮次 Accuracy/)).not.toBeInTheDocument();
  });
});

describe('TrainProgress', () => {
  it('MAE 使用原始数值并标明这是运行过程', () => {
    useTrainingStore.setState({
      isTraining: true, status: 'training', currentEpoch: 1, totalEpochs: 2, currentLoss: 0.5,
      trainStartTime: Date.now(), executionMode: 'native',
      metrics: [metric({ metricName: 'mae', metricValue: 0.2, accuracy: 0.2, optimizationDirection: 'minimize', split: 'train', scope: 'batch' })],
    });
    render(<TrainProgress />);
    expect(screen.getByText(/MAE：0.200000/)).toBeInTheDocument();
    expect(screen.queryByText(/20.0%/)).not.toBeInTheDocument();
  });
});

describe('TrainMonitor', () => {
  it('无活动 Study 时不展示全局历史为当前证据', () => {
    useExperimentStore.setState({ ledger: ledgerWithAttempt(), activeStudyId: null });
    render(<TrainMonitor />);
    expect(screen.getByText('尚未选择活动 Study')).toBeInTheDocument();
    expect(screen.queryByText(/方案 A · Attempt/)).not.toBeInTheDocument();
  });

  it('训练前错误在训练监控中显示完整原因', () => {
    useTrainingStore.setState({ status: 'error', errorKind: 'preflight', error: 'CSV 目标列尚未确认' });
    render(<TrainMonitor />);
    expect(screen.getByText('训练前检查未通过')).toBeInTheDocument();
    expect(screen.getByText('CSV 目标列尚未确认')).toBeInTheDocument();
  });

  it('只列出活动 Study 的 Attempt 与其严格最终指标', () => {
    useExperimentStore.setState({ ledger: ledgerWithAttempt(), activeStudyId: 'study-a' });
    render(<TrainMonitor />);
    expect(screen.getByText(/方案 A · Attempt 1/)).toBeInTheDocument();
    expect(screen.getByText(/accuracy：82.0%/)).toBeInTheDocument();
  });
});

describe('TrainResultModal', () => {
  it('按 lastAttemptId 使用严格 validation/epoch，而不是 99% 的 train/batch 或 done 值', async () => {
    const attempt = makeAttempt();
    useExperimentStore.setState({ ledger: ledgerWithAttempt(attempt), activeStudyId: 'study-a' });
    useTrainingStore.setState({
      status: 'done', lastAttemptId: attempt.id, finalAccuracy: 0.99, finalMetricName: 'accuracy',
      metrics: attempt.metrics, totalEpochs: 2, executionMode: 'native',
      history: [{
        id: 'record-a', attemptId: attempt.id, timestamp: 3, networkSummary: 'Linear', totalParams: 10,
        finalAccuracy: 0.99, finalMetricName: 'accuracy', finalLoss: 0.1, epochs: 2, duration: 2000,
        dataset: 'demo', metrics: attempt.metrics, executionMode: 'native', artifacts: attempt.artifacts ?? undefined,
      }],
    });
    render(<TrainResultModal />);
    expect(await screen.findByText('82.0%')).toBeInTheDocument();
    expect(screen.queryByText('99.0%')).not.toBeInTheDocument();
    expect(screen.getByText(/Epoch 2（Accuracy 82.0%）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(screen.queryByTestId('train-result-card')).not.toBeInTheDocument());
    expect(useExperimentStore.getState().ledger.attempts.some(item => item.id === attempt.id)).toBe(true);
  });

  it('找不到持久化 Attempt 时不授予可信背书', async () => {
    useTrainingStore.setState({ status: 'done', lastAttemptId: 'missing', finalAccuracy: 0.8, finalMetricName: 'accuracy', executionMode: 'native' });
    render(<TrainResultModal />);
    expect(await screen.findByText('Attempt 档案未匹配')).toBeInTheDocument();
    expect(screen.getByText(/不能授予可信背书/)).toBeInTheDocument();
  });
});

/**
 * R1：训练曲线下方的「如何读图」只是按需查看的静态文案入口。
 * 它接在真实组件里，展开/收起不得改变数据、曲线几何、图例与证据标签，也不得产生任何业务副作用。
 */
describe('训练图「如何读图」接线', () => {
  function chartRoot(): HTMLElement {
    const chart = screen.getByTestId('training-chart');
    const guide = chart.querySelector('[data-testid="result-reading-guide"]');
    if (!guide) throw new Error('读图说明必须接在训练图组件内');
    return chart;
  }

  function guideToggle(root: HTMLElement): HTMLElement {
    const toggle = root.querySelector<HTMLElement>('[data-testid="result-reading-guide-toggle"]');
    if (!toggle) throw new Error('读图触发器必须渲染');
    return toggle;
  }

  function geometrySnapshot(root: HTMLElement) {
    return {
      svg: root.querySelector('svg')?.outerHTML ?? null,
      meta: root.querySelector('.training-chart__meta')?.textContent ?? null,
      legend: root.querySelector('.training-chart__legend')?.textContent ?? null,
      warnings: root.querySelector('.training-chart__warnings')?.textContent ?? null,
      polylines: Array.from(root.querySelectorAll('polyline')).map(el => el.getAttribute('points')),
      circles: Array.from(root.querySelectorAll('circle')).map(el => (
        [el.getAttribute('cx'), el.getAttribute('cy'), el.getAttribute('r')].join('|')
      )),
      axisLabels: Array.from(root.querySelectorAll('text')).map(el => el.textContent),
    };
  }

  function trainingDataSnapshot() {
    return structuredClone(Object.fromEntries(
      Object.entries(useTrainingStore.getState()).filter(([, value]) => typeof value !== 'function'),
    ));
  }

  function localStorageSnapshot(): Record<string, string> {
    const entries: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key !== null) entries[key] = window.localStorage.getItem(key) ?? '';
    }
    return entries;
  }

  function installBackendProbes() {
    const invoke = vi.fn(() => {
      throw new Error('读图说明不得调用 Tauri 后端');
    });
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() => {
      throw new Error('读图说明不得发起网络请求');
    });
    // setup.ts 把 __TAURI_INTERNALS__ 定义成 writable 但非 configurable，只能用赋值注入探针
    const target = window as unknown as Record<string, unknown>;
    target.__TAURI_INTERNALS__ = { invoke };
    target.__TAURI__ = { invoke };
    return { invoke, fetchSpy };
  }

  function restoreBackendProbes(fetchSpy: { mockRestore: () => void }) {
    const target = window as unknown as Record<string, unknown>;
    target.__TAURI_INTERNALS__ = undefined;
    target.__TAURI__ = undefined;
    fetchSpy.mockRestore();
  }

  it('入口位于训练图 HTML 区末尾、不在 SVG 内，且默认收起', () => {
    render(<TrainingMetricChart metrics={makeAttempt().metrics} evidenceLabel="严格证据" />);
    const chart = chartRoot();
    const guide = chart.querySelector('[data-testid="result-reading-guide"]');
    expect(chart.lastElementChild).toBe(guide);
    expect(guide?.closest('svg')).toBeNull();
    expect(chart.querySelector('[data-testid="result-reading-guide-body"]')).toBeNull();
    expect(guideToggle(chart).textContent).toBe('▶ 如何读图');
    expect(guideToggle(chart).getAttribute('type')).toBe('button');
  });

  it('展开与收起前后：metrics、曲线几何、图例与证据标签完全一致', () => {
    const metrics = makeAttempt().metrics;
    const metricsBefore = structuredClone(metrics);
    render(<TrainingMetricChart metrics={metrics} evidenceLabel="严格证据" />);
    const chart = chartRoot();
    const before = geometrySnapshot(chart);
    // 非空洞前提：既有多点折线，也有单点圆点，证据标签确实渲染出来
    expect(before.polylines.length).toBeGreaterThan(0);
    expect(before.circles.length).toBeGreaterThan(0);
    expect(before.meta).toContain('严格证据');

    const toggle = guideToggle(chart);
    fireEvent.click(toggle);
    expect(chart.querySelector('[data-testid="result-reading-guide-body"]')).not.toBeNull();
    expect(geometrySnapshot(chart)).toEqual(before);

    fireEvent.click(toggle);
    expect(geometrySnapshot(chart)).toEqual(before);
    expect(metrics).toEqual(metricsBefore);
  });

  it('既有图例、记录说明与证据标签不因新增入口而消失', () => {
    render(<TrainingMetricChart metrics={[metric({ metricName: undefined })]} evidenceLabel="诊断" />);
    const chart = chartRoot();
    expect(screen.getByText(/验证轮次 Loss/)).toBeInTheDocument();
    expect(screen.getByText(/未猜测为 Accuracy/)).toBeInTheDocument();
    expect(chart.querySelector('.training-chart__warnings')?.textContent).toContain('未猜测为 Accuracy');
    expect(chart.querySelector('.training-chart__meta')?.textContent).toContain('诊断');
    expect(chart.querySelector('.training-chart__legend')?.textContent).toContain('验证轮次 Loss');
  });

  it('空数据也能打开通用读图说明，但不编造曲线、不暗示已有结果', () => {
    render(<TrainingMetricChart metrics={[]} evidenceLabel="尚无记录" />);
    const chart = chartRoot();
    expect(chart.querySelector('svg')).toBeNull();
    expect(screen.getByText(/暂无可绘制曲线/)).toBeInTheDocument();

    fireEvent.click(guideToggle(chart));
    const body = chart.querySelector('[data-testid="result-reading-guide-body"]');
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain('如果某条序列只有一个有效点');
    expect(body?.textContent).not.toMatch(/已完成|训练成功|通过验收|当前模型/);
    expect(chart.querySelector('svg')).toBeNull();
  });

  it('单点序列仍只画一个点：读图说明不把它连成趋势', () => {
    render(<TrainingMetricChart metrics={[metric({ split: 'validation', scope: 'epoch' })]} evidenceLabel="单点诊断" />);
    const chart = chartRoot();
    const before = geometrySnapshot(chart);
    expect(before.circles).toHaveLength(2);
    expect(before.polylines).toHaveLength(0);
    fireEvent.click(guideToggle(chart));
    expect(geometrySnapshot(chart)).toEqual(before);
  });

  it('LossChart 兼容入口自然获得同一入口（未修改 LossChart 与 TrainMonitor）', () => {
    render(<LossChart data={makeAttempt().metrics} />);
    const chart = chartRoot();
    expect(chart.querySelector('[data-testid="result-reading-guide"]')).not.toBeNull();
  });

  it('TrainMonitor 中展开收起不追加档案事件、不调用后端或训练动作', () => {
    const probes = installBackendProbes();
    useExperimentStore.setState({ ledger: ledgerWithAttempt(), activeStudyId: 'study-a' });
    const ledgerBefore = structuredClone(useExperimentStore.getState().ledger);
    const eventsBefore = useExperimentStore.getState().ledger.events.length;
    const trainingBefore = trainingDataSnapshot();
    const storageBefore = localStorageSnapshot();
    const setItem = vi.spyOn(window.localStorage, 'setItem');

    render(<TrainMonitor />);
    const chart = chartRoot();
    const toggle = guideToggle(chart);
    fireEvent.click(toggle);
    fireEvent.click(chart.querySelector('[data-testid="result-reading-topic-chart_value_unit"]') as Element);
    fireEvent.click(toggle);

    expect(useExperimentStore.getState().ledger.events).toHaveLength(eventsBefore);
    expect(useExperimentStore.getState().ledger).toEqual(ledgerBefore);
    expect(trainingDataSnapshot()).toEqual(trainingBefore);
    // 与交互前完全一致的存储快照（键由测试自身写入档案时产生，不由读图入口新增）
    expect(localStorageSnapshot()).toEqual(storageBefore);
    expect(setItem).not.toHaveBeenCalled();
    expect(probes.invoke).not.toHaveBeenCalled();
    expect(probes.fetchSpy).not.toHaveBeenCalled();
    setItem.mockRestore();
    restoreBackendProbes(probes.fetchSpy);
  });

  it('读图说明只复述静态主题，不重新分析 metrics 也不授予资格', () => {
    useExperimentStore.setState({ ledger: ledgerWithAttempt(makeAttempt()), activeStudyId: 'study-a' });
    render(<TrainMonitor />);
    const chart = chartRoot();
    fireEvent.click(guideToggle(chart));
    const body = chart.querySelector('[data-testid="result-reading-guide-body"]') as HTMLElement;
    expect(body.textContent).toContain('两条线来自不同的记录范围');
    expect(body.querySelectorAll('[data-testid^="result-reading-topic-"]')).toHaveLength(4);
    // 与 TrainMonitor 的证据标签并存：入口本身不宣称严格证据或可信等级
    expect(chart.querySelector('.training-chart__meta')?.textContent).toContain('受控完成');
    expect(body.textContent).not.toContain('受控完成');
  });
});

/**
 * R2：训练完成卡片的「结果说明」同样是按需查看的静态文案入口。
 * 它接在真实卡片里，展开/收起不得改动卡片自身显示的数字、来源、epoch、参数量与证据标签，
 * 不得影响卡片显隐与关闭清理，也不得给未匹配 Attempt 或演示结果追加任何背书。
 */
describe('训练完成卡片「结果说明」接线', () => {
  function doneRecord(overrides: Partial<TrainRecord> = {}): TrainRecord {
    return {
      id: 'record-a',
      attemptId: 'attempt-a',
      timestamp: 3,
      networkSummary: 'Linear',
      totalParams: 10,
      finalAccuracy: 0.99,
      finalMetricName: 'accuracy',
      finalLoss: 0.1,
      epochs: 2,
      duration: 2000,
      dataset: 'demo',
      metrics: makeAttempt().metrics,
      executionMode: 'native',
      artifacts: { weights: true, fullModel: true, numpy: true, perModel: true },
      ...overrides,
    };
  }

  /** 与既有 TrainResultModal 用例同一套完成态夹具：严格验证终值 82%，而不是 done 通知的 99%。 */
  function nativeDone(attempt = makeAttempt()): Attempt {
    useExperimentStore.setState({ ledger: ledgerWithAttempt(attempt), activeStudyId: 'study-a' });
    useTrainingStore.setState({
      status: 'done', lastAttemptId: attempt.id, finalAccuracy: 0.99, finalMetricName: 'accuracy',
      metrics: attempt.metrics, totalEpochs: 2, executionMode: 'native',
      history: [doneRecord({ attemptId: attempt.id, metrics: attempt.metrics })],
    });
    return attempt;
  }

  function cardOf(): HTMLElement {
    return screen.getByTestId('train-result-card');
  }

  function guideToggle(root: HTMLElement): HTMLElement {
    const toggle = root.querySelector<HTMLElement>('[data-testid="result-reading-guide-toggle"]');
    if (!toggle) throw new Error('结果说明触发器必须渲染');
    return toggle;
  }

  function guideBody(root: HTMLElement): HTMLElement | null {
    return root.querySelector('[data-testid="result-reading-guide-body"]');
  }

  /** 卡片自身显示的业务内容：不含说明子树，用于证明展开前后完全一致。 */
  function cardSnapshot(card: HTMLElement) {
    return {
      header: card.querySelector('.train-result-card__header')?.textContent ?? null,
      badge: card.querySelector('.nb-badge__label')?.textContent ?? null,
      metrics: card.querySelector('.train-result-card__metrics')?.textContent ?? null,
      facts: Array.from(card.querySelectorAll('.train-result-card__facts > div')).map(node => node.textContent),
      network: card.querySelector('.train-result-card__network')?.textContent ?? null,
      note: card.querySelector('.train-result-card__note')?.textContent ?? null,
      alerts: Array.from(card.querySelectorAll('.nb-alert')).map(node => node.textContent),
      footer: card.querySelector('.train-result-card__actions')?.textContent ?? null,
      footerDisabled: Array.from(card.querySelectorAll('.train-result-card__actions button')).map(b => b.disabled),
    };
  }

  function trainingDataSnapshot() {
    return structuredClone(Object.fromEntries(
      Object.entries(useTrainingStore.getState()).filter(([, value]) => typeof value !== 'function'),
    ));
  }

  function localStorageSnapshot(): Record<string, string> {
    const entries: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key !== null) entries[key] = window.localStorage.getItem(key) ?? '';
    }
    return entries;
  }

  function installBackendProbes() {
    const invoke = vi.fn(() => {
      throw new Error('结果说明不得调用 Tauri 后端');
    });
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() => {
      throw new Error('结果说明不得发起网络请求');
    });
    const target = window as unknown as Record<string, unknown>;
    target.__TAURI_INTERNALS__ = { invoke };
    target.__TAURI__ = { invoke };
    return { invoke, fetchSpy };
  }

  function restoreBackendProbes(fetchSpy: { mockRestore: () => void }) {
    const target = window as unknown as Record<string, unknown>;
    target.__TAURI_INTERNALS__ = undefined;
    target.__TAURI__ = undefined;
    fetchSpy.mockRestore();
  }

  it('入口位于卡片既有说明之后、操作区之前，默认收起且标签固定', async () => {
    nativeDone();
    render(<TrainResultModal />);
    const card = await screen.findByTestId('train-result-card');
    const guide = card.querySelector('[data-testid="result-reading-guide"]');
    expect(guide).not.toBeNull();
    expect(guide?.closest('svg')).toBeNull();
    expect(guide?.previousElementSibling).toHaveClass('train-result-card__note');
    expect(guide?.nextElementSibling).toHaveClass('train-result-card__actions');
    expect(guideBody(card)).toBeNull();
    const toggle = guideToggle(card);
    expect(toggle.textContent).toBe('▶ 结果说明');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('展开与收起前后：指标值、来源、epoch、参数量与证据标签完全一致', async () => {
    nativeDone();
    render(<TrainResultModal />);
    const card = await screen.findByTestId('train-result-card');
    const before = cardSnapshot(card);
    // 非空洞前提：卡片确实显示了严格验证终值、证据标签、epoch 覆盖与参数量
    expect(before.metrics).toContain('82.0%');
    expect(before.metrics).not.toContain('99.0%');
    expect(before.badge).toContain('受控完成');
    expect(before.facts.join(' ')).toContain('Epoch 2');
    expect(before.facts.join(' ')).toContain('参数总量');
    expect(before.network).toBe('Linear');

    const toggle = guideToggle(card);
    fireEvent.click(toggle);
    expect(guideBody(card)).not.toBeNull();
    expect(cardSnapshot(card)).toEqual(before);
    fireEvent.click(toggle);
    expect(cardSnapshot(card)).toEqual(before);
  });

  it('说明只复述卡片自己的静态分组，正文来自共享文案唯一来源', async () => {
    nativeDone();
    render(<TrainResultModal />);
    const card = await screen.findByTestId('train-result-card');
    fireEvent.click(guideToggle(card));
    const body = guideBody(card) as HTMLElement;
    expect(Array.from(body.querySelectorAll('[data-testid^="result-reading-topic-"]'))
      .map(node => node.getAttribute('data-testid')))
      .toEqual(TRAIN_RESULT_READING_TOPIC_IDS.map(id => `result-reading-topic-${id}`));
    for (const id of TRAIN_RESULT_READING_TOPIC_IDS) {
      expect(body.textContent).toContain(RESULT_READING_TOPICS[id].text);
    }
    expect(body.textContent).toContain('训练完成通知本身只说明这次运行已结束');
    // 对比区专属主题不进卡片
    expect(body.textContent).not.toContain(RESULT_READING_TOPICS.comparison_strictness_limits.text);

    // 不复制第二份正文：改共享来源，卡片重新展开时读到的是同一份
    const original = RESULT_READING_TOPICS.final_point_best_epoch.text;
    try {
      RESULT_READING_TOPICS.final_point_best_epoch.text = 'SHARED_R2_CARD_PROBE';
      fireEvent.click(guideToggle(card));
      fireEvent.click(guideToggle(card));
      expect(guideBody(card)?.textContent).toContain('SHARED_R2_CARD_PROBE');
    } finally {
      RESULT_READING_TOPICS.final_point_best_epoch.text = original;
    }
    expect(RESULT_READING_TOPICS.final_point_best_epoch.text).toBe(original);
  });

  it('未匹配 Attempt 时说明只是教学解释，不给卡片升级背书', async () => {
    useTrainingStore.setState({
      status: 'done', lastAttemptId: 'missing', finalAccuracy: 0.8, finalMetricName: 'accuracy',
      executionMode: 'native',
    });
    render(<TrainResultModal />);
    const card = await screen.findByTestId('train-result-card');
    expect(card.querySelector('.nb-badge__label')?.textContent).toContain('不能授予可信背书');
    const alertText = () => card.querySelector('.nb-alert')?.textContent ?? '';
    expect(alertText()).toContain('Attempt 档案未匹配');

    fireEvent.click(guideToggle(card));
    const body = guideBody(card) as HTMLElement;
    expect(body.textContent).toContain('不一定等于计划轮数的最后一轮');
    expect(card.querySelector('.nb-badge__label')?.textContent).toContain('不能授予可信背书');
    expect(alertText()).toContain('Attempt 档案未匹配');
    for (const phrase of ['已授予金标', '已获得金标', '可以授予可信背书', '本次训练已通过验证']) {
      expect(body.textContent, phrase).not.toContain(phrase);
    }
  });

  it('演示结果展开前后仍显示演示提示，说明不把演示变成实验结论', async () => {
    useTrainingStore.setState({
      status: 'done', lastAttemptId: null, finalAccuracy: 0.75, finalMetricName: 'accuracy',
      metrics: [], totalEpochs: 2, executionMode: 'simulation',
      history: [doneRecord({ id: 'record-sim', attemptId: undefined, executionMode: 'simulation', metrics: [] })],
    });
    render(<TrainResultModal />);
    const card = await screen.findByTestId('train-result-card');
    const before = cardSnapshot(card);
    expect(before.header).toContain('演示训练完成');
    expect(before.badge).toContain('演示数据，不构成实验结果');

    fireEvent.click(guideToggle(card));
    expect(guideBody(card)?.textContent).toContain('受控管线只证明这次运行可追溯');
    expect(cardSnapshot(card)).toEqual(before);
  });

  it('点击说明不关闭卡片、不重置训练、不打开独立曲线窗口', async () => {
    const probes = installBackendProbes();
    nativeDone();
    const resetSpy = vi.fn();
    useTrainingStore.setState({ resetTraining: resetSpy });
    const trainingBefore = trainingDataSnapshot();
    render(<TrainResultModal />);
    const card = await screen.findByTestId('train-result-card');
    const toggle = guideToggle(card);

    fireEvent.click(toggle);
    fireEvent.click(guideBody(card)?.querySelector('[data-testid^="result-reading-topic-"]') as Element);
    fireEvent.click(toggle);

    expect(screen.getByTestId('train-result-card')).toBeInTheDocument();
    expect(guideBody(card)).toBeNull();
    expect(toggle.textContent).toBe('▶ 结果说明');
    expect(resetSpy).not.toHaveBeenCalled();
    expect(probes.invoke).not.toHaveBeenCalled();
    expect(trainingDataSnapshot()).toEqual(trainingBefore);
    restoreBackendProbes(probes.fetchSpy);
  });

  it('展开状态下 Escape 仍然关闭卡片并清理临时运行态（既有行为可达）', async () => {
    nativeDone();
    const resetSpy = vi.fn();
    useTrainingStore.setState({ resetTraining: resetSpy });
    render(<TrainResultModal />);
    const card = await screen.findByTestId('train-result-card');
    fireEvent.click(guideToggle(card));
    expect(guideBody(card)).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(resetSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('train-result-card')).not.toBeInTheDocument());
    expect(useExperimentStore.getState().ledger.attempts.some(item => item.id === 'attempt-a')).toBe(true);
  });

  it('展开、收起、重复点击：档案、业务状态、持久化与后端一律不动', async () => {
    const probes = installBackendProbes();
    nativeDone();
    const ledgerBefore = structuredClone(useExperimentStore.getState().ledger);
    const trainingBefore = trainingDataSnapshot();
    const storageBefore = localStorageSnapshot();
    const setItem = vi.spyOn(window.localStorage, 'setItem');

    render(<TrainResultModal />);
    const card = await screen.findByTestId('train-result-card');
    const writesBeforeClicks = setItem.mock.calls.length;
    const toggle = guideToggle(card);
    for (let round = 0; round < 4; round += 1) fireEvent.click(toggle);

    expect(toggle.textContent).toBe('▶ 结果说明');
    expect(useExperimentStore.getState().ledger).toEqual(ledgerBefore);
    expect(useExperimentStore.getState().ledger.events).toHaveLength(ledgerBefore.events.length);
    expect(trainingDataSnapshot()).toEqual(trainingBefore);
    expect(localStorageSnapshot()).toEqual(storageBefore);
    expect(setItem).toHaveBeenCalledTimes(writesBeforeClicks);
    expect(probes.invoke).not.toHaveBeenCalled();
    expect(probes.fetchSpy).not.toHaveBeenCalled();
    setItem.mockRestore();
    restoreBackendProbes(probes.fetchSpy);
  });
});
