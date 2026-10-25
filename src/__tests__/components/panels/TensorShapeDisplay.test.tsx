/**
 * N1 张量形状显示统一：ParamPanel 与 SceneStats 必须直接渲染 store 中同一份 outputShape。
 * 覆盖三条不变量：
 * 1) 维度顺序即存储顺序 [C, H, W] / [N]，展示层不重排、不补 batch 维；
 * 2) 两处共用 shapeInference.formatShape，缺失形状（null / 空数组）沿用同一个未知标记，
 *    不回落到 DEFAULT_INPUT_SHAPE、不填 0、不伪装成已计算；
 * 3) 渲染过程不原地修改业务数据（渲染前后数组引用 + 深值快照）。
 * 夹具全部在本文件内新建，不复用也不改写 CLASSIC_MODELS 等共享预设。
 */
import { act, fireEvent, render, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ParamPanel from '@/components/panels/ParamPanel';
import SceneStats from '@/components/scene3d/SceneStats';
import { useLayerStore } from '@/stores/useLayerStore';
import { formatShape } from '@/utils/shapeInference';
import type { Layer3D, LayerType, LayerParams, TensorShape } from '@/types/layer';

/** 三维夹具：通道 / 高 / 宽取三个互不相等的值，任何交换顺序都会改变字符串 */
const CHW: TensorShape = [3, 24, 40];
/** 一维夹具：全连接层特征向量，无 batch 维 */
const FLAT: TensorShape = [784];

function makeLayer(
  id: string,
  type: LayerType,
  params: LayerParams,
  outputShape: TensorShape | null,
  order = 0,
): Layer3D {
  return {
    id,
    type,
    params,
    order,
    position: [0, order, 0],
    // 每个用例持有独立数组实例，避免展示层的任何原地改动在用例间串联污染
    outputShape: outputShape ? [...outputShape] : null,
    paramCount: 896,
    validationError: null,
  };
}

/** 业务状态深快照：不只比引用，用于证明渲染没有副作用 */
function businessSnapshot() {
  const s = useLayerStore.getState();
  return JSON.parse(JSON.stringify({
    layers: s.layers,
    selectedId: s.selectedId,
    layoutMode: s.layoutMode,
    towerName: s.towerName,
    totalParams: s.totalParams,
    hasShapeError: s.hasShapeError,
    validationResult: s.validationResult,
  }));
}

function seedLayer(layer: Layer3D) {
  useLayerStore.setState({ layers: [layer], selectedId: layer.id });
}

beforeEach(() => {
  useLayerStore.setState({ ...useLayerStore.getInitialState() });
});

describe('三维形状：展示顺序等于存储顺序 [C, H, W]', () => {
  it('ParamPanel 按原顺序渲染三维形状', () => {
    seedLayer(makeLayer('conv-1', 'Conv2D', { inChannels: 3, outChannels: 3, kernelSize: 3 }, CHW));
    const { container } = render(<ParamPanel />);

    expect(within(container).getByText('[3, 24, 40]')).toBeInTheDocument();
    expect(within(container).queryByText('[40, 3, 24]')).toBeNull();
    expect(within(container).queryByText('[24, 40, 3]')).toBeNull();
    expect(within(container).queryByText('[3, 40, 24]')).toBeNull();
  });

  it('SceneStats 网络形状列表按原顺序渲染三维形状', () => {
    seedLayer(makeLayer('conv-1', 'Conv2D', { inChannels: 3, outChannels: 3, kernelSize: 3 }, CHW));
    const { container } = render(<SceneStats />);

    expect(within(container).getByText('[3, 24, 40]')).toBeInTheDocument();
    expect(within(container).queryByText('[40, 3, 24]')).toBeNull();
    expect(within(container).queryByText('[24, 40, 3]')).toBeNull();
  });

  it('两个面板对同一 store 状态渲染完全相同的形状字符串', () => {
    const layers = [
      makeLayer('l-1', 'Conv2D', { outChannels: 16 }, [5, 7, 19], 0),
      makeLayer('l-2', 'MaxPool2D', { poolKernelSize: 2 }, [5, 3, 9], 1),
      makeLayer('l-3', 'Linear', { outFeatures: 120 }, [120], 2),
    ];
    useLayerStore.setState({ layers, selectedId: 'l-1' });
    const stats = render(<SceneStats />);

    for (const layer of layers) {
      act(() => useLayerStore.setState({ selectedId: layer.id }));
      const param = render(<ParamPanel />);
      const expected = formatShape(layer.outputShape);
      expect(within(param.container).getByText(expected)).toBeInTheDocument();
      expect(within(stats.container).getByText(expected)).toBeInTheDocument();
      param.unmount();
    }
  });

  it('经 store 真实推导链得到的形状在两面板一致显示', () => {
    act(() => {
      useLayerStore.getState().setLayers([
        makeLayer('input-1', 'Input', { inChannels: 3, inputHeight: 24, inputWidth: 40 }, null, 0),
        makeLayer('conv-1', 'Conv2D', { inChannels: 3, outChannels: 8, kernelSize: 3, stride: 2, padding: 1 }, null, 1),
      ]);
    });

    const conv = useLayerStore.getState().layers.find(l => l.id === 'conv-1');
    // store 侧真实顺序：通道在前
    expect(conv?.outputShape).toEqual([8, 12, 20]);

    const stats = render(<SceneStats />);
    act(() => useLayerStore.setState({ selectedId: 'conv-1' }));
    const param = render(<ParamPanel />);

    expect(within(param.container).getByText('[8, 12, 20]')).toBeInTheDocument();
    expect(within(stats.container).getByText('[8, 12, 20]')).toBeInTheDocument();
    expect(within(stats.container).getByText('[3, 24, 40]')).toBeInTheDocument();
    expect(within(param.container).queryByText('[12, 20, 8]')).toBeNull();
    expect(within(stats.container).queryByText('[20, 8, 12]')).toBeNull();
  });
});

describe('一维形状：不补 batch 维度', () => {
  it('ParamPanel 保持 [784] 一维', () => {
    seedLayer(makeLayer('linear-1', 'Linear', { inFeatures: 784, outFeatures: 784 }, FLAT));
    const { container } = render(<ParamPanel />);

    expect(within(container).getByText('[784]')).toBeInTheDocument();
    expect(within(container).queryByText('[1, 784]')).toBeNull();
    expect(within(container).queryByText('[784, 1]')).toBeNull();
  });

  it('SceneStats 保持 [784] 一维', () => {
    seedLayer(makeLayer('linear-1', 'Linear', { inFeatures: 784, outFeatures: 784 }, FLAT));
    const { container } = render(<SceneStats />);

    expect(within(container).getByText('[784]')).toBeInTheDocument();
    expect(within(container).queryByText('[1, 784]')).toBeNull();
  });
});

describe('缺失形状：沿用共享未知表示，不做猜测回填', () => {
  it('outputShape 为 null 时两面板都显示 formatShape 的未知标记', () => {
    seedLayer(makeLayer('conv-1', 'Conv2D', { outChannels: 32 }, null));
    const stats = render(<SceneStats />);
    const param = render(<ParamPanel />);

    expect(formatShape(null)).toBe('?');
    expect(within(param.container).getByText('?')).toBeInTheDocument();
    expect(within(stats.container).getByText('?')).toBeInTheDocument();
    // 不得把默认输入形状当作该层的形状
    expect(within(param.container).queryByText('[1, 28, 28]')).toBeNull();
    expect(within(stats.container).queryByText('[1, 28, 28]')).toBeNull();
  });

  it('outputShape 为空数组时两面板都显示未知标记而非空壳', () => {
    seedLayer(makeLayer('conv-1', 'Conv2D', { outChannels: 32 }, []));
    const stats = render(<SceneStats />);
    const param = render(<ParamPanel />);

    expect(formatShape([])).toBe('?');
    expect(within(param.container).getByText('?')).toBeInTheDocument();
    expect(within(stats.container).getByText('?')).toBeInTheDocument();
    expect(within(param.container).queryByText('[]')).toBeNull();
    expect(within(stats.container).queryByText('[]')).toBeNull();
    expect(within(param.container).queryByText('[0, 0, 0]')).toBeNull();
  });
});

describe('渲染不修改业务数据', () => {
  it('渲染前后 outputShape 的数组引用与深值都不变', () => {
    const fixtures: Array<[string, LayerType, TensorShape | null]> = [
      ['f-chw', 'Conv2D', CHW],
      ['f-flat', 'Linear', FLAT],
      ['f-null', 'Conv2D', null],
      ['f-empty', 'Conv2D', []],
    ];
    const layers = fixtures.map(([id, type, shape], i) =>
      makeLayer(id, type, { outChannels: 32, outFeatures: 784 }, shape, i),
    );

    useLayerStore.setState({ layers, selectedId: 'f-chw' });
    const arraysBefore = layers.map(l => l.outputShape);
    const snapshotBefore = businessSnapshot();

    const stats = render(<SceneStats />);
    const param = render(<ParamPanel />);
    expect(within(param.container).getByText('[3, 24, 40]')).toBeInTheDocument();
    expect(within(stats.container).getByText('[3, 24, 40]')).toBeInTheDocument();

    const after = useLayerStore.getState().layers;
    expect(JSON.parse(JSON.stringify(after))).toEqual(snapshotBefore.layers);
    after.forEach((layer, i) => {
      // 同一数组实例，且实例内容未被原地重排
      expect(layer.outputShape).toBe(arraysBefore[i]);
      expect(layer.outputShape).toEqual(fixtures[i][2]);
    });
    expect(businessSnapshot()).toEqual(snapshotBefore);
  });

  it('SceneStats 多行渲染同样不改写各层形状数组', () => {
    const layers = [
      makeLayer('a', 'Conv2D', { outChannels: 16 }, [5, 7, 19], 0),
      makeLayer('b', 'MaxPool2D', { poolKernelSize: 2 }, [5, 3, 9], 1),
    ];
    useLayerStore.setState({ layers, selectedId: 'a' });
    const before = businessSnapshot();

    const { container } = render(<SceneStats />);
    expect(within(container).getByText('[5, 7, 19]')).toBeInTheDocument();
    expect(within(container).getByText('[5, 3, 9]')).toBeInTheDocument();

    const after = businessSnapshot();
    expect(after).toEqual(before);
    useLayerStore.getState().layers.forEach((layer, i) => {
      expect(layer.outputShape).toBe(layers[i].outputShape);
    });
  });
});

describe('既有交互保留', () => {
  it('SceneStats 切换布局模式仍走 store 原有重算路径，显示随之同步', () => {
    useLayerStore.setState({
      layers: [makeLayer('a', 'Conv2D', { outChannels: 16 }, [5, 7, 19], 0)],
      selectedId: 'a',
      layoutMode: 'vertical',
    });
    const { container } = render(<SceneStats />);

    fireEvent.click(within(container).getByRole('button', { name: '自由模式' }));

    expect(useLayerStore.getState().layoutMode).toBe('free');
    const stored = useLayerStore.getState().layers[0].outputShape;
    // 布局切换由 store 自身重算形状，展示层只消费结果
    expect(within(container).getByText(formatShape(stored))).toBeInTheDocument();
  });


  it('ParamPanel 编辑参数仍写入 store 并驱动形状重算与显示更新', () => {
    const input = makeLayer('input-1', 'Input', { inChannels: 3, inputHeight: 24, inputWidth: 40 }, [3, 24, 40], 0);
    const conv = makeLayer(
      'conv-1',
      'Conv2D',
      { inChannels: 3, outChannels: 8, kernelSize: 3, stride: 1, padding: 1 },
      [8, 24, 40],
      1,
    );
    useLayerStore.setState({ layers: [input, conv], selectedId: 'conv-1' });
    const { container } = render(<ParamPanel />);

    expect(within(container).getByText('[8, 24, 40]')).toBeInTheDocument();

    const label = within(container).getByText('outChannels (输出通道)');
    const numberInput = (label.parentElement as HTMLElement).querySelector('input') as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: '16' } });
    fireEvent.blur(numberInput);

    const layer = useLayerStore.getState().layers.find(l => l.id === 'conv-1');
    expect(layer?.params.outChannels).toBe(16);
    expect(layer?.outputShape).toEqual([16, 24, 40]);
    expect(layer?.validationError).toBeNull();
    expect(within(container).getByText('[16, 24, 40]')).toBeInTheDocument();
    expect(within(container).queryByText('[24, 40, 16]')).toBeNull();
  });

  it('SceneStats 的统计、网络状态与保存/加载入口仍然存在', () => {
    seedLayer(makeLayer('conv-1', 'Conv2D', { outChannels: 8 }, CHW));
    useLayerStore.setState({ totalParams: 896, hasShapeError: false });
    const { container } = render(<SceneStats />);

    expect(within(container).getByText('896')).toBeInTheDocument();
    expect(within(container).getByText('✓ 结构正确')).toBeInTheDocument();
    expect(within(container).getByRole('button', { name: /保存/ })).toBeInTheDocument();
    expect(within(container).getByRole('button', { name: /加载/ })).toBeInTheDocument();
    expect(within(container).getByRole('button', { name: '垂直模式' })).toBeInTheDocument();
  });

  it('空网络与未选中层的占位文案不变', () => {
    const stats = render(<SceneStats />);
    expect(within(stats.container).getByText('暂无层')).toBeInTheDocument();

    const param = render(<ParamPanel />);
    expect(within(param.container).getByText('请选择一个层')).toBeInTheDocument();
  });
});
