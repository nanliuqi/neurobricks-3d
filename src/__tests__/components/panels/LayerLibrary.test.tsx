/**
 * LayerLibrary 经典模型区测试：
 * - CSV 契约：未确认目标列时不执行回归适配；确认目标列后按共享 datasetContract 推导的
 *   featureCount 适配（1×1×特征数 + 末层单值输出）；
 * - 「经典模型」小节标题与「层组件库」总标题的可访问性：原生 button 语义、
 *   aria-expanded 与实际展开一致、折叠后不留下可聚焦控件、展开/收起只改展示状态；
 * - 预设「+ 添加」键盘入口：每个预设都有名称可区分的原生 button，按钮与整张卡片
 *   各自只添加一次，并共用同一份适配与追加规则。
 * 断言对象是实际写入 layer store 的层参数与真实渲染结果，不是注释。
 * 业务状态保护同时使用深拷贝值快照与引用检查，避免原地改写漏判。
 *
 * 证据边界：happy-dom 不实现 button 的默认激活行为，因此本文件只能自动验证
 * 「组件语义 + 点击后的状态切换」；真实 Tab 聚焦、Enter/Space 激活与焦点环可见性
 * 属于浏览器/桌面端人工复测范围，不得由这些用例冒充已验证。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LayerLibrary from '@/components/panels/LayerLibrary';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { adaptLayersForCsvRegression } from '@/utils/shapeInference';
import { CLASSIC_MODELS } from '@/types/classicModels';
import type { DatasetInfo } from '@/types/dataset';

// 把 CSV 适配函数包成可监视函数（默认透传真实实现），用于断言调用与参数。
vi.mock('@/utils/shapeInference', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/shapeInference')>();
  return {
    ...actual,
    adaptLayersForCsvRegression: vi.fn(actual.adaptLayersForCsvRegression),
  };
});

const CSV_INFO: DatasetInfo = {
  name: 'regression',
  type: 'csv',
  sampleCount: 100,
  classCount: 0,
  columns: ['a', 'b', 'target'],
  datasetId: 'ds-csv',
  contentHash: 'hash-csv',
};

function setCsvDataset(extra: Record<string, unknown> = {}) {
  useDatasetStore.setState({
    ...useDatasetStore.getInitialState(),
    datasetType: 'csv',
    datasetPath: 'D:/data.csv',
    datasetInfo: CSV_INFO,
    ...extra,
  });
}

function lastLinearParams() {
  const linears = useLayerStore.getState().layers.filter(layer => layer.type === 'Linear');
  return linears[linears.length - 1]?.params ?? {};
}

function inputParams() {
  const input = useLayerStore.getState().layers.find(layer => layer.type === 'Input');
  return input?.params ?? {};
}

function getClassicToggle() {
  return screen.getByRole('button', { name: /经典模型/ });
}

function getPanelTitle() {
  return screen.getByRole('button', { name: /层组件库/ });
}

/**
 * 业务状态的值快照（深拷贝）：只用 toBe 比引用会漏掉「原地 push / 改参数」，
 * 折叠类操作用它来证明网络与数据集一个字段都没动。
 */
function businessSnapshot() {
  const layerState = useLayerStore.getState();
  const datasetState = useDatasetStore.getState();
  return JSON.parse(JSON.stringify({
    layers: layerState.layers,
    selectedId: layerState.selectedId,
    layoutMode: layerState.layoutMode,
    towerName: layerState.towerName,
    validationResult: layerState.validationResult,
    totalParams: layerState.totalParams,
    hasShapeError: layerState.hasShapeError,
    datasetInfo: datasetState.datasetInfo,
    datasetType: datasetState.datasetType,
    targetField: datasetState.targetField,
    splitStrategy: datasetState.splitStrategy,
    groupField: datasetState.groupField,
    timeField: datasetState.timeField,
  }));
}

function presetName(modelId: string) {
  const model = CLASSIC_MODELS.find(item => item.id === modelId);
  if (!model) throw new Error(`经典模型模板缺少 ${modelId}`);
  return model;
}

async function clickMlpCard() {
  // 经典模型区默认折叠，先展开再点 MLP 卡片。
  fireEvent.click(getClassicToggle());
  fireEvent.click(screen.getByTestId('model-card-mlp'));
}

describe('LayerLibrary 经典模型与 CSV 目标列契约', () => {
  beforeEach(() => {
    vi.mocked(adaptLayersForCsvRegression).mockClear();
    useLayerStore.setState({ layers: [], selectedId: null });
  });

  it('CSV 未选目标列：不调用 adaptLayersForCsvRegression', async () => {
    setCsvDataset({ targetField: null });
    render(<LayerLibrary />);
    await clickMlpCard();
    expect(adaptLayersForCsvRegression).not.toHaveBeenCalled();
  });

  it('CSV 未选目标列：加入的是未经 CSV 回归适配的原模板', async () => {
    setCsvDataset({ targetField: null });
    render(<LayerLibrary />);
    await clickMlpCard();
    // Input 保持模板 1×28×28（未被改成 CSV 特征数），末层 Linear 保持模板输出 10（未改成 1）。
    expect(inputParams()).toMatchObject({ inChannels: 1, inputHeight: 28, inputWidth: 28 });
    expect(lastLinearParams().outFeatures).toBe(10);
  });

  it('选定目标列后才调用 adaptLayersForCsvRegression', async () => {
    setCsvDataset({ targetField: 'target' });
    render(<LayerLibrary />);
    await clickMlpCard();
    expect(adaptLayersForCsvRegression).toHaveBeenCalledTimes(1);
  });

  it('选定目标列后使用正确 featureCount（排除目标列后的特征数）', async () => {
    // 3 列 - 目标列 = 2 个特征。
    setCsvDataset({ targetField: 'target' });
    render(<LayerLibrary />);
    await clickMlpCard();
    expect(adaptLayersForCsvRegression).toHaveBeenCalledWith(expect.anything(), 2);
    // 实际写入：Input 1×1×2；首个 Linear 的 inFeatures 接上特征数；末层 Linear 单值输出。
    expect(inputParams()).toMatchObject({ inChannels: 1, inputHeight: 1, inputWidth: 2 });
    const linears = useLayerStore.getState().layers.filter(layer => layer.type === 'Linear');
    expect(linears[0].params.inFeatures).toBe(2);
    expect(linears[linears.length - 1].params.outFeatures).toBe(1);
  });

  it('group 策略下 featureCount 额外排除激活的 groupField', async () => {
    setCsvDataset({ targetField: 'target', splitStrategy: 'group', groupField: 'a' });
    render(<LayerLibrary />);
    await clickMlpCard();
    expect(adaptLayersForCsvRegression).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it('无数据集时仍按模板添加（不触发 CSV 适配）', async () => {
    useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
    render(<LayerLibrary />);
    await clickMlpCard();
    expect(adaptLayersForCsvRegression).not.toHaveBeenCalled();
    expect(inputParams()).toMatchObject({ inChannels: 1, inputHeight: 28, inputWidth: 28 });
  });
});

describe('LayerLibrary 经典模型展开标题的可访问性语义', () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: [], selectedId: null });
    useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
  });

  it('标题是原生 button：type=button、无 tabindex 伪装、无嵌套按钮', () => {
    render(<LayerLibrary />);
    const toggle = getClassicToggle();
    expect(toggle.tagName).toBe('BUTTON');
    // 默认 submit 会在表单里误触发提交，这里必须是 button
    expect(toggle).toHaveAttribute('type', 'button');
    // 原生 button 已在 Tab 序列里；用 role/tabIndex 冒充键盘可达是本任务要修的反模式
    expect(toggle).not.toHaveAttribute('tabindex');
    expect(toggle).not.toBeDisabled();
    expect(within(toggle).queryByRole('button')).toBeNull();
  });

  it('默认收起：aria-expanded=false，且 aria-controls 不指向不存在的目标', () => {
    render(<LayerLibrary />);
    const toggle = getClassicToggle();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(screen.queryByTestId('model-card-mlp')).toBeNull();
    expect(document.getElementById(controlsId as string)).toBeNull();
  });

  it('展开后 aria-expanded=true，且 aria-controls 指向真实列表容器', () => {
    render(<LayerLibrary />);
    const toggle = getClassicToggle();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(toggle.getAttribute('aria-controls') as string);
    expect(list).not.toBeNull();
    expect(within(list as HTMLElement).getByTestId('model-card-mlp')).toBeInTheDocument();
  });

  it('再激活一次收起：状态回到 false 且列表消失', () => {
    render(<LayerLibrary />);
    const toggle = getClassicToggle();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('model-card-mlp')).toBeNull();
    expect(document.getElementById(toggle.getAttribute('aria-controls') as string)).toBeNull();
  });

  it('连点只切换展示状态：layers/selectedId/数据集的值快照完全不变', () => {
    const addLayer = useLayerStore.getState().addLayer;
    addLayer('Input', [0, 1, 0]);
    addLayer('Linear', [0, 2, 0]);
    const layersBefore = useLayerStore.getState().layers;
    const snapshotBefore = businessSnapshot();

    render(<LayerLibrary />);
    const toggle = getClassicToggle();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    // 引用不变 = store 完全没有被写过；值快照兜住「原地改写数组」这类漏网情况
    expect(useLayerStore.getState().layers).toBe(layersBefore);
    expect(businessSnapshot()).toEqual(snapshotBefore);
    expect(snapshotBefore.layers).toHaveLength(2);
  });

  it('组件不自绑 keydown 切换逻辑，避免原生激活与合成 click 叠加成双重切换', () => {
    render(<LayerLibrary />);
    const toggle = getClassicToggle();
    // happy-dom 不执行 button 的默认激活行为：以下每个按键事件都必须「什么都不改变」。
    // 若组件自己写了一套 keydown 切换，这里会在第一个按键后就失败（真实浏览器里
    // 同一按键还会再触发一次原生 click，即展开后又收起）。逐键断言，避免偶数次切换回到原状态而漏判。
    fireEvent.keyDown(toggle, { key: 'Enter', code: 'Enter' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyUp(toggle, { key: 'Enter', code: 'Enter' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(toggle, { key: ' ', code: 'Space' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyUp(toggle, { key: ' ', code: 'Space' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // 同一时刻鼠标 click 仍是唯一切换入口，一次点击只切换一次
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('展开后点「+ 添加」仍按原规则追加，不替换既有网络', () => {
    useLayerStore.getState().addLayer('ReLU', [0, 1, 0]);
    const layersBefore = useLayerStore.getState().layers;
    const idsBefore = layersBefore.map(layer => layer.id);
    const mlp = CLASSIC_MODELS.find(model => model.id === 'mlp');
    if (!mlp) throw new Error('经典模型模板缺少 mlp，无法验证追加规则');

    render(<LayerLibrary />);
    fireEvent.click(getClassicToggle());
    const card = screen.getByTestId('model-card-mlp');
    fireEvent.click(within(card).getByText('+ 添加'));

    const layersAfter = useLayerStore.getState().layers;
    expect(layersAfter).toHaveLength(layersBefore.length + mlp.layers.length);
    expect(layersAfter.slice(0, layersBefore.length).map(layer => layer.id)).toEqual(idsBefore);
    expect(layersAfter[layersBefore.length].type).toBe(mlp.layers[0].type);
    expect(layersAfter.map(layer => layer.order)).toEqual(
      layersAfter.map((_layer, index) => index),
    );
  });
});

describe('LayerLibrary 层组件库总标题的可访问性语义', () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: [], selectedId: null });
    useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
  });

  it('总标题是原生 button：type=button、无 tabindex 伪装、无嵌套按钮', () => {
    render(<LayerLibrary />);
    const title = getPanelTitle();
    expect(title.tagName).toBe('BUTTON');
    expect(title).toHaveAttribute('type', 'button');
    expect(title).not.toHaveAttribute('tabindex');
    expect(title).not.toBeDisabled();
    expect(within(title).queryByRole('button')).toBeNull();
  });

  it('默认展开：aria-expanded=true 且 aria-controls 指向真实层列表', () => {
    render(<LayerLibrary />);
    const title = getPanelTitle();
    expect(title).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(title.getAttribute('aria-controls') as string);
    expect(list).not.toBeNull();
    // 层列表里真的有分类卡片，说明 aria-expanded 不是空承诺
    expect(within(list as HTMLElement).getAllByTestId(/block-card-/).length).toBeGreaterThan(0);
  });

  it('收起后 aria-expanded=false，层列表整体不渲染（不留可聚焦的隐藏控件）', () => {
    render(<LayerLibrary />);
    const title = getPanelTitle();
    fireEvent.click(title);
    expect(title).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(title.getAttribute('aria-controls') as string)).toBeNull();
    // 条件渲染：折叠后区内没有任何可聚焦控件
    const focusables = Array.from(document.querySelectorAll(
      '[data-testid="block-library"] button, [data-testid="block-library"] [tabindex]',
    ));
    expect(focusables).toHaveLength(1);
    expect(focusables[0]).toBe(title);
  });

  it('总标题来回切换：aria-expanded 与层列表显示始终一致', () => {
    render(<LayerLibrary />);
    const title = getPanelTitle();
    const listId = title.getAttribute('aria-controls') as string;
    for (const expected of ['false', 'true', 'false']) {
      fireEvent.click(title);
      expect(title).toHaveAttribute('aria-expanded', expected);
      expect(document.getElementById(listId) === null).toBe(expected === 'false');
    }
  });

  it('总标题不自绑 keydown：逐个合成按键后状态仍与原样一致', () => {
    render(<LayerLibrary />);
    const title = getPanelTitle();
    // happy-dom 不执行 button 默认激活行为：这里只证明组件没写第二套键盘切换逻辑。
    fireEvent.keyDown(title, { key: 'Enter', code: 'Enter' });
    expect(title).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyUp(title, { key: 'Enter', code: 'Enter' });
    expect(title).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(title, { key: ' ', code: 'Space' });
    expect(title).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyUp(title, { key: ' ', code: 'Space' });
    expect(title).toHaveAttribute('aria-expanded', 'true');
  });

  it('两个标题连点只改展示状态：网络与数据集的值快照不变', () => {
    const addLayer = useLayerStore.getState().addLayer;
    addLayer('Input', [0, 1, 0]);
    addLayer('Linear', [0, 2, 0]);
    setCsvDataset({ targetField: 'target' });
    const snapshotBefore = businessSnapshot();

    render(<LayerLibrary />);
    const title = getPanelTitle();
    const classicToggle = getClassicToggle();
    fireEvent.click(title);
    fireEvent.click(title);
    fireEvent.click(classicToggle);
    fireEvent.click(classicToggle);

    expect(businessSnapshot()).toEqual(snapshotBefore);
    expect(useLayerStore.getState().layers).toHaveLength(2);
    // 折叠总标题后重新展开，预设卡片仍能出现，说明状态没被持久化或丢失
    fireEvent.click(getPanelTitle());
    fireEvent.click(getPanelTitle());
    expect(businessSnapshot()).toEqual(snapshotBefore);
  });
});

describe('LayerLibrary 预设「+ 添加」键盘入口', () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: [], selectedId: null });
    useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
    // 适配监视器是模块级 vi.fn，本 describe 自己清零，避免沿用上一个用例的调用记录
    vi.mocked(adaptLayersForCsvRegression).mockClear();
  });

  function expandPresets() {
    render(<LayerLibrary />);
    fireEvent.click(getClassicToggle());
  }

  it('展开后每个预设都有名称可区分、语义正确的原生添加按钮', () => {
    expandPresets();
    const expectedNames = CLASSIC_MODELS.map(model => `添加 ${model.name} 预设`);
    // 名称集合必须与预设数量一致，否则两个按钮无法用读屏区分
    expect(new Set(expectedNames).size).toBe(CLASSIC_MODELS.length);
    for (const name of expectedNames) {
      const addButton = screen.getByRole('button', { name });
      expect(addButton.tagName).toBe('BUTTON');
      expect(addButton).toHaveAttribute('type', 'button');
      // 可见文字仍是「+ 添加」，布局不因可访问名称而变长
      expect(addButton).toHaveTextContent('+ 添加');
      // 卡片必须是普通容器：不能把 button 嵌进另一个 button（closest 含自身，故从父级查起）
      expect(addButton.parentElement?.closest('button')).toBeNull();
    }
  });

  it('点添加按钮只添加一套预设：冒泡不会让父卡片再加一次', () => {
    expandPresets();
    const mlp = presetName('mlp');
    fireEvent.click(screen.getByRole('button', { name: `添加 ${mlp.name} 预设` }));
    const layers = useLayerStore.getState().layers;
    // 若 stopPropagation 失效，这里会变成 2 倍层数
    expect(layers).toHaveLength(mlp.layers.length);
    expect(layers.map(layer => layer.type)).toEqual(mlp.layers.map(layer => layer.type));
  });

  it('整张卡片的鼠标点击仍然添加一次，卡片入口没有被取消', () => {
    expandPresets();
    const mlp = presetName('mlp');
    fireEvent.click(screen.getByTestId('model-card-mlp'));
    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(mlp.layers.length);
    expect(layers.map(layer => layer.type)).toEqual(mlp.layers.map(layer => layer.type));
  });

  it('添加按钮路径同样保留原有网络并按顺序追加', () => {
    const addLayer = useLayerStore.getState().addLayer;
    addLayer('ReLU', [0, 1, 0]);
    const idsBefore = useLayerStore.getState().layers.map(layer => layer.id);
    expandPresets();
    const lenet = presetName('lenet5');
    fireEvent.click(screen.getByRole('button', { name: `添加 ${lenet.name} 预设` }));
    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(1 + lenet.layers.length);
    expect(layers.slice(0, 1).map(layer => layer.id)).toEqual(idsBefore);
    expect(layers.slice(1).map(layer => layer.type)).toEqual(lenet.layers.map(layer => layer.type));
    expect(layers.map(layer => layer.order)).toEqual(layers.map((_l, index) => index));
  });

  it('添加按钮不自绑键盘逻辑：合成按键不会凭空或重复添加', () => {
    expandPresets();
    const mlp = presetName('mlp');
    const addButton = screen.getByRole('button', { name: `添加 ${mlp.name} 预设` });
    const snapshotBefore = businessSnapshot();
    // happy-dom 不执行 button 默认激活行为：真实 Enter/Space 是否各添加一次必须真机复测。
    fireEvent.keyDown(addButton, { key: 'Enter', code: 'Enter' });
    expect(businessSnapshot()).toEqual(snapshotBefore);
    fireEvent.keyUp(addButton, { key: 'Enter', code: 'Enter' });
    expect(businessSnapshot()).toEqual(snapshotBefore);
    fireEvent.keyDown(addButton, { key: ' ', code: 'Space' });
    expect(businessSnapshot()).toEqual(snapshotBefore);
    fireEvent.keyUp(addButton, { key: ' ', code: 'Space' });
    expect(businessSnapshot()).toEqual(snapshotBefore);
  });

  it('仅展开/收起经典模型区不执行任何添加', () => {
    render(<LayerLibrary />);
    const toggle = getClassicToggle();
    const snapshotBefore = businessSnapshot();
    fireEvent.click(toggle);
    expect(businessSnapshot()).toEqual(snapshotBefore);
    fireEvent.click(toggle);
    expect(businessSnapshot()).toEqual(snapshotBefore);
    expect(useLayerStore.getState().layers).toHaveLength(0);
  });

  it('CSV 未选目标列：按钮路径同样不做回归适配，加入原模板', () => {
    setCsvDataset({ targetField: null });
    expandPresets();
    const mlp = presetName('mlp');
    fireEvent.click(screen.getByRole('button', { name: `添加 ${mlp.name} 预设` }));
    expect(adaptLayersForCsvRegression).not.toHaveBeenCalled();
    expect(inputParams()).toMatchObject({ inChannels: 1, inputHeight: 28, inputWidth: 28 });
  });

  it('CSV 选定目标列：按钮路径使用共享特征契约完成回归适配', () => {
    setCsvDataset({ targetField: 'target' });
    expandPresets();
    const mlp = presetName('mlp');
    fireEvent.click(screen.getByRole('button', { name: `添加 ${mlp.name} 预设` }));
    expect(adaptLayersForCsvRegression).toHaveBeenCalledTimes(1);
    expect(adaptLayersForCsvRegression).toHaveBeenCalledWith(expect.anything(), 2);
    expect(lastLinearParams().outFeatures).toBe(1);
  });

  it('图像数据集：按钮路径仍按实际形状适配 Input 层', () => {
    // 图像分支（channels/height/width 齐全）必须继续走 adaptLayersToInputShape，
    // 不能因为把「+ 添加」提成按钮而退化成原模板。
    useDatasetStore.setState({
      ...useDatasetStore.getInitialState(),
      datasetType: 'cifar10',
      datasetPath: 'D:/cifar10',
      datasetInfo: {
        name: 'cifar10',
        type: 'cifar10',
        sampleCount: 1000,
        classCount: 10,
        channels: 3,
        imageHeight: 32,
        imageWidth: 32,
        datasetId: 'ds-img',
        contentHash: 'hash-img',
      },
    });
    expandPresets();
    const mlp = presetName('mlp');
    fireEvent.click(screen.getByRole('button', { name: `添加 ${mlp.name} 预设` }));
    expect(inputParams()).toMatchObject({ inChannels: 3, inputHeight: 32, inputWidth: 32 });
    expect(adaptLayersForCsvRegression).not.toHaveBeenCalled();
  });
});
