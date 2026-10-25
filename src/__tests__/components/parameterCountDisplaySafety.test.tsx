/**
 * N4 参数量展示与 3D 几何安全的组件测试。
 * 证据边界：happy-dom 里 RoundedBox / Html / Text 都是替身，本文件证明的是
 * 「组件把什么数值交给几何 props、渲染什么文字、是否改写 store 记录」，
 * 不构成真实 WebGL 几何构建或桌面渲染验收；那部分属于人工复测范围。
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { forwardRef, type MouseEventHandler, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Layer3DBlock from '@/components/scene3d/Layer3DBlock';
import ShapeTooltip from '@/components/scene3d/ShapeTooltip';
import SceneStats from '@/components/scene3d/SceneStats';
import QuickTrain from '@/components/training/QuickTrain';
import TrainResultModal from '@/components/training/TrainResultModal';
import NetworkStructureOverview from '@/components/panels/network/NetworkStructureOverview';
import { useLayerStore } from '@/stores/useLayerStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import type { Layer3D, LayerParams, LayerType, TensorShape } from '@/types/layer';
import { BLOCK_HEIGHT } from '@/types/layer';
import type { TrainRecord } from '@/types/training';
import {
  PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH,
  paramCountToBlockWidth,
} from '@/utils/parameterCountPresentation';

const capture = vi.hoisted(() => ({ roundedBoxArgs: [] as unknown[] }));

type BlockMockProps = {
  args?: unknown;
  onClick?: (event: { stopPropagation(): void; nativeEvent: MouseEvent }) => void;
  onContextMenu?: (event: { stopPropagation(): void; nativeEvent: MouseEvent }) => void;
};

vi.mock('@react-three/drei', () => ({
  RoundedBox: forwardRef<HTMLDivElement, BlockMockProps>((props, ref) => {
    capture.roundedBoxArgs.push(props.args);
    // 不渲染 children：真实子节点是 meshStandardMaterial，在 happy-dom 里是无标签元素。
    // 事件透传：本文件要验证「交互发生后记录仍不变」。
    return (
      <div
        ref={ref}
        data-testid="rounded-box"
        onClick={props.onClick as unknown as MouseEventHandler<HTMLDivElement>}
        onContextMenu={props.onContextMenu as unknown as MouseEventHandler<HTMLDivElement>}
      />
    );
  }),
  Text: ({ children }: { children?: ReactNode }) => <div data-testid="mock-text">{children}</div>,
  Html: ({ children }: { children?: ReactNode }) => <div data-testid="mock-html">{children}</div>,
}));

vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }));
vi.mock('@/trainingRuntime', () => ({ startTrainingRun: vi.fn() }));

function draftLayer(
  id: string,
  type: LayerType,
  paramCount: unknown,
  outputShape: TensorShape | null = null,
  params: LayerParams = {},
  order = 0,
): Layer3D {
  return {
    id,
    type,
    params,
    order,
    position: [0, order, 0],
    outputShape,
    paramCount: paramCount as number,
    validationError: null,
  };
}

/** 合法但参数缺失的层：走真实 store 推导链，参数量由既有公式产生（Linear 784→10 = 7850）。 */
function seedLegalNetwork() {
  act(() => {
    useLayerStore.getState().addClassicModel([
      { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
      { type: 'Flatten', params: {} },
      { type: 'Linear', params: { inFeatures: 784, outFeatures: 10 } },
    ]);
  });
}

/** 走真实推导链产生「非法参数 → NaN 参数量 + NaN 总量」的既成记录（N3 之后的行为）。 */
function seedIllegalConv() {
  act(() => {
    useLayerStore.getState().setLayers([
      draftLayer('input-1', 'Input', 0, [1, 28, 28], { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
      draftLayer('conv-1', 'Conv2D', 0, null, {
        inChannels: 1, outChannels: 8, kernelSize: 'three' as unknown as number, stride: 1, padding: 1,
      }, 1),
    ]);
  });
}

/** 展示层不得改写记录：NaN 用标记位表达，其余字段逐一比较。 */
function layerRecordSnapshot(layer: Layer3D) {
  return {
    id: layer.id,
    type: layer.type,
    params: { ...layer.params },
    order: layer.order,
    position: [...layer.position],
    outputShape: layer.outputShape === null ? null : [...layer.outputShape],
    paramCountIsNaN: Number.isNaN(layer.paramCount),
    paramCountText: String(layer.paramCount),
    validationError: layer.validationError,
  };
}

function storeSnapshot() {
  const state = useLayerStore.getState();
  return {
    layers: state.layers.map(layerRecordSnapshot),
    totalParamsIsNaN: Number.isNaN(state.totalParams),
    totalParamsText: String(state.totalParams),
    hasShapeError: state.hasShapeError,
    errorCount: state.validationResult.errors.length,
  };
}

beforeEach(() => {
  capture.roundedBoxArgs.length = 0;
  localStorage.clear();
  useLayerStore.setState({ ...useLayerStore.getInitialState() });
  useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
  useTrainingStore.setState({
    status: 'idle',
    history: [],
    lastAttemptId: null,
    executionMode: null,
    metrics: [],
    finalMetricName: null,
    finalAccuracy: null,
    totalEpochs: 0,
  });
});

describe('Layer3DBlock：参数量到宽度的安全映射', () => {
  it('合法参数量的宽度沿用原公式，不因接入共享规则而改变', () => {
    for (const paramCount of [0, 1, 448, 896, 7850, 1_000_000]) {
      capture.roundedBoxArgs.length = 0;
      render(<Layer3DBlock layer={draftLayer('conv-legal', 'Conv2D', paramCount)} />);
      const args = capture.roundedBoxArgs[0] as [number, number, number];
      expect(args[0], `paramCount=${paramCount}`).toBe(Math.max(1, Math.log2(paramCount + 1) * 0.3 + 1));
      expect(args[0]).toBe(paramCountToBlockWidth(paramCount));
      expect(args[1]).toBe(BLOCK_HEIGHT);
    }
  });

  it('非法参数量只得到有限正数占位宽度，NaN 不进入 RoundedBox 实际接收的 args', () => {
    const illegal: unknown[] = [
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5, undefined, '12', 2 ** 53,
    ];
    for (const paramCount of illegal) {
      capture.roundedBoxArgs.length = 0;
      render(<Layer3DBlock layer={draftLayer('conv-bad', 'Conv2D', paramCount)} />);
      const args = capture.roundedBoxArgs[0] as [number, number, number];
      expect(args, `paramCount=${String(paramCount)}`).toHaveLength(3);
      for (const value of args) {
        expect(typeof value, `paramCount=${String(paramCount)}`).toBe('number');
        expect(Number.isFinite(value), `paramCount=${String(paramCount)}`).toBe(true);
        expect(value > 0, `paramCount=${String(paramCount)}`).toBe(true);
      }
      expect(args[0], `paramCount=${String(paramCount)}`).toBe(PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH);
    }
  });

  it('占位宽度不等于 0 参数积木的宽度：视觉兜底不会被看成「参数量为 0」', () => {
    capture.roundedBoxArgs.length = 0;
    render(<Layer3DBlock layer={draftLayer('zero', 'ReLU', 0)} />);
    const zeroWidth = (capture.roundedBoxArgs[0] as [number, number, number])[0];
    expect(zeroWidth).toBe(1);

    capture.roundedBoxArgs.length = 0;
    render(<Layer3DBlock layer={draftLayer('bad', 'Conv2D', Number.NaN)} />);
    const placeholderWidth = (capture.roundedBoxArgs[0] as [number, number, number])[0];
    expect(placeholderWidth).not.toBe(zeroWidth);
  });

  it('真实非法记录渲染并点击选中后记录保持不变；参数改回合法则宽度随之恢复', () => {
    seedIllegalConv();
    const before = storeSnapshot();
    expect(before.layers[1].paramCountIsNaN).toBe(true);

    render(<Layer3DBlock layer={useLayerStore.getState().layers[1]} />);
    capture.roundedBoxArgs.length = 0;
    fireEvent.click(screen.getByTestId('rounded-box'));

    expect(useLayerStore.getState().selectedId).toBe('conv-1');
    expect(storeSnapshot()).toEqual(before);
    expect((capture.roundedBoxArgs[0] as [number, number, number])[0]).toBe(PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH);

    act(() => {
      useLayerStore.getState().updateLayerParam('conv-1', 'kernelSize', 3);
    });
    const fixed = useLayerStore.getState().layers[1];
    expect(fixed.outputShape).toEqual([8, 28, 28]);
    capture.roundedBoxArgs.length = 0;
    render(<Layer3DBlock layer={fixed} />);
    const recovered = (capture.roundedBoxArgs[0] as [number, number, number])[0];
    expect(recovered).toBe(Math.max(1, Math.log2(fixed.paramCount + 1) * 0.3 + 1));
    expect(recovered).not.toBe(PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH);
  });
});

describe('ShapeTooltip：参数量文本', () => {
  it('合法值与合法 0 照旧显示数字', () => {
    const legal = render(<ShapeTooltip layer={draftLayer('c', 'Conv2D', 448)} visible />);
    expect(within(legal.container).getByText('448')).toBeInTheDocument();

    const zero = render(<ShapeTooltip layer={draftLayer('r', 'ReLU', 0)} visible />);
    expect(within(zero.container).getByText('0')).toBeInTheDocument();
  });

  it('非法或缺失参数量显示「不可用」，不显示 NaN', () => {
    const tooltip = render(<ShapeTooltip layer={draftLayer('c', 'Conv2D', Number.NaN)} visible />);
    expect(within(tooltip.container).getByText('不可用')).toBeInTheDocument();
    expect(tooltip.container.textContent).not.toMatch(/NaN|Infinity/);

    const missing = render(<ShapeTooltip layer={draftLayer('c2', 'Conv2D', undefined)} visible />);
    expect(within(missing.container).getByText('不可用')).toBeInTheDocument();
  });
});

describe('SceneStats：总量不冒充完整', () => {
  it('合法总量按原有千分位格式显示', () => {
    seedLegalNetwork();
    expect(useLayerStore.getState().totalParams).toBe(7850);
    const stats = render(<SceneStats />);
    expect(within(stats.container).getByText('7,850')).toBeInTheDocument();
  });

  it('真实非法记录：总量显示「不可用」，不显示 NaN', () => {
    seedIllegalConv();
    const stats = render(<SceneStats />);
    expect(within(stats.container).getByText('不可用')).toBeInTheDocument();
    expect(stats.container.textContent).not.toMatch(/NaN|Infinity/);
    expect(storeSnapshot().totalParamsIsNaN).toBe(true);
  });

  it('参数量不可用与结构错误不是同一种状态：无结构错误时状态仍为「结构正确」', () => {
    act(() => {
      useLayerStore.setState({
        layers: [draftLayer('conv-1', 'Conv2D', Number.POSITIVE_INFINITY, [8, 28, 28], {}, 0)],
        totalParams: 896,
        hasShapeError: false,
        validationResult: { errors: [], warnings: [], isValid: true },
      });
    });
    const stats = render(<SceneStats />);
    expect(within(stats.container).getByText('✓ 结构正确')).toBeInTheDocument();
    expect(within(stats.container).getByText('不可用')).toBeInTheDocument();
  });
});

describe('QuickTrain：参数量与耗时预估', () => {
  function renderWithAdvanced() {
    const view = render(<QuickTrain />);
    fireEvent.click(view.getByTestId('advanced-btn'));
    return view;
  }

  it('合法总量显示千分位数字，预估秒数按原始数值计算（不从展示文字反解析）', () => {
    seedLegalNetwork();
    const view = renderWithAdvanced();
    expect(view.getByTestId('qt-param-count').textContent).toBe('7,850');
    // 默认 batchSize=32、CPU 吞吐 5000：ceil(7850*32/5000)=51；若从「7,850」文字解析会得到另一个数
    expect(view.getByTestId('qt-epoch-estimate').textContent).toContain('~51秒/epoch（粗略估计）');
  });

  it('非法参数量：显示「不可用」与「无法估算」，不显示 NaN 也不冒充 0 秒', () => {
    seedIllegalConv();
    const view = renderWithAdvanced();
    expect(view.getByTestId('qt-param-count').textContent).toBe('不可用');
    const estimate = view.getByTestId('qt-epoch-estimate').textContent ?? '';
    expect(estimate).toContain('无法估算');
    expect(estimate).not.toMatch(/NaN|Infinity/);
    expect(estimate).not.toContain('0秒');
    expect(storeSnapshot().totalParamsIsNaN).toBe(true);
  });

  it('参数量恢复合法后，展示与预估一起恢复', () => {
    seedIllegalConv();
    const view = renderWithAdvanced();
    expect(view.getByTestId('qt-param-count').textContent).toBe('不可用');

    act(() => {
      useLayerStore.getState().updateLayerParam('conv-1', 'kernelSize', 3);
    });
    const total = useLayerStore.getState().totalParams;
    expect(Number.isSafeInteger(total)).toBe(true);
    expect(view.getByTestId('qt-param-count').textContent).toBe(total.toLocaleString());
    expect(view.getByTestId('qt-epoch-estimate').textContent).toContain(
      `~${Math.ceil(total * 32 / 5000)}秒/epoch（粗略估计）`,
    );
  });

  it('总量有限但单层记录非法（该层有真实 ID）：文字「不可用」时耗时也必须「无法估算」', () => {
    // 已确认的复现：旧实现里参数量显示「不可用」，耗时却仍拿同一个无效总量算出约 6 秒。
    act(() => {
      useLayerStore.setState({
        layers: [
          draftLayer('input-1', 'Input', 0, [1, 28, 28], { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
          draftLayer('conv-1', 'Conv2D', Number.NaN, [8, 28, 28], {}, 1),
        ],
        totalParams: 896,
      });
    });
    expect(useLayerStore.getState().totalParams).toBe(896);
    const view = renderWithAdvanced();
    expect(view.getByTestId('qt-param-count').textContent).toBe('不可用');
    expect(view.getByTestId('qt-epoch-estimate').textContent).toContain('无法估算');
    // ceil(896*32/5000)=6：这一栏里出现任何「~N秒/epoch」都意味着采信了不能宣称完整的总量
    const box = view.getByTestId('qt-param-count').closest('div') as HTMLElement;
    expect(box.textContent).not.toMatch(/~\s*\d+(\.\d+)?\s*秒\/epoch/);
    expect(box.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('同一条记录修好之后，总量文字与耗时预估一起恢复成可用', () => {
    act(() => {
      useLayerStore.setState({
        layers: [
          draftLayer('input-1', 'Input', 0, [1, 28, 28], { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
          draftLayer('conv-1', 'Conv2D', Number.NaN, [8, 28, 28], {}, 1),
        ],
        totalParams: 896,
      });
    });
    const view = renderWithAdvanced();
    expect(view.getByTestId('qt-param-count').textContent).toBe('不可用');
    expect(view.getByTestId('qt-epoch-estimate').textContent).toContain('无法估算');

    act(() => {
      useLayerStore.setState({
        layers: useLayerStore.getState().layers.map(layer =>
          layer.id === 'conv-1' ? { ...layer, paramCount: 896 } : layer,
        ),
      });
    });
    expect(useLayerStore.getState().totalParams).toBe(896);
    expect(view.getByTestId('qt-param-count').textContent).toBe('896');
    expect(view.getByTestId('qt-epoch-estimate').textContent).toContain('~6秒/epoch（粗略估计）');
  });

  it('合法 0 参数网络：仍显示「0」，不显示耗时数字，也不显示「不可用」', () => {
    act(() => {
      useLayerStore.setState({
        layers: [
          draftLayer('input-1', 'Input', 0, [1, 28, 28], { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
          draftLayer('relu-1', 'ReLU', 0, [1, 28, 28], {}, 1),
        ],
        totalParams: 0,
      });
    });
    const view = renderWithAdvanced();
    expect(view.getByTestId('qt-param-count').textContent).toBe('0');
    expect(view.queryByTestId('qt-epoch-estimate')).toBeNull();
    const box = view.getByTestId('qt-param-count').closest('div') as HTMLElement;
    expect(box.textContent).not.toContain('不可用');
    expect(box.textContent).not.toMatch(/NaN|Infinity/);
  });
});

describe('TrainResultModal：只用完成记录自身的快照', () => {
  function seedDoneRecord(totalParams: number) {
    const record: TrainRecord = {
      id: 'rec-1',
      timestamp: 1,
      networkSummary: 'Input → Flatten → Linear',
      totalParams,
      finalAccuracy: 0.9,
      finalLoss: 0.1,
      epochs: 2,
      duration: 1000,
      dataset: 'MNIST',
      metrics: [],
      executionMode: 'simulation',
    };
    useTrainingStore.setState({
      status: 'done',
      history: [record],
      lastAttemptId: null,
      executionMode: 'simulation',
    });
  }

  it('历史数字来自记录快照，不读取当前编辑工程的参数量', () => {
    seedDoneRecord(7850);
    // 当前工程故意是另一个合法总量：组件若回读当前工程就会出现 1,234
    act(() => {
      useLayerStore.getState().setLayers([
        draftLayer('input-1', 'Input', 0, [1, 28, 28], { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
        draftLayer('fc-1', 'Linear', 1234, [10], { inFeatures: 784, outFeatures: 10 }, 1),
      ]);
      useLayerStore.setState({ totalParams: 1234 });
    });
    render(<TrainResultModal />);
    const card = screen.getByTestId('train-result-card');
    expect(within(card).getByText('7,850')).toBeInTheDocument();
    expect(card.textContent).not.toContain('1,234');
  });

  it('记录快照自身非法时显示「不可用」，不回落到当前工程的合法数字', () => {
    seedDoneRecord(Number.NaN);
    seedLegalNetwork();
    render(<TrainResultModal />);
    const card = screen.getByTestId('train-result-card');
    expect(within(card).getByText('参数总量')).toBeInTheDocument();
    expect(card.textContent).toContain('不可用');
    expect(card.textContent).not.toContain('7,850');
    expect(card.textContent).not.toMatch(/NaN/);
  });

  it('完成记录整体缺失时也不得回读当前工程：仍是「不可用」', () => {
    // 没有任何可归属的完成记录（completedRecord 为 null），但当前工程参数量合法
    seedLegalNetwork();
    useTrainingStore.setState({ status: 'done', history: [], lastAttemptId: null, executionMode: 'native' });
    expect(useLayerStore.getState().totalParams).toBe(7850);
    render(<TrainResultModal />);
    const card = screen.getByTestId('train-result-card');
    expect(within(card).getByText('参数总量')).toBeInTheDocument();
    expect(card.textContent).toContain('不可用');
    expect(card.textContent).not.toContain('7,850');
  });
});

describe('跨消费面口径一致', () => {
  it('同一份非法记录在 N2 清单、场景统计、Tooltip 与训练栏都是「不可用」', () => {
    seedIllegalConv();
    const badLayer = useLayerStore.getState().layers[1];

    const list = render(<NetworkStructureOverview />);
    expect(within(list.container).getAllByText(/参数量：不可用/).length).toBeGreaterThan(0);

    const stats = render(<SceneStats />);
    expect(within(stats.container).getByText('不可用')).toBeInTheDocument();

    const tooltip = render(<ShapeTooltip layer={badLayer} visible />);
    expect(within(tooltip.container).getByText('不可用')).toBeInTheDocument();

    const train = render(<QuickTrain />);
    fireEvent.click(train.getByTestId('advanced-btn'));
    expect(train.getByTestId('qt-param-count').textContent).toBe('不可用');
  });

  it('合法记录在各处使用同一千分位口径', () => {
    seedLegalNetwork();
    const lastLayer = useLayerStore.getState().layers[2];

    const list = render(<NetworkStructureOverview />);
    expect(within(list.container).getAllByText(/参数量：7,850/).length).toBeGreaterThan(0);

    const stats = render(<SceneStats />);
    expect(within(stats.container).getByText('7,850')).toBeInTheDocument();

    const tooltip = render(<ShapeTooltip layer={lastLayer} visible />);
    expect(within(tooltip.container).getByText('7,850')).toBeInTheDocument();
  });
});
