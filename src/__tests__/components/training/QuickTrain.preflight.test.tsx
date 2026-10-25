import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickTrain from '@/components/training/QuickTrain';
import { startTrainingRun } from '@/trainingRuntime';
import { useLayerStore } from '@/stores/useLayerStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { useGPUStore } from '@/stores/useGPUStore';
import type { TrainConfig } from '@/types/training';

vi.mock('@/trainingRuntime', () => ({
  startTrainingRun: vi.fn(),
}));

const mockStart = vi.mocked(startTrainingRun);

function setupReadyScene() {
  useLayerStore.getState().addClassicModel([
    { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
    { type: 'Flatten', params: {} },
    { type: 'Linear', params: { inFeatures: 784, outFeatures: 10 } },
  ]);
  useDatasetStore.getState().setDataset({ name: 'MNIST', type: 'mnist', sampleCount: 70000, classCount: 10 });
}

describe('QuickTrain 统一训练前检查集成', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockStart.mockResolvedValue(true);
    useLayerStore.getState().clearAllLayers();
    useDatasetStore.getState().clearDataset();
    useTrainingStore.setState({
      isTraining: false,
      isPaused: false,
      status: 'idle',
      error: null,
      errorKind: null,
      activeRunId: null,
      activeAttemptId: null,
    });
    useGPUStore.setState({
      devices: [],
      selectedDevice: 'cpu',
      runtimeInfo: null,
      runtimeChecking: false,
      runtimeError: null,
    });
  });

  it('15. blocker 存在时不调用 startTrainingRun，展开面板并聚焦首个阻断项', () => {
    // 无数据集 → data_missing 阻断
    useLayerStore.getState().addClassicModel([
      { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
    ]);
    render(<QuickTrain />);
    fireEvent.click(screen.getByTestId('start-train-btn'));
    expect(mockStart).not.toHaveBeenCalled();
    expect(screen.getByTestId('preflight-list')).toBeInTheDocument();
    const list = screen.getByTestId('preflight-list');
    expect(list.contains(document.activeElement)).toBe(true);
  });

  it('16. ready 时调用 startTrainingRun 一次，且配置复用检查的 derived 结果', async () => {
    setupReadyScene();
    render(<QuickTrain />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-train-btn'));
      await Promise.resolve();
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    const config = mockStart.mock.calls[0][0] as TrainConfig;
    // derived.inputShape 来自 Input 层；MNIST 使用 predefined 切分语义
    expect(config.inputShape).toEqual([1, 28, 28]);
    expect(config.splitStrategy).toBe('predefined');
    expect(config.modelId).toBeTruthy();
    expect(config.featureFields).toBeUndefined();
    expect(config.device).toBe('cpu');
  });

  it('17-18. 快速双击只调用一次；异步准备未返回期间第二次点击无效', async () => {
    setupReadyScene();
    let release: (value: boolean) => void = () => {};
    mockStart.mockReturnValue(new Promise<boolean>(resolve => { release = resolve; }));
    render(<QuickTrain />);
    const button = screen.getByTestId('start-train-btn');
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    // 准备期间按钮处于 loading（原生禁用）
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('正在准备训练…');
    await act(async () => {
      release(true);
      await Promise.resolve();
    });
  });

  it('19-20. 启动失败后释放锁，且可以再次尝试', async () => {
    setupReadyScene();
    mockStart.mockRejectedValueOnce(new Error('prepare failed'));
    render(<QuickTrain />);
    const button = screen.getByTestId('start-train-btn');
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    // 失败后锁释放、按钮恢复可点击（异步，等待状态提交）
    await waitFor(() => expect(screen.getByTestId('start-train-btn')).not.toBeDisabled());
    await waitFor(() => expect(screen.getByTestId('start-train-btn')).toHaveTextContent('🚀 开始训练'));
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  it('21. startTrainingRun 返回 false 后，面板展示 store 中真实的 preflight 错误', async () => {
    setupReadyScene();
    mockStart.mockImplementationOnce(() => {
      useTrainingStore.getState().setPreflightError('Study GPU 时间预算已耗尽');
      return Promise.resolve(false);
    });
    render(<QuickTrain />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-train-btn'));
      await Promise.resolve();
    });
    // 标题明确写“上一次”，避免误认为当前实时检查结果；详情与训练监控同源
    expect(screen.getByText('上一次启动阶段最终检查未通过')).toBeInTheDocument();
    expect(screen.getByText(/Study GPU 时间预算已耗尽/)).toBeInTheDocument();
  });

  it('22. 同一错误与训练监控同源（均来自 useTrainingStore.error）', () => {
    setupReadyScene();
    useTrainingStore.setState({ error: '当前数据、切分或预处理与活动 Study 不一致', errorKind: 'preflight', status: 'error' });
    render(<QuickTrain />);
    // 面板展示 store 中的真实错误文本（训练监控亦渲染同一 store 字段）
    expect(screen.getByText(/当前数据、切分或预处理与活动 Study 不一致/)).toBeInTheDocument();
  });

  it('23. 历史 preflight 错误不永久阻止重试：实时条件满足仍可启动', async () => {
    setupReadyScene();
    useTrainingStore.setState({ error: '上一次启动失败的遗留错误', errorKind: 'preflight', status: 'error' });
    render(<QuickTrain />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-train-btn'));
      await Promise.resolve();
    });
    // 历史错误不影响实时 canStart：仍会尝试启动
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('30. startTrainingRun 意外 throw：错误进入训练 store，面板与监控同源展示，无本地 hint 旁路', async () => {
    setupReadyScene();
    mockStart.mockRejectedValueOnce(new Error('配置构建意外崩溃'));
    render(<QuickTrain />);
    // 异步拒绝引发的状态更新包裹在 act 中，避免 act 警告
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-train-btn'));
      await Promise.resolve();
    });

    // 错误通过既有入口进入训练 store（保留原始原因）
    await waitFor(() => expect(useTrainingStore.getState().error).toContain('启动训练时发生意外错误'));
    expect(useTrainingStore.getState().error).toContain('配置构建意外崩溃');
    expect(useTrainingStore.getState().errorKind).toBe('preflight');

    // 面板同源展示（训练监控亦渲染同一 store 字段）；不再出现本地 hint
    expect(screen.getByText('上一次启动阶段最终检查未通过')).toBeInTheDocument();
    expect(screen.getByText(/配置构建意外崩溃/)).toBeInTheDocument();
    expect(screen.queryByText(/启动训练失败：/)).not.toBeInTheDocument();

    // 失败后重入锁释放，可再次启动；历史错误不改变实时 canStart
    await waitFor(() => expect(screen.getByTestId('start-train-btn')).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-train-btn'));
      await Promise.resolve();
    });
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  it('24. 修改输入后实时检查立即更新', () => {
    setupReadyScene();
    const { container } = render(<QuickTrain />);
    const summary = container.querySelector('[data-status]');
    expect(summary).not.toBeNull();
    expect(summary?.getAttribute('data-status')).not.toBe('blocked');

    fireEvent.change(screen.getByTestId('epoch-input'), { target: { value: '0' } });
    expect(summary?.getAttribute('data-status')).toBe('blocked');
  });

  it('25. 检查更新不会自动抢焦点', () => {
    setupReadyScene();
    render(<QuickTrain />);
    fireEvent.change(screen.getByTestId('epoch-input'), { target: { value: '0' } });
    expect(document.activeElement).toBe(document.body);
  });

  it('26. 点击训练参数问题聚焦对应字段（epochs 可见字段）', () => {
    setupReadyScene();
    render(<QuickTrain />);
    fireEvent.change(screen.getByTestId('epoch-input'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('preflight-toggle'));
    const rows = screen.getAllByText('去处理');
    fireEvent.click(rows[0]);
    expect(document.activeElement).toBe(screen.getByTestId('epoch-input'));
  });

  it('27. 高级参数隐藏时：先展开高级区，再聚焦真实字段', () => {
    setupReadyScene();
    render(<QuickTrain />);
    // 打开高级区，制造非法 valSplit：
    // happy-dom 会按 range 的 min/max 钳制 value，这里用属性覆写绕过钳制以验证机制分支。
    fireEvent.click(screen.getByTestId('advanced-btn'));
    const slider = screen.getByTestId('valsplit-slider');
    Object.defineProperty(slider, 'value', { configurable: true, value: '0.9' });
    fireEvent.change(slider);
    // 收起高级区：问题仍在统一面板中（验证集滑块已不在 DOM）
    fireEvent.click(screen.getByTestId('advanced-btn'));
    expect(screen.queryByTestId('valsplit-slider')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('preflight-toggle'));
    const rows = screen.getAllByText('去处理');
    fireEvent.click(rows[0]);
    // 高级区重新展开且焦点落在验证集滑块上（下一次提交后聚焦真实字段）
    const reopenedSlider = screen.getByTestId('valsplit-slider');
    expect(document.activeElement).toBe(reopenedSlider);
  });

  it('28. 点击 layer 问题只选择层并打开参数面板，不改层参数', () => {
    // Linear inFeatures 与上游不匹配 → 带 layerId 的形状错误
    useLayerStore.getState().addClassicModel([
      { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
      { type: 'Flatten', params: {} },
      { type: 'Linear', params: { inFeatures: 128, outFeatures: 10 } },
    ]);
    useDatasetStore.getState().setDataset({ name: 'MNIST', type: 'mnist', sampleCount: 70000, classCount: 10 });
    const onNavigatePanel = vi.fn();
    render(<QuickTrain onNavigatePanel={onNavigatePanel} />);

    const linearLayer = useLayerStore.getState().layers.find(layer => layer.type === 'Linear');
    expect(linearLayer).toBeTruthy();
    const paramsBefore = JSON.stringify(linearLayer?.params);

    fireEvent.click(screen.getByTestId('preflight-toggle'));
    const rows = screen.getAllByText('去处理');
    // 找到模型形状错误对应的行（target 为 layer）
    fireEvent.click(rows[rows.length - 1]);

    expect(useLayerStore.getState().selectedId).toBe(linearLayer?.id);
    expect(onNavigatePanel).toHaveBeenCalledWith('param');
    // 层参数不得被修改
    const paramsAfter = JSON.stringify(useLayerStore.getState().layers.find(layer => layer.type === 'Linear')?.params);
    expect(paramsAfter).toBe(paramsBefore);
  });

  it('29. 点击数据问题打开 dataset 面板', () => {
    useLayerStore.getState().addClassicModel([
      { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
    ]);
    const onNavigatePanel = vi.fn();
    render(<QuickTrain onNavigatePanel={onNavigatePanel} />);
    fireEvent.click(screen.getByTestId('preflight-toggle'));
    fireEvent.click(screen.getAllByText('去处理')[0]);
    expect(onNavigatePanel).toHaveBeenCalledWith('dataset');
  });
});
