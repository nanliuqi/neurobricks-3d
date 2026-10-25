/**
 * N2 逐层结构清单组件测试：断言真实渲染结果与 store 交互，不检查源码字符串。
 * 证据边界：happy-dom 不实现按钮的原生 Enter/Space 激活行为，本文件只验证
 * 「原生 button 语义 + 点击后的状态与焦点保持」；真实键盘激活与焦点环可见性
 * 属于桌面端人工复测范围，不由这些用例冒充已验证。
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import NetworkStructureOverview from '@/components/panels/network/NetworkStructureOverview';
import { useLayerStore } from '@/stores/useLayerStore';
import {
  ERROR_DETAIL_MISSING_TEXT,
  SHAPE_INVALID_TEXT,
  UPSTREAM_INVALID_TEXT,
  buildNetworkStructureViewModel,
} from '@/utils/networkStructureViewModel';
import { formatShape } from '@/utils/shapeInference';
import { LAYER_META_LIST } from '@/types/layer';
import type { Layer3D, LayerType, ShapeValidationError, TensorShape } from '@/types/layer';

function draftLayer(
  id: string,
  type: LayerType,
  order: number,
  params: Layer3D['params'] = {},
): Layer3D {
  return {
    id,
    type,
    params,
    order,
    position: [0, order, 0],
    outputShape: null,
    paramCount: 0,
    validationError: null,
  };
}

/** 走真实 store 推导链：形状、参数量与错误都由既有算法产生，不在测试里伪造。 */
function seedThroughStore(layers: Layer3D[]) {
  act(() => {
    useLayerStore.getState().setLayers(layers);
  });
}

function businessSnapshot() {
  const s = useLayerStore.getState();
  return JSON.parse(JSON.stringify({
    layers: s.layers,
    layoutMode: s.layoutMode,
    towerName: s.towerName,
    totalParams: s.totalParams,
    hasShapeError: s.hasShapeError,
    validationResult: s.validationResult,
  }));
}

function rows() {
  return screen.getAllByRole('button');
}

function rowOf(orderLabel: string) {
  return screen.getByRole('button', { name: new RegExp(orderLabel) });
}

/** 行标题是按钮的第一个子节点：第 N 层 · 层名 */
function rowTitle(button: HTMLElement): string {
  return button.firstElementChild?.textContent?.trim() ?? '';
}

beforeEach(() => {
  useLayerStore.setState({ ...useLayerStore.getInitialState() });
});

describe('NetworkStructureOverview 结构呈现', () => {
  it('按 order 排序逐行列出，名称复用共享层元信息', () => {
    // 故意乱序提交，验证清单按网络顺序而非数组顺序
    seedThroughStore([
      draftLayer('pool-1', 'MaxPool2D', 2, { poolKernelSize: 2 }),
      draftLayer('input-1', 'Input', 0, { inChannels: 3, inputHeight: 24, inputWidth: 40 }),
      draftLayer('conv-1', 'Conv2D', 1, { inChannels: 3, outChannels: 8, kernelSize: 3, stride: 2, padding: 1 }),
    ]);
    render(<NetworkStructureOverview />);

    expect(rows().map(rowTitle)).toEqual([
      '第 1 层 · 输入层',
      '第 2 层 · 卷积层',
      '第 3 层 · 最大池化层',
    ]);
    for (const type of ['Input', 'Conv2D', 'MaxPool2D'] as LayerType[]) {
      const meta = LAYER_META_LIST.find(item => item.type === type);
      expect(meta).toBeDefined();
      expect(document.body.textContent).toContain(meta?.label);
      expect(document.body.textContent).toContain(meta?.description);
    }
  });

  it('上游与推导输出都保持 [C, H, W] 存储顺序，一维不加 batch', () => {
    seedThroughStore([
      draftLayer('input-1', 'Input', 0, { inChannels: 3, inputHeight: 24, inputWidth: 40 }),
      draftLayer('conv-1', 'Conv2D', 1, { inChannels: 3, outChannels: 8, kernelSize: 3, stride: 2, padding: 1 }),
      draftLayer('flat-1', 'Flatten', 2, {}),
    ]);
    render(<NetworkStructureOverview />);

    const convRow = rowOf('第 2 层');
    expect(within(convRow).getByText('上游已记录输出：[3, 24, 40]')).toBeInTheDocument();
    expect(within(convRow).getByText('推导输出：[8, 12, 20]')).toBeInTheDocument();
    expect(within(convRow).queryByText('[12, 20, 8]')).toBeNull();
    expect(within(convRow).queryByText('[24, 40, 3]')).toBeNull();

    const flatRow = rowOf('第 3 层');
    expect(within(flatRow).getByText('推导输出：[1920]')).toBeInTheDocument();
    expect(within(flatRow).getByText('上游已记录输出：[8, 12, 20]')).toBeInTheDocument();
  });

  it('首层为 Input 显示网络入口；缺记录时显示未知而不是猜测形状', () => {
    useLayerStore.setState({
      layers: [
        { ...draftLayer('conv-1', 'Conv2D', 0, { outChannels: 8 }), outputShape: [8, 26, 26], paramCount: Number.NaN },
      ],
      selectedId: null,
    });
    render(<NetworkStructureOverview />);

    const row = rowOf('第 1 层');
    expect(within(row).getByText('上游已记录输出：未记录（不猜测）')).toBeInTheDocument();
    expect(within(row).queryByText('[1, 28, 28]')).toBeNull();
    expect(within(row).getByText('参数量：不可用')).toBeInTheDocument();
  });

  it('中间层的上游没有记录形状时显示未知，不回填默认输入形状', () => {
    useLayerStore.setState({
      layers: [
        { ...draftLayer('lin-1', 'Linear', 0), outputShape: null },
        { ...draftLayer('relu-1', 'ReLU', 1), outputShape: null },
      ],
      selectedId: null,
    });
    render(<NetworkStructureOverview />);

    const row = rowOf('第 2 层');
    expect(within(row).getByText('上游已记录输出：未记录（不猜测）')).toBeInTheDocument();
    expect(within(row).queryByText(/1, 28, 28/)).toBeNull();
  });

  it('输出未推导到时沿用共享未知表示，且状态标为形状未记录', () => {
    useLayerStore.setState({
      layers: [{ ...draftLayer('lin-1', 'Linear', 0), outputShape: null, paramCount: 0 }],
      selectedId: null,
    });
    render(<NetworkStructureOverview />);
    const row = rowOf('第 1 层');
    expect(within(row).getByText('推导输出：?')).toBeInTheDocument();
    expect(within(row).getByText('输出形状未记录')).toBeInTheDocument();
  });
  it('空网络显示明确空态，不显示任何行', () => {
    render(<NetworkStructureOverview />);
    expect(screen.getByText('网络为空')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('说明文案不声称可训练或可运行', () => {
    seedThroughStore([draftLayer('input-1', 'Input', 0, { inChannels: 1, inputHeight: 28, inputWidth: 28 })]);
    render(<NetworkStructureOverview />);
    expect(document.body.textContent).toContain('不替代训练前检查');
    expect(document.body.textContent).not.toMatch(/可训练|可运行|结构正常/);
  });
});

describe('NetworkStructureOverview 选中联动', () => {
  beforeEach(() => {
    seedThroughStore([
      draftLayer('input-1', 'Input', 0, { inChannels: 3, inputHeight: 24, inputWidth: 40 }),
      draftLayer('conv-1', 'Conv2D', 1, { inChannels: 3, outChannels: 8, kernelSize: 3, stride: 2, padding: 1 }),
    ]);
  });

  it('行按钮是原生 button，可访问名包含层序号与类型且互不相同', () => {
    render(<NetworkStructureOverview />);
    const buttons = rows();
    expect(buttons).toHaveLength(2);
    buttons.forEach(button => {
      expect(button).toHaveAttribute('type', 'button');
    });
    const names = buttons.map(button => button.getAttribute('aria-pressed'));
    expect(names).toEqual(['false', 'false']);
    expect(buttons[0].textContent).toContain('第 1 层');
    expect(buttons[1].textContent).toContain('第 2 层');
    expect(buttons[0].textContent).not.toBe(buttons[1].textContent);
  });

  it('点击行只写 selectedId，其余业务字段深值快照完全不变', () => {
    render(<NetworkStructureOverview />);
    const before = businessSnapshot();

    fireEvent.click(rowOf('第 2 层'));

    const state = useLayerStore.getState();
    expect(state.selectedId).toBe('conv-1');
    const after = businessSnapshot();
    expect(after).toEqual(before);
  });

  it('aria-pressed 跟随选中，且选中后清单不卸载、可继续选另一层', () => {
    render(<NetworkStructureOverview />);
    const firstRow = rowOf('第 1 层');

    fireEvent.click(firstRow);
    expect(firstRow).toHaveAttribute('aria-pressed', 'true');
    expect(rows()).toHaveLength(2);

    fireEvent.click(rowOf('第 2 层'));
    expect(firstRow).toHaveAttribute('aria-pressed', 'false');
    expect(useLayerStore.getState().selectedId).toBe('conv-1');
    // 同一批 DOM 节点仍在文档中：清单没有因选中而重挂载
    expect(firstRow.isConnected).toBe(true);
    expect(rows()).toHaveLength(2);
  });

  it('选中状态变化不移除已聚焦行的焦点', () => {
    render(<NetworkStructureOverview />);
    const row = rowOf('第 2 层');
    row.focus();
    expect(document.activeElement).toBe(row);

    act(() => {
      useLayerStore.getState().setSelectedId('conv-1');
    });

    expect(document.activeElement).toBe(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  it('已记录结构错误的层显示错误原文与既有建议，状态不标为正常', () => {
    seedThroughStore([
      draftLayer('input-1', 'Input', 0, { inChannels: 3, inputHeight: 24, inputWidth: 40 }),
      draftLayer('conv-1', 'Conv2D', 1, { inChannels: 1, outChannels: 8, kernelSize: 3 }),
    ]);
    render(<NetworkStructureOverview />);

    const state = useLayerStore.getState();
    const convError = state.validationResult.errors.find(e => e.layerId === 'conv-1');
    expect(convError).toBeDefined();

    const row = rowOf('第 2 层');
    expect(within(row).getByText(convError?.message as string)).toBeInTheDocument();
    expect(within(row).getByText(`💡 ${convError?.suggestion}`)).toBeInTheDocument();
    expect(within(row).getByText('已记录结构错误')).toBeInTheDocument();
    // 有形状不等于没问题：本层仍显示 store 里已推导出的输出形状，但状态是错误
    const convShape = state.layers.find(layer => layer.id === 'conv-1')?.outputShape ?? null;
    expect(convShape).not.toBeNull();
    expect(within(row).getByText(`推导输出：${formatShape(convShape)}`)).toBeInTheDocument();
    expect(within(row).queryByText(/正常|可训练|可运行/)).toBeNull();
  });

  it('上游已记录错误时，后续行标注结果仅供定位参考', () => {
    seedThroughStore([
      draftLayer('input-1', 'Input', 0, { inChannels: 3, inputHeight: 24, inputWidth: 40 }),
      draftLayer('conv-1', 'Conv2D', 1, { inChannels: 1, outChannels: 8, kernelSize: 3 }),
      draftLayer('relu-1', 'ReLU', 2, {}),
    ]);
    render(<NetworkStructureOverview />);

    expect(within(rowOf('第 1 层')).queryByText(/仅供定位参考/)).toBeNull();
    expect(within(rowOf('第 2 层')).queryByText(/仅供定位参考/)).toBeNull();
    expect(within(rowOf('第 3 层')).getByText('上游已记录错误，本行推导结果仅供定位参考')).toBeInTheDocument();
  });
});

describe('NetworkStructureOverview 跟随 store 更新', () => {
  beforeEach(() => {
    seedThroughStore([
      draftLayer('input-1', 'Input', 0, { inChannels: 3, inputHeight: 24, inputWidth: 40 }),
      draftLayer('conv-1', 'Conv2D', 1, { inChannels: 3, outChannels: 8, kernelSize: 3, stride: 2, padding: 1 }),
    ]);
  });

  it('编辑参数后清单刷新为新推导结果', () => {
    render(<NetworkStructureOverview />);
    expect(within(rowOf('第 2 层')).getByText('推导输出：[8, 12, 20]')).toBeInTheDocument();

    act(() => {
      useLayerStore.getState().updateLayerParam('conv-1', 'outChannels', 16);
    });

    const row = rowOf('第 2 层');
    expect(within(row).getByText('推导输出：[16, 12, 20]')).toBeInTheDocument();
    // 参数量来自既有 computeParamCount：3*3*3*16 + 16
    expect(within(row).getByText('参数量：448')).toBeInTheDocument();
  });

  it('删除与换位后清单不残留旧行，序号连续', () => {
    act(() => {
      useLayerStore.getState().setLayers([
        ...useLayerStore.getState().layers,
        draftLayer('relu-1', 'ReLU', 2, {}),
      ]);
    });
    render(<NetworkStructureOverview />);
    expect(rows()).toHaveLength(3);

    act(() => {
      useLayerStore.getState().moveLayer('relu-1', 0);
    });
    expect(rows().map(rowTitle)).toEqual([
      '第 1 层 · ReLU 激活',
      '第 2 层 · 输入层',
      '第 3 层 · 卷积层',
    ]);

    act(() => {
      useLayerStore.getState().removeLayer('input-1');
    });
    const remaining = rows();
    expect(remaining).toHaveLength(2);
    expect(remaining.map(rowTitle)).toEqual([
      '第 1 层 · ReLU 激活',
      '第 2 层 · 卷积层',
    ]);
  });

  it('清空网络后回到空态', () => {
    render(<NetworkStructureOverview />);
    act(() => {
      useLayerStore.getState().clearAllLayers();
    });
    expect(screen.getByText('网络为空')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('渲染清单不修改 store 中的层数据', () => {
    const before = businessSnapshot();
    const shapeRefs = useLayerStore.getState().layers.map(l => l.outputShape);

    render(<NetworkStructureOverview />);
    fireEvent.click(rowOf('第 2 层'));

    const after = useLayerStore.getState();
    expect(JSON.parse(JSON.stringify({
      layers: after.layers,
      layoutMode: after.layoutMode,
      towerName: after.towerName,
      totalParams: after.totalParams,
      hasShapeError: after.hasShapeError,
      validationResult: after.validationResult,
    }))).toEqual(before);
    after.layers.forEach((layer, i) => {
      expect(layer.outputShape).toBe(shapeRefs[i] as TensorShape | null);
    });
  });
});

/**
 * 展示资格与错误存在性补丁的用例：非法形状记录与空白错误详情都必须在 DOM 上
 * 如实可见，且原始记录保持原值。这里不用 JSON 快照判断非法数据不变性，
 * 因为 JSON.stringify 会把 NaN / Infinity 变成 null，从而掩盖真实改动。
 */
function recordSnapshot() {
  const s = useLayerStore.getState();
  return structuredClone({ layers: s.layers, validationResult: s.validationResult });
}

function recordOf(layerId: string, message: string, suggestion = ''): ShapeValidationError {
  return {
    layerId,
    layerType: 'Conv2D',
    errorType: 'param_conflict',
    message,
    suggestion,
    expectedInputShape: null,
    actualInputShape: null,
  };
}

/** 直接注入已记录事实（含非法形状与空白详情），不借 store 重算制造数据。 */
function seedRecorded(
  layers: Array<Layer3D & { outputShape: TensorShape | null }>,
  errors: ShapeValidationError[] = [],
) {
  act(() => {
    useLayerStore.setState({
      layers,
      selectedId: null,
      validationResult: { isValid: errors.length === 0, errors, warnings: [] },
      hasShapeError: errors.length > 0,
    });
  });
}

function statusTexts(button: HTMLElement): string {
  return button.querySelector('.network-structure__status')?.textContent?.trim() ?? '';
}

describe('NetworkStructureOverview 形状记录展示资格', () => {
  it('非法维度记录显示「形状记录无效」，行内不出现 NaN / Infinity 数值', () => {
    seedRecorded([
      { ...draftLayer('conv-1', 'Conv2D', 0), outputShape: [8, Number.NaN, 20], paramCount: 224 },
    ]);
    render(<NetworkStructureOverview />);

    const row = rowOf('第 1 层');
    expect(within(row).getByText(`推导输出：${SHAPE_INVALID_TEXT}`)).toBeInTheDocument();
    expect(within(row).getByText(SHAPE_INVALID_TEXT)).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/NaN|Infinity/);
    expect(row.textContent).not.toContain('[8,');
  });

  it('非法上游不显示为已知输入，改用无效记录说明', () => {
    seedRecorded([
      { ...draftLayer('conv-1', 'Conv2D', 0), outputShape: [8, Number.POSITIVE_INFINITY, 20] },
      { ...draftLayer('relu-1', 'ReLU', 1), outputShape: [8, 12, 20] },
    ]);
    render(<NetworkStructureOverview />);

    const row = rowOf('第 2 层');
    expect(within(row).getByText(`上游已记录输出：${UPSTREAM_INVALID_TEXT}`)).toBeInTheDocument();
    expect(within(row).queryByText(/Infinity/)).toBeNull();
    // 本层自身形状合法：独立维度不被上游污染成「未知」
    expect(within(row).getByText('推导输出：[8, 12, 20]')).toBeInTheDocument();
    expect(statusTexts(row)).toBe('形状已静态推导');
  });

  it('未记录与记录了但非法在界面上是两种不同状态', () => {
    seedRecorded([
      { ...draftLayer('lin-1', 'Linear', 0), outputShape: null },
      { ...draftLayer('drop-1', 'Dropout', 1), outputShape: [] },
      { ...draftLayer('conv-1', 'Conv2D', 2), outputShape: [8, 0, 0] },
    ]);
    render(<NetworkStructureOverview />);

    expect(statusTexts(rowOf('第 1 层'))).toBe('输出形状未记录');
    expect(statusTexts(rowOf('第 2 层'))).toBe('输出形状未记录');
    expect(statusTexts(rowOf('第 3 层'))).toBe(SHAPE_INVALID_TEXT);
    expect(within(rowOf('第 1 层')).getByText('推导输出：?')).toBeInTheDocument();
    expect(within(rowOf('第 3 层')).getByText(`推导输出：${SHAPE_INVALID_TEXT}`)).toBeInTheDocument();
  });

  it('真实推导链路拒绝非数值参数：不记录 NaN 形状，并写回方向正确的结构错误', () => {
    // 修复前的事实：inferOutputShape 的 `outH <= 0` 守卫对 NaN 恒为 false，
    // 手工编辑过的项目参数（kernelSize: 'three'）会让 store 记录 [8, NaN, NaN]
    // 且不产生任何错误。N3 已让底层拒绝这类值，本用例断言修复后的行为。
    seedThroughStore([
      draftLayer('input-1', 'Input', 0, { inChannels: 3, inputHeight: 4, inputWidth: 4 }),
      draftLayer('conv-1', 'Conv2D', 1, {
        inChannels: 3,
        outChannels: 8,
        kernelSize: 'three' as unknown as number,
        stride: 1,
        padding: 0,
      }),
    ]);

    const state = useLayerStore.getState();
    const stored = state.layers.find(layer => layer.id === 'conv-1');
    expect(stored?.outputShape).toBeNull();
    expect(state.hasShapeError).toBe(true);

    const error = state.validationResult.errors.find(item => item.layerId === 'conv-1');
    expect(error).toBeDefined();
    expect(error?.errorType).toBe('invalid_dimension');
    expect(error?.message).toContain('kernelSize');
    expect(error?.message).toContain('有限正整数');
    // 方向：这是本层参数非法，不是「前一层形状不兼容」，也不是缺少 Flatten
    expect(error?.message).not.toMatch(/Flatten|前一层/);
    expect(stored?.validationError).toBe(error?.message);

    render(<NetworkStructureOverview />);
    const row = rowOf('第 2 层');
    expect(within(row).getByText(error?.message as string)).toBeInTheDocument();
    expect(statusTexts(row)).toBe('已记录结构错误');
    expect(row.textContent).not.toMatch(/NaN/);

    // 底层只拒绝非法推导，不改写调用方参数（无自动修复）
    expect(Object.is(state.layers[1].params.kernelSize, 'three' as unknown as number)).toBe(true);
  });

  it('参数改回合法值后输出形状、错误记录与阻断状态一起恢复', () => {
    seedThroughStore([
      draftLayer('input-1', 'Input', 0, { inChannels: 3, inputHeight: 4, inputWidth: 4 }),
      draftLayer('conv-1', 'Conv2D', 1, {
        inChannels: 3,
        outChannels: 8,
        kernelSize: 'three' as unknown as number,
        stride: 1,
        padding: 0,
      }),
    ]);
    expect(useLayerStore.getState().hasShapeError).toBe(true);

    act(() => {
      useLayerStore.getState().updateLayerParam('conv-1', 'kernelSize', 3);
    });

    const state = useLayerStore.getState();
    const stored = state.layers.find(layer => layer.id === 'conv-1');
    expect(stored?.outputShape).toEqual([8, 2, 2]);
    expect(stored?.validationError).toBeNull();
    expect(state.validationResult.errors).toHaveLength(0);
    expect(state.validationResult.isValid).toBe(true);
    expect(state.hasShapeError).toBe(false);

    render(<NetworkStructureOverview />);
    expect(within(rowOf('第 2 层')).getByText('推导输出：[8, 2, 2]')).toBeInTheDocument();
    expect(within(rowOf('第 2 层')).queryByText(/仅供定位参考/)).toBeNull();
  });

  it('DOM 可见状态与投影结果逐行一致', () => {
    seedRecorded([
      { ...draftLayer('conv-1', 'Conv2D', 0), outputShape: [8, Number.NaN, 20] },
      { ...draftLayer('relu-1', 'ReLU', 1), outputShape: [8, 12, 20] },
      { ...draftLayer('lin-1', 'Linear', 2), outputShape: null },
    ], [recordOf('relu-1', '全连接前缺少展平层', '在 Linear 层前添加 Flatten 层')]);
    render(<NetworkStructureOverview />);

    const state = useLayerStore.getState();
    const model = buildNetworkStructureViewModel({
      layers: state.layers,
      validationResult: state.validationResult,
    });
    expect(rows()).toHaveLength(model.rows.length);
    expect(rows().map(statusTexts)).toEqual(model.rows.map(row => row.statusText));
    expect(rows().map(row => row.getAttribute('aria-pressed'))).toEqual(
      model.rows.map(row => String(row.id === state.selectedId)),
    );
  });

  it('渲染非法记录后 store 原始值逐维保持（含 NaN 本体）', () => {
    seedRecorded([
      { ...draftLayer('conv-1', 'Conv2D', 0), outputShape: [8, Number.NaN, 20] },
      { ...draftLayer('conv-2', 'Conv2D', 1), outputShape: [8, Number.NEGATIVE_INFINITY, -3] },
    ]);
    const before = recordSnapshot();
    const shapeRefs = useLayerStore.getState().layers.map(layer => layer.outputShape);

    render(<NetworkStructureOverview />);
    fireEvent.click(rowOf('第 2 层'));

    const after = recordSnapshot();
    expect(after).toEqual(before);
    useLayerStore.getState().layers.forEach((layer, i) => {
      expect(layer.outputShape).toBe(shapeRefs[i]);
    });
    const stored = useLayerStore.getState().layers;
    expect(Object.is(stored[0].outputShape?.[1], Number.NaN)).toBe(true);
    expect(Object.is(stored[1].outputShape?.[1], Number.NEGATIVE_INFINITY)).toBe(true);
    expect(stored[1].outputShape).toEqual([8, Number.NEGATIVE_INFINITY, -3]);
    expect(stored[1].outputShape?.length).toBe(3);
    expect(useLayerStore.getState().selectedId).toBe('conv-2');
  });
});

describe('NetworkStructureOverview 错误详情缺失', () => {
  it('归属明确但详情空白时仍显示错误状态与中性占位，并保留原有建议', () => {
    seedRecorded(
      [{ ...draftLayer('conv-1', 'Conv2D', 0), outputShape: [8, 26, 26], validationError: '   ' }],
      [recordOf('conv-1', '   ', '把 kernelSize 改为 3')],
    );
    render(<NetworkStructureOverview />);

    const row = rowOf('第 1 层');
    expect(within(row).getByText('已记录结构错误')).toBeInTheDocument();
    expect(within(row).getByText(ERROR_DETAIL_MISSING_TEXT)).toBeInTheDocument();
    expect(within(row).getByText('💡 把 kernelSize 改为 3')).toBeInTheDocument();
    // 不编造原因：占位之外没有其它错误详情
    expect(row.querySelectorAll('.network-structure__error')).toHaveLength(1);
  });

  it('空白详情的错误仍向下传递「仅供定位参考」警示', () => {
    seedRecorded(
      [
        { ...draftLayer('conv-1', 'Conv2D', 0), outputShape: [8, 26, 26] },
        { ...draftLayer('relu-1', 'ReLU', 1), outputShape: [8, 26, 26] },
      ],
      [recordOf('conv-1', '')],
    );
    render(<NetworkStructureOverview />);

    expect(within(rowOf('第 1 层')).queryByText(/仅供定位参考/)).toBeNull();
    expect(within(rowOf('第 1 层')).getByText('已记录结构错误')).toBeInTheDocument();
    expect(
      within(rowOf('第 2 层')).getByText('上游已记录错误，本行推导结果仅供定位参考'),
    ).toBeInTheDocument();
  });

  it('缺归属的空白错误不会给任何行打上错误标记', () => {
    seedRecorded(
      [{ ...draftLayer('conv-1', 'Conv2D', 0), outputShape: [8, 26, 26] }],
      [recordOf('', '   ')],
    );
    render(<NetworkStructureOverview />);

    const row = rowOf('第 1 层');
    expect(statusTexts(row)).toBe('形状已静态推导');
    expect(row.textContent).not.toContain('已记录结构错误');
  });

  it('详情缺失不改变参数量与形状展示，也不影响选中联动', () => {
    seedRecorded(
      [
        { ...draftLayer('conv-1', 'Conv2D', 0), outputShape: [8, 26, 26], paramCount: 0 },
        { ...draftLayer('relu-1', 'ReLU', 1), outputShape: [8, 26, 26], paramCount: 0 },
      ],
      [recordOf('conv-1', '   ')],
    );
    render(<NetworkStructureOverview />);

    const second = rowOf('第 2 层');
    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(useLayerStore.getState().selectedId).toBe('relu-1');
    expect(within(rowOf('第 1 层')).getByText('参数量：0')).toBeInTheDocument();
    expect(within(rowOf('第 1 层')).getByText('推导输出：[8, 26, 26]')).toBeInTheDocument();
  });
});
