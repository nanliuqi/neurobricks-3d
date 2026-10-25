import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ComparisonView from '@/components/study/ComparisonView';
import ComparisonChartBoundary from '@/components/study/comparison/ComparisonChartBoundary';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { COMPARISON_READING_TOPIC_IDS, RESULT_READING_TOPICS } from '@/content/resultInterpretation';
import { overrideFingerprint } from '@/utils/comparisonViewModel';
import type { Attempt, Experiment, Study } from '@/types/experiment';

const STUDY: Study = {
  id: 'study-compare', protocolVersion: 1, name: '对比', kind: 'candidate_selection', status: 'active',
  question: '对比', comparisonKey: 'key', selectionRule: 'manual', budget: { maxExperiments: 3, maxGpuMinutes: 60 },
  createdAt: 1, updatedAt: 1, lockedAt: 1,
  datasetContract: {
    identity: { id: 'data', name: 'data', taskType: 'image_classification', contentHash: 'sha256:data', fingerprintAlgorithm: 'sha256-v1', sampleCount: 100, classCount: 2, importedAt: 1 },
    split: { strategy: 'random', seed: 42, validationRatio: 0.2, testRatio: 0.1, sampleUnit: 'image', independence: 'user_declared', userDeclaration: 'image', machineChecks: [], splitHash: 'sha256:split-a' },
    preprocessing: { configHash: 'sha256:pre', summary: 'fixed' },
  },
};

function experiment(id: string): Experiment {
  return { id, protocolVersion: 1, studyId: STUDY.id, name: id, config: {} as never, configHash: id, createdAt: 1 };
}

function attempt(id: string, experimentId: string, splitHash: string): Attempt {
  return {
    id, protocolVersion: 1, experimentId, runId: `run-${id}`, modelId: `model-${id}`,
    config: { epochs: 1, learningRate: 0.001, batchSize: 8, dataset: 'local_image', device: 'cpu', layers: [] },
    ordinal: 1, parentAttemptId: null, restartCount: 0, resumeType: 'fresh', status: 'completed',
    startedAt: 1, endedAt: 2, executionMode: 'native',
    // 严格序列要求完整指标元数据（validation/epoch + metricName + direction）；
    // 旧档案缺失时视图层失败关闭，不猜测语义。
    metrics: [{
      epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, metricName: 'accuracy', metricValue: 0.8,
      optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 1,
    }],
    artifacts: { weights: true, fullModel: true, numpy: true, perModel: true },
    provenance: {
      source: 'controlled', executionTrust: 'trusted', witnessedByPipeline: true,
      environment: { applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cpu', cudaVersion: null },
      datasetContentHash: 'sha256:data', splitHash, testSetHash: 'sha256:test', machineChecks: [],
      testSampleCount: 20, testLabelCounts: { '0': 10, '1': 10 }, preprocessingHash: 'sha256:pre',
      configHash: `sha256:${id}`, modelWeightsHash: `sha256:model-${id}`,
    },
  };
}

describe('ComparisonView override protocol', () => {
  beforeEach(() => {
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(experiment('exp-a'));
    useExperimentStore.getState().registerExperiment(experiment('exp-b'));
    useExperimentStore.getState().registerAttempt(attempt('attempt-a', 'exp-a', 'sha256:split-a'));
    useExperimentStore.getState().registerAttempt(attempt('attempt-b', 'exp-b', 'sha256:split-b'));
    // 模块 07 协议前置：非严格对比必须留痕，审计持久化非 healthy 时失败关闭；
    // 确认复核要求当前 Study 为活动 Study（与生产挂载条件一致）。
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
    useExperimentStore.getState().setActiveStudy(STUDY.id);
  });

  it('requires an in-app confirmation before rendering a non-strict comparison', async () => {
    render(<ComparisonView study={STUDY} />);
    const checkboxes = await screen.findAllByRole('checkbox');
    checkboxes.forEach(checkbox => {
      if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '仍然对比（带水印）' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '仍然对比（带水印）' }));
    expect(screen.getByRole('alertdialog', { name: '确认进行非严格对比？' })).toHaveTextContent('永久写入越界记录');
    expect(screen.queryByText('非严格可比：此水印会进入导出报告。')).not.toBeInTheDocument();

    // 确认是异步流程（事件写入 + 审计 flush）：用 act 包裹消除警告
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '仍然显示并留痕' }));
    });
    expect(await screen.findByText('非严格可比：此水印会进入导出报告。')).toBeInTheDocument();
    expect(useExperimentStore.getState().ledger.events.at(-1)?.eventType).toBe('comparison_override');
  });

  /** 选中两个夹具 Attempt（splitHash 不同 → 非严格）。 */
  async function selectBothAndOpenDialog() {
    const checkboxes = await screen.findAllByRole('checkbox');
    checkboxes.forEach(checkbox => {
      if (!(checkbox as HTMLInputElement).checked && !(checkbox as HTMLInputElement).disabled) fireEvent.click(checkbox);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '仍然对比（带水印）' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '仍然对比（带水印）' }));
    return screen.getByRole('alertdialog', { name: '确认进行非严格对比？' });
  }

  it('审计持久化 degraded：入口与权限一致——按钮禁用、说明原因、零事件写入', async () => {
    useExperimentStore.setState({ auditPersistence: 'degraded', auditError: 'disk failure' });
    render(<ComparisonView study={STUDY} />);
    const checkboxes = await screen.findAllByRole('checkbox');
    checkboxes.forEach(checkbox => {
      if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
    });
    // 不健康时不显示可执行按钮：禁用态 + Alert 说明（requestOverride 内部 guard 保留作纵深防御）
    await waitFor(() => expect(screen.getByRole('button', { name: '仍然对比（带水印）' })).toBeDisabled());
    expect(screen.getByText('审计链不健康，无法留痕')).toBeInTheDocument();
    expect(screen.getByText(/非严格对比必须永久留痕后才能展示，因此不能越界展示/)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog', { name: '确认进行非严格对比？' })).not.toBeInTheDocument();
    expect(useExperimentStore.getState().ledger.events.some(event => event.eventType === 'comparison_override')).toBe(false);
  });

  it('弹窗打开后同步篡改 Attempt provenance，立即确认：取消、零事件、无水印', async () => {
    render(<ComparisonView study={STUDY} />);
    await selectBothAndOpenDialog();

    // 攻击：确认框打开期间同步篡改 attempt-b 的切分哈希（React 闭包仍持有旧值）
    await act(async () => {
      useExperimentStore.setState(state => ({
        ledger: {
          ...state.ledger,
          attempts: state.ledger.attempts.map(item => (
            item.id === 'attempt-b'
              ? { ...item, provenance: { ...item.provenance, splitHash: 'sha256:tampered' } }
              : item
          )),
        },
      }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '仍然显示并留痕' }));
    });

    // 确认瞬间基于最新快照重建复核 → 事实比对失败 → 取消且不写事件
    const overrideEvents = useExperimentStore.getState().ledger.events.filter(event => event.eventType === 'comparison_override');
    expect(overrideEvents).toHaveLength(0);
    expect(screen.queryByText('非严格可比：此水印会进入导出报告。')).not.toBeInTheDocument();
    expect(screen.getByText(/本次确认已取消/)).toBeInTheDocument();
    // 确认框已关闭，需重新发起
    expect(screen.queryByRole('alertdialog', { name: '确认进行非严格对比？' })).not.toBeInTheDocument();
  });

  it('Study A 开确认框后切到 Study B 再确认：不写事件、不展示旧 Study 曲线', async () => {
    const { rerender } = render(<ComparisonView study={STUDY} />);
    await selectBothAndOpenDialog();

    // 切换到另一个 Study（同一组件实例，验证控制器内部清理）；
    // 挂载态下的 store 更新用 act 包裹，避免订阅重渲染警告
    const studyB: Study = { ...STUDY, id: 'study-b', name: '另一个课题' };
    await act(async () => {
      useExperimentStore.getState().registerStudy(studyB);
      useExperimentStore.getState().setActiveStudy('study-b');
    });
    rerender(<ComparisonView study={studyB} />);

    // pending 确认已被清除：确认按钮不存在，无法把 Study A 的 attemptIds 写进 Study B
    expect(screen.queryByRole('alertdialog', { name: '确认进行非严格对比？' })).not.toBeInTheDocument();
    const overrideEvents = useExperimentStore.getState().ledger.events.filter(event => event.eventType === 'comparison_override');
    expect(overrideEvents).toHaveLength(0);
    // 旧 Study 曲线不残留（Study B 无 Attempt → 无曲线区域）
    expect(screen.queryByRole('img', { name: /对比曲线/ })).not.toBeInTheDocument();
  });

  it('双击确认只写入一个 comparison_override 事件', async () => {
    render(<ComparisonView study={STUDY} />);
    await selectBothAndOpenDialog();
    const confirmButton = screen.getByRole('button', { name: '仍然显示并留痕' });
    await act(async () => {
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
    });
    await waitFor(() => expect(screen.getByText('非严格可比：此水印会进入导出报告。')).toBeInTheDocument());

    const overrideEvents = useExperimentStore.getState().ledger.events.filter(event => event.eventType === 'comparison_override');
    expect(overrideEvents).toHaveLength(1);
    const payload = overrideEvents[0].payload as { attemptIds: string[]; watermark: string; fingerprint: string; metricSemantics: string };
    expect([...payload.attemptIds].sort()).toEqual(['attempt-a', 'attempt-b']);
    expect(payload.watermark).toBe('非严格可比');
    expect(typeof payload.fingerprint).toBe('string');
    expect(payload.metricSemantics).toBe('accuracy');
    expect(overrideEvents[0].entityType).toBe('study');
    expect(overrideEvents[0].entityId).toBe(STUDY.id);
  });

  it('选择集合改变后旧 override 自动失效（水印消失）', async () => {
    render(<ComparisonView study={STUDY} />);
    await selectBothAndOpenDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '仍然显示并留痕' }));
    });
    await waitFor(() => expect(screen.getByText('非严格可比：此水印会进入导出报告。')).toBeInTheDocument());

    // 取消一个 Attempt → 精确集合变化 → 指纹不匹配 → override 失效
    const checkboxes = screen.getAllByRole('checkbox').filter(checkbox => (checkbox as HTMLInputElement).checked);
    fireEvent.click(checkboxes[0]);
    await waitFor(() => expect(screen.queryByText('非严格可比：此水印会进入导出报告。')).not.toBeInTheDocument());
  });

  it('历史精确 override 可恢复：重新挂载后同集合同指标无需再次确认', async () => {
    const { unmount } = render(<ComparisonView study={STUDY} />);
    await selectBothAndOpenDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '仍然显示并留痕' }));
    });
    await waitFor(() => expect(screen.getByText('非严格可比：此水印会进入导出报告。')).toBeInTheDocument());
    unmount();

    // 重新挂载（模拟刷新/面板收起展开）：重新选择同一精确集合 → 历史 override 精确匹配，无需再次确认
    render(<ComparisonView study={STUDY} />);
    const checkboxes = await screen.findAllByRole('checkbox');
    checkboxes.forEach(checkbox => {
      if (!(checkbox as HTMLInputElement).checked && !(checkbox as HTMLInputElement).disabled) fireEvent.click(checkbox);
    });
    expect(await screen.findByText('非严格可比：此水印会进入导出报告。')).toBeInTheDocument();
    expect(screen.getByText('非严格对比留痕（精确 Attempt 集合，不作用于其他对比）')).toBeInTheDocument();
    // 恢复不写新事件
    const overrideEvents = useExperimentStore.getState().ledger.events.filter(event => event.eventType === 'comparison_override');
    expect(overrideEvents).toHaveLength(1);
  });

  it('严格可比时直接渲染曲线：真实 epoch 轴、语义表格、方差徽章与可访问名称', async () => {
    // 直接替换 store 中的 attempt-b（registerAttempt 对重复 id 会拒绝）：splitHash 改为与 attempt-a 一致 → 严格可比
    useExperimentStore.setState(state => ({
      ledger: {
        ...state.ledger,
        attempts: state.ledger.attempts.map(item => (
          item.id === 'attempt-b'
            ? { ...item, provenance: { ...item.provenance, splitHash: 'sha256:split-a' } }
            : item
        )),
      },
    }));
    render(<ComparisonView study={STUDY} />);

    expect(await screen.findByRole('img', { name: /Accuracy 对比曲线：X 轴 epoch/ })).toBeInTheDocument();
    expect(screen.getByText('严格可比（同一考卷、同一指标口径）')).toBeInTheDocument();
    // 语义化表格：读屏可用的精确数值审查入口
    expect(screen.getByText('最终验证指标（严格序列的最后一条合法记录）')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '最终值' })).toBeInTheDocument();
    expect(screen.getAllByText('0.800000')).toHaveLength(2);
    // 单 seed → 未验证方差，不用显著/稳定/可靠措辞
    expect(screen.getByText('未验证方差（单 seed）')).toBeInTheDocument();
    // 图例不只靠颜色：线型名称 + 实验名文本
    expect(screen.getByText(/实线/)).toBeInTheDocument();
    // 无 override 时不得有水印
    expect(screen.queryByText('非严格可比：此水印会进入导出报告。')).not.toBeInTheDocument();
  });

  it('不可信完成结果不可选择，并显示中文执行信任状态', async () => {
    const untrusted = { ...attempt('attempt-c', 'exp-a', 'sha256:split-a'), id: 'attempt-c' };
    untrusted.provenance = { ...untrusted.provenance, executionTrust: 'unverified' as const };
    useExperimentStore.getState().registerAttempt(untrusted);
    render(<ComparisonView study={STUDY} />);

    expect(await screen.findByText('已完成但执行不可信（不得进入严格对比）：')).toBeInTheDocument();
    const disabledBoxes = screen.getAllByRole('checkbox').filter(checkbox => (checkbox as HTMLInputElement).disabled);
    expect(disabledBoxes.length).toBeGreaterThan(0);
  });

  /* ---------- 模块 07 验收补丁：新增攻击测试 ---------- */

  it('非严格 override 下不生成最佳方案/排名/被选中语言', async () => {
    render(<ComparisonView study={STUDY} />);
    await selectBothAndOpenDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '仍然显示并留痕' }));
    });
    await waitFor(() => expect(screen.getByText('非严格可比：此水印会进入导出报告。')).toBeInTheDocument());

    // override 只允许查看带水印趋势与精确数值，绝不生成排名语言
    expect(screen.queryByText(/可被选中/)).not.toBeInTheDocument();
    expect(screen.queryByText(/观察到/)).not.toBeInTheDocument();
    expect(screen.queryByText(/改善最多/)).not.toBeInTheDocument();
  });

  it('无共同合法指标时不显示可点击但无反应的按钮，展示明确说明', async () => {
    // 旧档案形态：有指标记录但无 split/scope/direction 元数据
    useExperimentStore.setState(state => ({
      ledger: {
        ...state.ledger,
        attempts: state.ledger.attempts.map(item => ({
          ...item,
          metrics: [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, metricName: 'accuracy', timestamp: 1 }],
        })),
      },
    }));
    render(<ComparisonView study={STUDY} />);
    const checkboxes = await screen.findAllByRole('checkbox');
    checkboxes.forEach(checkbox => {
      if (!(checkbox as HTMLInputElement).checked && !(checkbox as HTMLInputElement).disabled) fireEvent.click(checkbox);
    });

    await waitFor(() => expect(screen.getByText('非严格对比不可用')).toBeInTheDocument());
    expect(screen.getByText(/当前没有可被诚实叠加的共同指标，非严格 override 也不能补造指标语义/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '仍然对比（带水印）' })).not.toBeInTheDocument();
  });

  it('被排除的非有限记录警告真实展示（含 Attempt 与数量）', async () => {
    useExperimentStore.setState(state => ({
      ledger: {
        ...state.ledger,
        attempts: state.ledger.attempts.map(item => ({
          ...item,
          // 同一严格组（splitHash 统一）+ 一条 NaN 记录
          provenance: { ...item.provenance, splitHash: 'sha256:split-a' },
          metrics: [
            { epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, metricName: 'accuracy', metricValue: 0.8, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 1 },
            { epoch: 2, step: 2, loss: Number.NaN, accuracy: Number.NaN, metricName: 'accuracy', metricValue: Number.NaN, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 2 },
          ],
        })),
      },
    }));
    render(<ComparisonView study={STUDY} />);

    expect(await screen.findByText('部分指标记录已被排除')).toBeInTheDocument();
    expect(screen.getByText(/1 条记录因数值非有限被排除/)).toBeInTheDocument();
    // NaN 不进入最终值表格
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('图表渲染无重复 React key 警告（短 epoch 区间刻度去重）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      useExperimentStore.setState(state => ({
        ledger: {
          ...state.ledger,
          attempts: state.ledger.attempts.map(item => ({
            ...item,
            provenance: { ...item.provenance, splitHash: 'sha256:split-a' },
          })),
        },
      }));
      render(<ComparisonView study={STUDY} />);
      expect(await screen.findByRole('img', { name: /Accuracy 对比曲线/ })).toBeInTheDocument();
      const duplicateKeyCalls = errorSpy.mock.calls.filter(call => String(call[0]).includes('same key'));
      expect(duplicateKeyCalls).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('audit degraded：内存中的历史 override 事件不得激活水印', async () => {
    // 构造完整合法的历史 override 事件（仅写入内存）
    const context = {
      studyId: STUDY.id,
      attemptIds: ['attempt-a', 'attempt-b'],
      reasons: ['验证/测试集切分不同'],
      metricSemantics: 'accuracy',
      metricView: {
        metricName: 'accuracy',
        split: 'validation' as const,
        scope: 'epoch' as const,
        directions: [
          { attemptId: 'attempt-a', optimizationDirection: 'maximize' as const },
          { attemptId: 'attempt-b', optimizationDirection: 'maximize' as const },
        ],
      },
    };
    useExperimentStore.getState().appendEvent('study', STUDY.id, 'comparison_override', {
      attemptIds: context.attemptIds,
      reasons: context.reasons,
      watermark: '非严格可比',
      metricSemantics: context.metricSemantics,
      metricView: context.metricView,
      fingerprint: overrideFingerprint(context),
    });
    // 审计持久化 degraded：事件在 ledger.events 中存在，但不得赋权
    useExperimentStore.setState({ auditPersistence: 'degraded', auditError: 'flush failed' });

    render(<ComparisonView study={STUDY} />);
    const checkboxes = await screen.findAllByRole('checkbox');
    checkboxes.forEach(checkbox => {
      if (!(checkbox as HTMLInputElement).checked && !(checkbox as HTMLInputElement).disabled) fireEvent.click(checkbox);
    });

    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0));
    expect(screen.queryByText('非严格可比：此水印会进入导出报告。')).not.toBeInTheDocument();
    // 事件保留为事实（append-only，不删除），可在留痕区展示
    expect(useExperimentStore.getState().ledger.events.some(event => event.eventType === 'comparison_override')).toBe(true);
  });

  it('healthy 变 degraded：已展示的非严格曲线立即隐藏并说明原因', async () => {
    render(<ComparisonView study={STUDY} />);
    await selectBothAndOpenDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '仍然显示并留痕' }));
    });
    await waitFor(() => expect(screen.getByText('非严格可比：此水印会进入导出报告。')).toBeInTheDocument());

    // 审计状态恶化 → 订阅驱动重算 → override 立即失效
    await act(async () => {
      useExperimentStore.setState({ auditPersistence: 'degraded', auditError: 'disk failure' });
    });
    await waitFor(() => expect(screen.queryByText('非严格可比：此水印会进入导出报告。')).not.toBeInTheDocument());
    // 事件未从 ledger 删除（保留为事实）
    expect(useExperimentStore.getState().ledger.events.some(event => event.eventType === 'comparison_override')).toBe(true);
  });

  it('确认写入的 payload 携带完整指标视图（逐 Attempt 方向）', async () => {
    render(<ComparisonView study={STUDY} />);
    await selectBothAndOpenDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '仍然显示并留痕' }));
    });
    await waitFor(() => expect(screen.getByText('非严格可比：此水印会进入导出报告。')).toBeInTheDocument());

    const event = useExperimentStore.getState().ledger.events.find(item => item.eventType === 'comparison_override');
    const payload = event?.payload as {
      metricView: { metricName: string; split: string; scope: string; directions: Array<{ attemptId: string; optimizationDirection: string }> };
    };
    expect(payload.metricView.metricName).toBe('accuracy');
    expect(payload.metricView.split).toBe('validation');
    expect(payload.metricView.scope).toBe('epoch');
    expect(payload.metricView.directions).toEqual([
      { attemptId: 'attempt-a', optimizationDirection: 'maximize' },
      { attemptId: 'attempt-b', optimizationDirection: 'maximize' },
    ]);
  });
});

/* ---------------- 严格可比双曲线链路（M07-002~015 复现与回归） ---------------- */

interface StrictAttemptOptions {
  learningRate: number;
  ordinal: number;
  seed?: number | null;
  /** validation/epoch 严格记录的值序列（按 epoch 1..n）。 */
  values: number[];
  /** 可选：故意更高的 train/batch 尾项，严格链路必须排除。 */
  trainBatchTail?: number;
  /** 可选：打乱记录顺序，验证按 epoch 排序而非数组顺序。 */
  shuffle?: boolean;
  /** 可选：覆盖切分哈希（不可比场景）。 */
  splitHash?: string;
  /** 可选：直接注入原始 metrics（NaN/缺字段等异常场景），优先于 values 生成。 */
  rawMetrics?: Attempt['metrics'];
}

function strictAttempt(id: string, experimentId: string, options: StrictAttemptOptions): Attempt {
  const metrics = options.values.map((value, index) => ({
    epoch: index + 1,
    step: (index + 1) * 10,
    globalStep: (index + 1) * 10,
    loss: 0.5 - index * 0.1,
    accuracy: value,
    metricName: 'accuracy' as const,
    metricValue: value,
    optimizationDirection: 'maximize' as const,
    split: 'validation' as const,
    scope: 'epoch' as const,
    timestamp: 1000 + index * 100,
  }));
  if (options.trainBatchTail !== undefined) {
    // 尾项：同 epoch、更高值、更晚时间戳——若被误用，表格/曲线会出现该值
    metrics.push({
      epoch: options.values.length,
      step: options.values.length * 10 + 5,
      globalStep: options.values.length * 10 + 5,
      loss: 0.05,
      accuracy: options.trainBatchTail,
      metricName: 'accuracy' as const,
      metricValue: options.trainBatchTail,
      optimizationDirection: 'maximize' as const,
      split: 'train' as const,
      scope: 'batch' as const,
      timestamp: 9999,
    });
  }
  const ordered = options.shuffle ? [...metrics].reverse() : metrics;
  const finalMetrics = options.rawMetrics ?? ordered;
  return {
    id, protocolVersion: 1, experimentId, runId: `run-${id}`, modelId: `model-${id}`,
    config: { epochs: options.values.length, learningRate: options.learningRate, batchSize: 8, seed: options.seed ?? null, dataset: 'local_image', device: 'cpu', layers: [] } as Attempt['config'],
    ordinal: options.ordinal, parentAttemptId: null, restartCount: 0, resumeType: 'fresh', status: 'completed',
    startedAt: 1, endedAt: 2, executionMode: 'native',
    metrics: finalMetrics,
    artifacts: { weights: true, fullModel: true, numpy: true, perModel: true },
    provenance: {
      source: 'controlled', executionTrust: 'trusted', witnessedByPipeline: true,
      environment: { applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cpu', cudaVersion: null },
      // 严格可比：数据集/切分/预处理完全一致；仅超参不同（结构与超参不阻止比较）
      datasetContentHash: 'sha256:data', splitHash: options.splitHash ?? 'sha256:split-a', testSetHash: 'sha256:test', machineChecks: [],
      testSampleCount: 20, testLabelCounts: { '0': 10, '1': 10 }, preprocessingHash: 'sha256:pre',
      configHash: `sha256:${id}`, modelWeightsHash: `sha256:model-${id}`,
    },
  };
}

describe('ComparisonView 严格可比双曲线（真实用户链路）', () => {
  beforeEach(() => {
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(experiment('exp-a'));
    useExperimentStore.getState().registerExperiment(experiment('exp-b'));
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
    useExperimentStore.getState().setActiveStudy(STUDY.id);
  });

  function registerStrictPair(): void {
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.72, 0.76], trainBatchTail: 0.99,
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [0.84, 0.88], trainBatchTail: 0.995,
    }));
  }

  function chartPolylines(container: HTMLElement): string[] {
    const chart = container.querySelector('.comparison-view__chart svg[role="img"]');
    if (!chart) return [];
    return [...chart.querySelectorAll('polyline')].map(node => node.getAttribute('points') ?? '');
  }

  it('不同学习率、不同指标：两条曲线分别使用各自 validation/epoch 序列，不取 train/batch 尾项', async () => {
    registerStrictPair();
    const { container } = render(<ComparisonView study={STUDY} />);

    // 默认选择自动命中最大严格组：无需任何点击即应渲染两条曲线
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(2));
    const [first, second] = chartPolylines(container);
    // 两条曲线的几何坐标必须不同（数据源不同，非同一 points 数组）
    expect(first).not.toBe(second);
    expect(first.split(' ').length).toBe(2);
    expect(second.split(' ').length).toBe(2);

    // 最终指标表：分别显示各自最后一条严格记录（0.76 / 0.88），绝不显示 train/batch 尾项 0.99/0.995
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('0.760000');
    expect(table).toHaveTextContent('0.880000');
    expect(table).not.toHaveTextContent('0.990000');
    expect(table).not.toHaveTextContent('0.995000');
    // 两行 Attempt 各自存在且身份不重复
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('#1');
    expect(rows[1]).toHaveTextContent('#2');

    // 图例：两个 Attempt 身份分别可见（线型+实验名）
    const legend = container.querySelector('.comparison-view__legend');
    expect(legend).toHaveTextContent('exp-a');
    expect(legend).toHaveTextContent('exp-b');
    expect(legend).toHaveTextContent('实线');
    expect(legend).toHaveTextContent('长虚线');

    // 严格可比：不得出现非严格水印与 override 入口
    expect(screen.queryByText('非严格可比：此水印会进入导出报告。')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '仍然对比（带水印）' })).not.toBeInTheDocument();
  });

  it('曲线 React key 使用 Attempt ID：选择器/曲线/表格三方一一对应', async () => {
    registerStrictPair();
    const { container } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(2));
    // 选择器中两个 Attempt 都已勾选
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.filter(box => box.checked)).toHaveLength(2);
    // 取消勾选 A → 只剩 1 条选择：对比协议要求 ≥2 条，图表与表格整体隐藏，
    // 不残留单条“伪对比”；选择状态也不被默认选择 effect 强行恢复
    const checkboxA = checkboxes.find(box => box.closest('label')?.textContent?.includes('exp-a'));
    expect(checkboxA).toBeDefined();
    fireEvent.click(checkboxA!);
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(0));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect((checkboxA as HTMLInputElement).checked).toBe(false);
    // 重新勾选 A → 两条曲线恢复且各自数据不变（未停留在旧曲线）
    fireEvent.click(checkboxA!);
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(2));
    const [first, second] = chartPolylines(container);
    expect(first).not.toBe(second);
    expect(screen.getByRole('table')).toHaveTextContent('0.760000');
    expect(screen.getByRole('table')).toHaveTextContent('0.880000');
  });

  it('部分 epoch 数值相同、其他不同：不合并成一条线，不共用 points 引用', async () => {
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.72, 0.80],
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [0.72, 0.88],
    }));
    const { container } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(2));
    const [first, second] = chartPolylines(container).map(points => points.split(' '));
    // epoch 1 同值 → 同坐标；epoch 2 不同值 → 不同坐标（未被最终点或数组引用合并）
    expect(first[0]).toBe(second[0]);
    expect(first[1]).not.toBe(second[1]);
    // 不完全重合 → 不得出现重合披露
    expect(screen.queryByText('严格指标数值完全重合')).not.toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('0.800000');
    expect(table).toHaveTextContent('0.880000');
  });

  it('真实指标完全相同：保留几何重合，图例/顶点/表格分别存在，诚实披露不加偏移', async () => {
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.80, 0.85],
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [0.80, 0.85],
    }));
    const { container } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(2));
    const [first, second] = chartPolylines(container);
    // 真实重合：几何坐标完全相同是诚实结果，绝不得人为加偏移
    expect(first).toBe(second);
    // 诚实披露：明确告知数值完全重合，而非让用户误以为只有一条
    expect(screen.getByText('严格指标数值完全重合')).toBeInTheDocument();
    expect(screen.getByText(/未产生可观测差异/)).toBeInTheDocument();
    // 两条 Attempt 身份仍分别存在：图例两项 + 表格两行 + 两组顶点
    const legend = container.querySelector('.comparison-view__legend');
    expect(legend).toHaveTextContent('exp-a');
    expect(legend).toHaveTextContent('exp-b');
    const rows = screen.getByRole('table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('0.850000');
    expect(rows[1]).toHaveTextContent('0.850000');
    const markers = container.querySelectorAll('.comparison-view__chart svg[role="img"] [data-marker]');
    expect(markers).toHaveLength(4);
  });

  it('指标数组乱序：每个 Attempt 按 epoch 排序渲染，不跨 Attempt 合并', async () => {
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.72, 0.76], shuffle: true,
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [0.84, 0.88], shuffle: true,
    }));
    const { container } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(2));
    for (const points of chartPolylines(container)) {
      const xs = points.split(' ').map(pair => Number(pair.split(',')[0]));
      expect(xs).toHaveLength(2);
      // X 坐标升序 = 按真实 epoch 排序，而非数组乱序
      expect([...xs].sort((left, right) => left - right)).toEqual(xs);
    }
    const [first, second] = chartPolylines(container);
    expect(first).not.toBe(second);
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('0.760000');
    expect(table).toHaveTextContent('0.880000');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('只有 1 个 epoch 的运行：顶点标记保证数据点可见，不静默消失', async () => {
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.72],
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [0.84],
    }));
    const { container } = render(<ComparisonView study={STUDY} />);
    // 单点序列不再绘制 polyline（不伪装趋势）；顶点 marker 必须可见且坐标不同
    await waitFor(() => expect(container.querySelectorAll('.comparison-view__chart svg[role="img"] [data-marker]')).toHaveLength(2));
    expect(chartPolylines(container)).toHaveLength(0);
    const markers = [...container.querySelectorAll('.comparison-view__chart svg[role="img"] [data-marker]')];
    const [c1, c2] = markers.map(node => `${node.getAttribute('data-x')},${node.getAttribute('data-y')}`);
    expect(c1).not.toBe(c2);
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('0.720000');
    expect(table).toHaveTextContent('0.840000');
    expect(table).toHaveTextContent('1 点');
    // 单点限制说明必须可见：不得把单点伪装成趋势
    expect(screen.getByText('单点严格序列：只能比较最终值')).toBeInTheDocument();
    expect(screen.getByText(/不能解读训练过程趋势/)).toBeInTheDocument();
    // 单 epoch 退化跨度：X 轴只有真实存在的刻度 1，不得插值出幽灵刻度 2
    const tickTexts = [...container.querySelectorAll('.comparison-view__chart svg[role="img"] text')].map(node => node.textContent);
    expect(tickTexts).toContain('1');
    expect(tickTexts).not.toContain('2');
  });

  it('metricValue 全部 NaN/缺失但 accuracy 有限：失败关闭并解释，绝不回退 accuracy', async () => {
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.72, 0.76],
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [],
      rawMetrics: [
        { epoch: 1, step: 10, loss: 0.3, accuracy: 0.9, metricName: 'accuracy', metricValue: Number.NaN, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 100 },
        { epoch: 2, step: 20, loss: 0.2, accuracy: 0.95, metricName: 'accuracy', optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 200 },
      ],
    }));
    const { container } = render(<ComparisonView study={STUDY} />);
    // B 严格资格失败 → 默认选择为空；真实用户手动勾选两条后必须看到明确原因而非空白
    const checkboxes = await screen.findAllByRole('checkbox');
    checkboxes.forEach(box => {
      if (!(box as HTMLInputElement).checked && !(box as HTMLInputElement).disabled) fireEvent.click(box);
    });
    // B 无严格候选指标名 → 无共同指标 → 明确解释而非空白
    await waitFor(() => expect(screen.getByText('没有可共同严格展示的指标')).toBeInTheDocument());
    expect(chartPolylines(container)).toHaveLength(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // 0.9/0.95（accuracy 字段）绝不得冒充严格值出现
    expect(container.textContent).not.toContain('0.900000');
    expect(container.textContent).not.toContain('0.950000');
    // B 被归入孤立结果（严格描述符 no_finite_values 失败关闭）
    expect(screen.getByText(/孤立结果/)).toBeInTheDocument();
  });

  it('部分 epoch 为 NaN：合法点继续展示 + 可见排除警告，尾项 accuracy 不冒充最终值', async () => {
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.72, 0.76],
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [],
      rawMetrics: [
        { epoch: 1, step: 10, loss: 0.3, accuracy: 0.84, metricName: 'accuracy', metricValue: 0.84, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 100 },
        { epoch: 2, step: 20, loss: 0.2, accuracy: 0.99, metricName: 'accuracy', metricValue: Number.NaN, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 200 },
      ],
    }));
    const { container } = render(<ComparisonView study={STUDY} />);
    // 整张图不得因部分 NaN 静默消失：A 两点成线，B 仅剩单点 → 不画趋势线但 marker 可见
    await waitFor(() => expect(container.querySelectorAll('[data-marker]')).toHaveLength(3));
    expect(chartPolylines(container)).toHaveLength(1);
    expect(screen.getByText('部分指标记录已被排除')).toBeInTheDocument();
    expect(screen.getByText(/1 条记录因数值非有限被排除/)).toBeInTheDocument();
    const table = screen.getByRole('table');
    // B 的最终严格值是 epoch1 的 0.84（唯一合法点），绝不是 NaN 记录的 accuracy 0.99
    expect(table).toHaveTextContent('0.840000');
    expect(table).not.toHaveTextContent('0.990000');
  });

  it('缺少 split/scope 标记的旧档案：严格曲线失败关闭并给出可见解释', async () => {
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.72, 0.76],
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [],
      rawMetrics: [
        // 无 split/scope：旧档案不得被猜成 validation/epoch
        { epoch: 1, step: 10, loss: 0.3, accuracy: 0.9, metricName: 'accuracy', metricValue: 0.9, optimizationDirection: 'maximize', timestamp: 100 },
      ],
    }));
    const { container } = render(<ComparisonView study={STUDY} />);
    // 真实用户手动勾选两条：失败关闭必须伴随可见解释，不得无反应
    const checkboxes = await screen.findAllByRole('checkbox');
    checkboxes.forEach(box => {
      if (!(box as HTMLInputElement).checked && !(box as HTMLInputElement).disabled) fireEvent.click(box);
    });
    await waitFor(() => expect(screen.getByText('没有可共同严格展示的指标')).toBeInTheDocument());
    expect(screen.getByText(/旧档案不猜测语义/)).toBeInTheDocument();
    expect(chartPolylines(container)).toHaveLength(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/孤立结果/)).toBeInTheDocument();
  });

  it('切换 Study：上一 Study 的严格曲线不残留，选择状态被清理', async () => {
    registerStrictPair();
    const study2: Study = { ...STUDY, id: 'study-compare-2', name: '对比 2' };
    useExperimentStore.getState().registerStudy(study2);
    const { container, rerender } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(2));

    rerender(<ComparisonView study={study2} />);
    // 新 Study 无 Attempt：曲线/表格/选择全部清空，旧 Study 数值不得残留
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(0));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('0.760000');
    expect(container.textContent).not.toContain('0.880000');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText(/当前 Study 尚无带指标记录的 Attempt/)).toBeInTheDocument();
  });

  it('新增 Attempt 后重新计算：新严格组成员可勾选，勾选后图表/表格立即纳入新曲线', async () => {
    registerStrictPair();
    const { container } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(2));

    // 训练完成新 Attempt（同一严格组）：ledger 变更 → 分组/选择器重算
    await act(async () => {
      useExperimentStore.getState().registerExperiment(experiment('exp-c'));
      useExperimentStore.getState().registerAttempt(strictAttempt('attempt-c', 'exp-c', {
        learningRate: 0.1, ordinal: 3, values: [0.90, 0.94],
      }));
    });
    // 既有选择 [A,B] 仍合法 → 尊重用户选择，不强塞 C；但 C 必须出现在选择器
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(3));
    expect(chartPolylines(container)).toHaveLength(2);
    // 勾选 C → 图表/表格立即重算纳入第三条曲线（useMemo 依赖完整）
    const checkboxC = (screen.getAllByRole('checkbox') as HTMLInputElement[])
      .find(box => box.closest('label')?.textContent?.includes('exp-c'));
    fireEvent.click(checkboxC!);
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(3));
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('0.760000');
    expect(table).toHaveTextContent('0.880000');
    expect(table).toHaveTextContent('0.940000');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    // 三条曲线两两不同（各自数据源）
    const [p1, p2, p3] = chartPolylines(container);
    expect(new Set([p1, p2, p3]).size).toBe(3);
  });

  it('截图复现（M07-002~015）：单点 0.9527/0.9542 近重合——两个 marker 可区分、Tooltip 携真实身份与数值、差值/单点/单 seed 限制全部可见', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 与截图一致：同 seed 43、同严格组、各只有 1 个 validation/epoch 点
      useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
        learningRate: 0.001, ordinal: 1, seed: 43, values: [0.9542],
      }));
      useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
        learningRate: 0.01, ordinal: 2, seed: 43, values: [0.9527],
      }));
      const { container } = render(<ComparisonView study={STUDY} />);
      await waitFor(() => expect(container.querySelectorAll('[data-marker]')).toHaveLength(2));

      // 1) 两个点都存在且未被合并：data-y 为真实映射坐标（差异保留，不被吸合也不被夸大）
      const markers = [...container.querySelectorAll('[data-marker]')];
      expect(markers[0].getAttribute('data-marker')).toBe('attempt-a');
      expect(markers[1].getAttribute('data-marker')).toBe('attempt-b');
      const ya = Number(markers[0].getAttribute('data-y'));
      const yb = Number(markers[1].getAttribute('data-y'));
      expect(ya).not.toBe(yb);
      // 0.0015 在 0～1 全量尺度下≈ 0.26px：真实微小差异，未被人为放大
      expect(Math.abs(ya - yb)).toBeLessThan(1);

      // 2) Tooltip（悬停 title + 键盘 aria-label）携带完整身份（Experiment 名 + ordinal + ID 短码）、epoch、原始值、指标名与数据来源
      const labelA = markers[0].getAttribute('aria-label') ?? '';
      const labelB = markers[1].getAttribute('aria-label') ?? '';
      expect(labelA).toContain('Attempt #1');
      expect(labelA).toContain('…empt-a');
      expect(labelA).toContain('0.954200');
      expect(labelA).toContain('严格 validation/epoch');
      expect(labelA).toContain('epoch 1');
      expect(labelB).toContain('Attempt #2');
      expect(labelB).toContain('…empt-b');
      expect(labelB).toContain('0.952700');
      expect(markers[0].querySelector('title')?.textContent).toContain('0.954200');
      expect(markers[1].querySelector('title')?.textContent).toContain('0.952700');

      // 3) 近重合汇总：图表下方单行 HTML 文本（非 SVG 常驻标注，零遮挡）+ 真实差值
      expect(screen.getByText(/两条曲线在 1 个共享 epoch 上接近（最大真实差值 0\.001500）/)).toBeInTheDocument();
      // SVG 内部绝不常驻逐点数值标签（人工复测确认会互相覆盖遮挡曲线）
      const svgTexts = [...container.querySelectorAll('.comparison-view__chart svg[role="img"] text')].map(node => node.textContent ?? '');
      expect(svgTexts.some(text => /0\.95\d/.test(text))).toBe(false);

      // 4) 单点限制说明：不伪装成趋势
      expect(screen.getByText('单点严格序列：只能比较最终值')).toBeInTheDocument();
      expect(screen.getByText(/不能解读训练过程趋势/)).toBeInTheDocument();

      // 5) 最终指标表：各自数值 + 有效点数 + 真实差值（含百分点等价）
      const table = screen.getByRole('table');
      expect(table).toHaveTextContent('0.954200');
      expect(table).toHaveTextContent('0.952700');
      expect(table).toHaveTextContent('1 点');
      expect(table).toHaveTextContent('0.001500');
      expect(table).toHaveTextContent('0.15 个百分点');
      expect(table).toHaveTextContent('不构成趋势、稳定提升或因果结论');

      // 6) 单 seed 方差限制持续可见
      expect(screen.getByText('未验证方差（单 seed）')).toBeInTheDocument();

      // 7) 语言纪律：不得自动生成最佳/排名/因果结论（免责声明中的否定句“不构成稳定提升”是诚实披露，不在此列）
      expect(container.textContent).not.toContain('最佳方案');
      expect(container.textContent).not.toContain('因为该');
      expect(container.textContent).toContain('不构成趋势、稳定提升或因果结论');

      // 8) 单点不画趋势线；X 轴无幽灵刻度
      expect(chartPolylines(container)).toHaveLength(0);
      const tickTexts = [...container.querySelectorAll('.comparison-view__chart svg[role="img"] text')].map(node => node.textContent);
      expect(tickTexts).not.toContain('2');

      // 9) 无 duplicate key 等 React 错误
      expect(errorSpy.mock.calls.some(call => String(call[0]).includes('same key'))).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('人工复测场景：epoch 1～5 近值双曲线——零常驻数值标签、Tooltip 完整身份、图例短码消歧义、局部观察可逆且不篡改证据', async () => {
    // 两个不同 Experiment 的首个 Attempt（ordinal 同为 1）、同 seed 43、Accuracy 均存 0.94~0.96
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, seed: 43, values: [0.9410, 0.9455, 0.9480, 0.9510, 0.9542],
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 1, seed: 43, values: [0.9405, 0.9448, 0.9475, 0.9505, 0.9527],
    }));
    const eventsBefore = useExperimentStore.getState().ledger.events.length;
    const { container } = render(<ComparisonView study={STUDY} />);

    // 1) 两条独立 series，各自 5 个点（不共享 points 数组、不合并）
    await waitFor(() => expect(chartPolylines(container)).toHaveLength(2));
    for (const points of chartPolylines(container)) {
      expect(points.split(' ')).toHaveLength(5);
      const xs = points.split(' ').map(pair => Number(pair.split(',')[0]));
      expect([...xs].sort((left, right) => left - right)).toEqual(xs);
    }
    expect(chartPolylines(container)[0]).not.toBe(chartPolylines(container)[1]);

    // 2) SVG 内零常驻数值标签：只有轴刻度/轴标题，无任何 0.9x 数据值文本
    const svgTexts = [...container.querySelectorAll('.comparison-view__chart svg[role="img"] text')].map(node => node.textContent ?? '');
    expect(svgTexts.some(text => /0\.9\d/.test(text))).toBe(false);

    // 3) 10 个 marker；抽查首尾 Tooltip：完整身份 + epoch + 原始值 + 来源
    const markers = [...container.querySelectorAll('[data-marker]')];
    expect(markers).toHaveLength(10);
    const firstA = markers[0].getAttribute('aria-label') ?? '';
    const lastA = markers[4].getAttribute('aria-label') ?? '';
    const lastB = markers[9].getAttribute('aria-label') ?? '';
    expect(firstA).toContain('exp-a · Attempt #1 · …empt-a');
    expect(firstA).toContain('epoch 1');
    expect(firstA).toContain('0.941000');
    expect(lastA).toContain('epoch 5');
    expect(lastA).toContain('0.954200');
    expect(lastA).toContain('严格 validation/epoch');
    expect(lastB).toContain('exp-b · Attempt #1 · …empt-b');
    expect(lastB).toContain('0.952700');

    // 4) 图例：两个 Attempt 同为 #1 但身份唯一（Experiment 名 + ID 短码消歧义）
    const legend = container.querySelector('.comparison-view__legend');
    const legendItems = [...(legend?.querySelectorAll('span') ?? [])].map(node => node.textContent ?? '');
    expect(legendItems).toHaveLength(2);
    expect(legendItems[0]).toContain('exp-a · Attempt #1 · …empt-a');
    expect(legendItems[1]).toContain('exp-b · Attempt #1 · …empt-b');
    expect(legendItems[0]).not.toBe(legendItems[1]);

    // 5) 近重合汇总：5 个共享 epoch 接近，最大真实差值 0.001500（HTML 单行，零遮挡）
    expect(screen.getByText(/两条曲线在 5 个共享 epoch 上接近（最大真实差值 0\.001500）/)).toBeInTheDocument();

    // 6) 最终指标表：真实差值 + 有效点数 + 单 seed 方差限制持续可见
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('0.954200');
    expect(table).toHaveTextContent('0.952700');
    expect(table).toHaveTextContent('5 点');
    expect(table).toHaveTextContent('0.001500');
    expect(table).toHaveTextContent('0.15 个百分点');
    expect(screen.getByText('未验证方差（单 seed）')).toBeInTheDocument();

    // 7) 局部观察范围：显式切换 + 强制声明；放大后近值像素距离变大（可辨认）
    const yaFull = Number(markers[4].getAttribute('data-y'));
    const ybFull = Number(markers[9].getAttribute('data-y'));
    expect(Math.abs(yaFull - ybFull)).toBeLessThan(1);
    fireEvent.click(screen.getByRole('button', { name: '局部观察范围（查看近值差异）' }));
    expect(screen.getByText('Y 轴按当前观测范围放大，仅用于查看数值差异，不代表统计显著或稳定提升。')).toBeInTheDocument();
    const chartSvg = container.querySelector('.comparison-view__chart svg[role="img"]');
    expect(chartSvg?.getAttribute('aria-label')).toContain('局部观察范围（已放大）');
    const markersZoomed = [...container.querySelectorAll('[data-marker]')];
    expect(markersZoomed).toHaveLength(10);
    const yaZoom = Number(markersZoomed[4].getAttribute('data-y'));
    const ybZoom = Number(markersZoomed[9].getAttribute('data-y'));
    expect(Math.abs(yaZoom - ybZoom)).toBeGreaterThan(5);
    // 原始点未被修改：每条 series 仍 5 个点，坐标只来自尺度映射变化
    for (const points of chartPolylines(container)) {
      expect(points.split(' ')).toHaveLength(5);
    }
    // 局部观察不产生任何审计/候选/结论状态：零事件写入、无 override
    expect(useExperimentStore.getState().ledger.events).toHaveLength(eventsBefore);
    expect(useExperimentStore.getState().ledger.events.some(event => event.eventType === 'comparison_override')).toBe(false);
    // 8) 可逆：返回全量尺度后声明消失、诚实语义恢复
    fireEvent.click(screen.getByRole('button', { name: '返回全量尺度（0～1 诚实语义）' }));
    expect(screen.queryByText(/不代表统计显著或稳定提升/)).not.toBeInTheDocument();
    expect(container.querySelector('.comparison-view__chart svg[role="img"]')?.getAttribute('aria-label')).toContain('0～1 全量尺度');
  });

  it('单点 + 更高的 train/batch 尾项：图表与摘要只用 validation/epoch 点', async () => {
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.85], trainBatchTail: 0.99,
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [0.86], trainBatchTail: 0.995,
    }));
    const { container } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(container.querySelectorAll('[data-marker]')).toHaveLength(2));
    expect(chartPolylines(container)).toHaveLength(0);
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('0.850000');
    expect(table).toHaveTextContent('0.860000');
    expect(table).not.toHaveTextContent('0.990000');
    expect(table).not.toHaveTextContent('0.995000');
    const labels = [...container.querySelectorAll('[data-marker]')].map(node => node.getAttribute('aria-label') ?? '');
    expect(labels.join('')).not.toContain('0.990000');
  });

  it('空态矩阵：未选够/无严格指标/不可比三种状态给出不同的诚实解释', async () => {
    // 状态 1：只有一条合法 Attempt → 默认单选 → 提示至少选两条
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.8],
    }));
    const view1 = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(screen.getByText('至少选择两个 Attempt 才能对比。')).toBeInTheDocument());
    expect(document.querySelector('[data-marker]')).toBeNull();
    view1.unmount();

    // 状态 2：两条都无严格指标 → 手动勾选后解释“没有共同严格指标”，不空白
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(experiment('exp-a'));
    useExperimentStore.getState().registerExperiment(experiment('exp-b'));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [],
      rawMetrics: [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.8, timestamp: 1 }],
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [],
      rawMetrics: [{ epoch: 1, step: 1, loss: 0.3, accuracy: 0.9, timestamp: 1 }],
    }));
    const view2 = render(<ComparisonView study={STUDY} />);
    let boxes = await screen.findAllByRole('checkbox');
    boxes.forEach(box => {
      if (!(box as HTMLInputElement).checked && !(box as HTMLInputElement).disabled) fireEvent.click(box);
    });
    await waitFor(() => expect(screen.getByText('没有可共同严格展示的指标')).toBeInTheDocument());
    expect(document.querySelector('[data-marker]')).toBeNull();
    view2.unmount();

    // 状态 3：两条分属不同切分（不可比）→ 阻止跨组叠加并说明原因，只有显式 override 入口
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(experiment('exp-a'));
    useExperimentStore.getState().registerExperiment(experiment('exp-b'));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: [0.8],
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: [0.9], splitHash: 'sha256:split-b',
    }));
    render(<ComparisonView study={STUDY} />);
    boxes = await screen.findAllByRole('checkbox');
    boxes.forEach(box => {
      if (!(box as HTMLInputElement).checked && !(box as HTMLInputElement).disabled) fireEvent.click(box);
    });
    await waitFor(() => expect(screen.getByText('已阻止跨组叠加')).toBeInTheDocument());
    expect(screen.getByText(/验证\/测试集切分不同/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '仍然对比（带水印）' })).toBeInTheDocument();
    expect(document.querySelector('[data-marker]')).toBeNull();
  });
});

describe('ComparisonChartBoundary：渲染错误与“没有严格数据”必须可区分', () => {
  it('捕获渲染异常并显示诚实说明（不静默空白，不混淆为无数据）', () => {
    function Bomb(): JSX.Element {
      throw new Error('合成渲染崩溃');
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = render(<ComparisonChartBoundary><Bomb /></ComparisonChartBoundary>);
      expect(container.textContent).toContain('图表渲染发生错误');
      expect(container.textContent).toContain('这是渲染失败，不是“没有严格数据”');
      expect(container.textContent).toContain('合成渲染崩溃');
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('对比图布局 CSS 契约（人工复测修复：图例数百像素垂直空白）', () => {
  it('主图 svg 选择器限定直接子级不泄漏到图例色块；图例紧凑换行不撑满高度', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf-8');
    // 旧泄漏选择器 `.comparison-view__chart svg {` 必须不存在（它会把图例小 svg 撑到 width:100% + min-height:170px）
    expect(css).not.toMatch(/\.comparison-view__chart svg \{/);
    expect(css).toContain('.comparison-view__chart > svg');
    // 图例小 svg 固定小尺寸，min-height 归零，防御未来宽泛选择器再次泄漏
    expect(css).toMatch(/\.comparison-view__legend svg \{[^}]*width: 30px[^}]*min-height: 0/);
    // 图例容器：紧凑换行；绝不使用 space-between / 100% 高度 / 撑满父容器
    const legendRule = /\.comparison-view__legend \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(legendRule).toContain('flex-wrap: wrap');
    expect(legendRule).toContain('align-content: flex-start');
    expect(legendRule).not.toContain('space-between');
    expect(legendRule).not.toContain('height: 100%');
    expect(legendRule).not.toContain('flex: 1');
  });
});

/* ---------------- R2：对比区「如何比较」静态说明接线 ---------------- */

/**
 * 说明入口只是宿主里的静态文案折叠区：它接的是真实 ComparisonView（不 mock 子组件），
 * 展开前后选择、指标、曲线几何、表格数值、水印、方差徽章与提醒必须逐字段不变，
 * 也不能替代非严格对比的显式确认与留痕。
 */
describe('对比区「如何比较」接线（R2）', () => {
  beforeEach(() => {
    useExperimentStore.getState().resetLedgerForTests();
    useExperimentStore.getState().registerStudy(STUDY);
    useExperimentStore.getState().registerExperiment(experiment('exp-a'));
    useExperimentStore.getState().registerExperiment(experiment('exp-b'));
    useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
    useExperimentStore.getState().setActiveStudy(STUDY.id);
  });

  function registerStrictPair(first: number[], second: number[]): void {
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-a', 'exp-a', {
      learningRate: 0.001, ordinal: 1, values: first,
    }));
    useExperimentStore.getState().registerAttempt(strictAttempt('attempt-b', 'exp-b', {
      learningRate: 0.01, ordinal: 2, values: second,
    }));
  }

  /** 非严格夹具：切分哈希不同，必须显式确认并留痕后才允许带水印展示。 */
  function registerNonStrictPair(): void {
    useExperimentStore.getState().registerAttempt(attempt('attempt-a', 'exp-a', 'sha256:split-a'));
    useExperimentStore.getState().registerAttempt(attempt('attempt-b', 'exp-b', 'sha256:split-b'));
  }

  function guide(root: HTMLElement): HTMLElement | null {
    return root.querySelector('[data-testid="result-reading-guide"]');
  }

  function toggle(root: HTMLElement): HTMLElement {
    const element = root.querySelector<HTMLElement>('[data-testid="result-reading-guide-toggle"]');
    if (!element) throw new Error('「如何比较」入口必须渲染在对比区内');
    return element;
  }

  function bodyOf(root: HTMLElement): string {
    return root.querySelector('[data-testid="result-reading-guide-body"]')?.textContent ?? '';
  }

  /** 对比区里所有由业务状态决定的展示；说明区自身不在其中。 */
  function displaySnapshot(root: HTMLElement) {
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    return {
      polylines: [...root.querySelectorAll('svg[role="img"] polyline')].map(node => node.getAttribute('points')),
      markers: [...root.querySelectorAll('[data-marker]')].map(node => (
        `${node.getAttribute('data-marker')}@${node.getAttribute('data-x')},${node.getAttribute('data-y')}`
      )),
      svgTexts: [...root.querySelectorAll('svg[role="img"] text')].map(node => node.textContent),
      legend: root.querySelector('.comparison-view__legend')?.textContent ?? null,
      tables: [...root.querySelectorAll('.comparison-view__table')].map(node => node.textContent),
      variance: root.querySelector('.comparison-view__variance')?.textContent ?? null,
      zoomPressed: root.querySelector('.comparison-view__zoom-toggle')?.getAttribute('aria-pressed') ?? null,
      zoomLabel: root.querySelector('.comparison-view__zoom-toggle')?.textContent ?? null,
      zoomDisclaimer: root.querySelector('.comparison-view__zoom-disclaimer')?.textContent ?? null,
      alerts: [...root.querySelectorAll('.nb-alert')].map(node => node.textContent),
      watermark: (root.textContent ?? '').includes('非严格可比：此水印会进入导出报告。'),
      overrideButtons: [...root.querySelectorAll('button')]
        .filter(node => (node.textContent ?? '').includes('仍然对比'))
        .map(node => `${node.textContent}|disabled=${node.hasAttribute('disabled')}`),
      checkedCount: boxes.filter(box => box.checked).length,
      metricChoice: (document.getElementById('comparison-metric-select') as HTMLSelectElement | null)?.value ?? null,
      observation: root.querySelector('.comparison-view__observation')?.textContent ?? null,
      ablation: root.querySelector('.comparison-view__ablation')?.textContent ?? null,
    };
  }

  function ledgerSnapshot(): string {
    return JSON.stringify(useExperimentStore.getState().ledger);
  }

  function storageSnapshot(): Record<string, string> {
    const entries: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key !== null) entries[key] = window.localStorage.getItem(key) ?? '';
    }
    return entries;
  }

  it('入口接在真实组合层：默认收起、标签固定、位于曲线分支之后与方差徽章之前', async () => {
    registerStrictPair([0.72, 0.76], [0.84, 0.88]);
    const { container } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(container.querySelectorAll('svg[role="img"] polyline')).toHaveLength(2));
    const root = container.querySelector<HTMLElement>('.comparison-view');
    expect(root).not.toBeNull();

    // 直接子级挂载：不在图表容器内部，也不在任何 SVG 里
    const entry = container.querySelector<HTMLElement>('.comparison-view > [data-testid="result-reading-guide"]');
    expect(entry).not.toBeNull();
    expect(entry?.closest('svg')).toBeNull();
    expect(toggle(root!).textContent).toBe('▶ 如何比较');
    expect(guide(root!)?.getAttribute('data-testid')).toBe('result-reading-guide');
    expect(bodyOf(root!)).toBe('');

    const chart = root!.querySelector('.comparison-view__chart');
    const variance = root!.querySelector('.comparison-view__variance');
    expect(chart).not.toBeNull();
    expect(variance).not.toBeNull();
    expect(chart!.compareDocumentPosition(entry!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(entry!.compareDocumentPosition(variance!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('展开与收起都不触碰选择、指标、几何、表格、水印与徽章', async () => {
    registerStrictPair([0.72, 0.76], [0.84, 0.88]);
    const { container } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(container.querySelectorAll('svg[role="img"] polyline')).toHaveLength(2));
    const root = container.querySelector<HTMLElement>('.comparison-view')!;
    const ledgerBefore = ledgerSnapshot();
    const before = displaySnapshot(root);

    fireEvent.click(toggle(root));
    expect(toggle(root).textContent).toBe('▼ 如何比较');
    expect(displaySnapshot(root)).toEqual(before);
    expect(ledgerSnapshot()).toBe(ledgerBefore);

    fireEvent.click(toggle(root));
    expect(toggle(root).textContent).toBe('▶ 如何比较');
    expect(displaySnapshot(root)).toEqual(before);
    expect(ledgerSnapshot()).toBe(ledgerBefore);
    expect(bodyOf(root)).toBe('');
  });

  it('主题就是静态分组，正文来自共享来源（宿主不留第二份副本）', async () => {
    registerStrictPair([0.72, 0.76], [0.84, 0.88]);
    const { container } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(container.querySelectorAll('svg[role="img"] polyline')).toHaveLength(2));
    const root = container.querySelector<HTMLElement>('.comparison-view')!;
    fireEvent.click(toggle(root));
    const items = [...root.querySelectorAll('[data-testid^="result-reading-topic-"]')];
    expect(items.map(item => item.getAttribute('data-testid')))
      .toEqual(COMPARISON_READING_TOPIC_IDS.map(id => `result-reading-topic-${id}`));
    expect(bodyOf(root)).toContain(RESULT_READING_TOPICS.chart_value_unit.text);

    const probe = 'SHARED_R2_COMPARISON_PROBE';
    const original = RESULT_READING_TOPICS.comparison_seed_variance.text;
    RESULT_READING_TOPICS.comparison_seed_variance.text = probe;
    try {
      fireEvent.click(toggle(root));
      expect(bodyOf(root)).toBe('');
      fireEvent.click(toggle(root));
      expect(bodyOf(root)).toContain(probe);
      expect(bodyOf(root)).not.toContain(original);
    } finally {
      RESULT_READING_TOPICS.comparison_seed_variance.text = original;
    }
    fireEvent.click(toggle(root));
    fireEvent.click(toggle(root));
    expect(bodyOf(root)).toContain(original);
  });

  it('未选够实验时只提供通用说明，不暗示比较已获批准', async () => {
    registerStrictPair([0.72, 0.76], [0.84, 0.88]);
    const { container } = render(<ComparisonView study={STUDY} />);
    await waitFor(() => expect(container.querySelectorAll('svg[role="img"] polyline')).toHaveLength(2));
    const root = container.querySelector<HTMLElement>('.comparison-view')!;

    // 取消一个 Attempt → mayRender 失败关闭：图表与表格整体消失
    const checkboxA = (screen.getAllByRole('checkbox') as HTMLInputElement[])
      .find(box => box.closest('label')?.textContent?.includes('exp-a'));
    expect(checkboxA).toBeDefined();
    fireEvent.click(checkboxA!);
    await waitFor(() => expect(container.querySelector('.comparison-view__chart')).toBeNull());
    expect(container.querySelector('.comparison-view__table')).toBeNull();

    const entry = container.querySelector('.comparison-view > [data-testid="result-reading-guide"]');
    expect(entry).not.toBeNull();
    fireEvent.click(toggle(root));
    const text = bodyOf(root);
    expect(text).toContain(RESULT_READING_TOPICS.comparison_strictness_limits.text);
    for (const hint of ['已获批准', '可以排名', '允许展示', '无需确认', '比较已通过']) {
      expect(text, `说明暗示了比较资格：${hint}`).not.toContain(hint);
    }
  });

  it('非严格对比仍被阻止：展开说明不生成确认、不写事件、不解水印', async () => {
    registerNonStrictPair();
    const { container } = render(<ComparisonView study={STUDY} />);
    const checkboxes = await screen.findAllByRole('checkbox');
    checkboxes.forEach(box => {
      const input = box as HTMLInputElement;
      if (!input.checked && !input.disabled) fireEvent.click(input);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '仍然对比（带水印）' })).toBeInTheDocument());
    const root = container.querySelector<HTMLElement>('.comparison-view')!;
    const eventsBefore = useExperimentStore.getState().ledger.events.length;

    fireEvent.click(toggle(root));
    expect(bodyOf(root)).toContain('这段解释不能解除限制，也不能替代显式确认与永久留痕');
    expect(screen.queryByRole('alertdialog', { name: '确认进行非严格对比？' })).not.toBeInTheDocument();
    expect((root.textContent ?? '')).not.toContain('非严格可比：此水印会进入导出报告。');
    expect(useExperimentStore.getState().ledger.events.length).toBe(eventsBefore);

    // 唯一入口仍是显式确认；展开说明没有把它变成自动生效
    fireEvent.click(screen.getByRole('button', { name: '仍然对比（带水印）' }));
    expect(screen.getByRole('alertdialog', { name: '确认进行非严格对比？' })).toBeInTheDocument();
    expect(useExperimentStore.getState().ledger.events.length).toBe(eventsBefore);
  });

  it('单点提醒与放大声明保持原位：不被搬进折叠区，也不因展开而隐藏', async () => {
    registerStrictPair([0.8], [0.9]);
    const { container } = render(<ComparisonView study={STUDY} />);
    const root = container.querySelector<HTMLElement>('.comparison-view')!;
    // 折叠状态下必须已经可见（说明区不是这些强制提醒的容器）
    await waitFor(() => expect(screen.getByText('单点严格序列：只能比较最终值')).toBeInTheDocument());
    expect(bodyOf(root)).toBe('');

    fireEvent.click(toggle(root));
    expect(screen.getByText('单点严格序列：只能比较最终值')).toBeInTheDocument();
    expect(bodyOf(root)).not.toContain('单点严格序列：只能比较最终值');
    // 折叠区展开不改变单点几何：仍然只有 marker，没有 polyline
    expect(root.querySelectorAll('svg[role="img"] polyline')).toHaveLength(0);
    expect(root.querySelectorAll('[data-marker]')).toHaveLength(2);

    // 局部放大是独立开关：展开/收起说明不改变它的状态与声明
    const zoom = root.querySelector<HTMLElement>('.comparison-view__zoom-toggle')!;
    fireEvent.click(zoom);
    const pressedBefore = zoom.getAttribute('aria-pressed');
    const disclaimerBefore = root.querySelector('.comparison-view__zoom-disclaimer')?.textContent ?? null;
    expect(disclaimerBefore).toContain('不代表统计显著或稳定提升');
    fireEvent.click(toggle(root));
    fireEvent.click(toggle(root));
    expect(zoom.getAttribute('aria-pressed')).toBe(pressedBefore);
    expect(root.querySelector('.comparison-view__zoom-disclaimer')?.textContent).toBe(disclaimerBefore);
  });

  it('说明交互零副作用：ledger、事件、存储与后端调用一律不变', async () => {
    const invoke = vi.fn(() => {
      throw new Error('对比区说明不得调用 Tauri 后端');
    });
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() => {
      throw new Error('对比区说明不得发起网络请求');
    });
    const target = window as unknown as Record<string, unknown>;
    // setup.ts 定义成 writable 但非 configurable，只能赋值注入探针
    target.__TAURI_INTERNALS__ = { invoke };
    target.__TAURI__ = { invoke };
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    try {
      registerStrictPair([0.72, 0.76], [0.84, 0.88]);
      const { container } = render(<ComparisonView study={STUDY} />);
      await waitFor(() => expect(container.querySelectorAll('svg[role="img"] polyline')).toHaveLength(2));
      const root = container.querySelector<HTMLElement>('.comparison-view')!;
      const ledgerBefore = ledgerSnapshot();
      const storageBefore = storageSnapshot();
      // persist 中间件在夹具注册阶段就写过存储：只要求说明交互本身不再追加任何写入
      const writesBeforeClicks = setItem.mock.calls.length;

      for (let round = 0; round < 4; round += 1) fireEvent.click(toggle(root));

      expect(ledgerSnapshot()).toBe(ledgerBefore);
      expect(storageSnapshot()).toEqual(storageBefore);
      expect(setItem.mock.calls.length).toBe(writesBeforeClicks);
      expect(invoke).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(toggle(root).textContent).toBe('▶ 如何比较');
    } finally {
      target.__TAURI_INTERNALS__ = undefined;
      target.__TAURI__ = undefined;
      setItem.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});

