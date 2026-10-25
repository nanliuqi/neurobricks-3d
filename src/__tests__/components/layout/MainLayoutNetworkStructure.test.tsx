/**
 * N2 接线测试：渲染真实 MainLayout，只把与本次无关的业务面板与 3D 场景换成标记节点。
 * NetworkStructureOverview / ParamPanel / SceneStats 全部使用真实实现，
 * 因此这里证明的是「真的接上了」，而不是「mock 之间能跑通」。
 * 证据边界：happy-dom 不实现按钮原生 Enter/Space 激活，也不做真实布局，
 * 焦点用例只验证 React 重渲染后 DOM 节点与焦点未被卸载，不代表桌面端视觉验收。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layout/MainLayout';
import SceneStats from '@/components/scene3d/SceneStats';
import { useLayerStore } from '@/stores/useLayerStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import type { Layer3D, LayerType } from '@/types/layer';

vi.mock('@/components/layout/TitleBar', () => ({ default: () => <div data-testid="mock-title-bar" /> }));
vi.mock('@/components/panels/LayerLibrary', () => ({ default: () => <div data-testid="mock-layer-library" /> }));
vi.mock('@/components/scene3d/NeuroScene', () => ({ default: () => <div data-testid="mock-neuro-scene" /> }));
vi.mock('@/components/scene3d/SceneControls', () => ({ default: () => <div data-testid="mock-scene-controls" /> }));
vi.mock('@/components/panels/ErrorPanel', () => ({ default: () => <div data-testid="mock-error-panel" /> }));
vi.mock('@/components/panels/DatasetPanel', () => ({ default: () => <div data-testid="mock-panel-dataset" /> }));
vi.mock('@/components/panels/ExportPanel', () => ({ default: () => <div data-testid="mock-panel-export" /> }));
vi.mock('@/components/panels/GPUPanel', () => ({ default: () => <div data-testid="mock-panel-gpu" /> }));
vi.mock('@/components/panels/CloudPanel', () => ({ default: () => <div data-testid="mock-panel-cloud" /> }));
vi.mock('@/components/panels/HelpPanel', () => ({ default: () => <div data-testid="mock-panel-help" /> }));
vi.mock('@/components/panels/PredictPanel', () => ({ default: () => <div data-testid="mock-panel-predict" /> }));
vi.mock('@/components/panels/CodePanel', () => ({ default: () => <div data-testid="mock-panel-code" /> }));
vi.mock('@/components/panels/StudyPanel', () => ({ default: () => <div data-testid="mock-panel-study" /> }));
vi.mock('@/components/training/TrainMonitor', () => ({ default: () => <div data-testid="mock-panel-trainmonitor" /> }));
vi.mock('@/components/training/QuickTrain', () => ({ default: () => <div data-testid="mock-quick-train" /> }));
vi.mock('@/components/training/TrainProgress', () => ({ default: () => <div data-testid="mock-train-progress" /> }));

function draftLayer(id: string, type: LayerType, order: number, params: Layer3D['params'] = {}): Layer3D {
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

function seed() {
  act(() => {
    useLayerStore.getState().setLayers([
      draftLayer('input-1', 'Input', 0, { inChannels: 3, inputHeight: 24, inputWidth: 40 }),
      draftLayer('conv-1', 'Conv2D', 1, { inChannels: 3, outChannels: 8, kernelSize: 3, stride: 2, padding: 1 }),
    ]);
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

function trainingSnapshot() {
  return JSON.parse(JSON.stringify({
    status: useTrainingStore.getState().status,
    isTraining: useTrainingStore.getState().isTraining,
    isPaused: useTrainingStore.getState().isPaused,
    metrics: useTrainingStore.getState().metrics,
  }));
}

function overviewRows() {
  return screen.getAllByRole('button', { name: /第 \d+ 层 · / });
}

function rowTitle(button: HTMLElement): string {
  return button.firstElementChild?.textContent?.trim() ?? '';
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
  act(() => {
    useLayerStore.setState({ ...useLayerStore.getInitialState() });
    useExperimentStore.getState().resetLedgerForTests();
    useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
    useTrainingStore.setState({ status: 'idle', isTraining: false, isPaused: false, error: null, errorKind: null });
  });
});

describe('MainLayout 与逐层结构清单的真实接线', () => {
  it('参数面板下清单与场景统计同时挂载，且没有第二份网络形状摘要', () => {
    seed();
    render(<MainLayout />);

    // 真实清单（未 mock）渲染出行按钮
    expect(screen.getByText('网络结构')).toBeInTheDocument();
    expect(overviewRows().map(rowTitle)).toEqual(['第 1 层 · 输入层', '第 2 层 · 卷积层']);
    // 真实 SceneStats 仍在，统计项可用
    expect(screen.getByText('场景统计')).toBeInTheDocument();
    expect(screen.getByText('总层数：')).toBeInTheDocument();
    // 去重：由宿主传入显示开关，旧摘要不再渲染
    expect(screen.queryByText('网络形状')).toBeNull();
  });

  it('从清单选层后，已有 ParamPanel 展示该层；清单仍是同一实例且焦点未丢', () => {
    seed();
    render(<MainLayout />);

    const row = overviewRows()[1];
    row.focus();
    expect(document.activeElement).toBe(row);

    fireEvent.click(row);

    // 真实 ParamPanel 展示被选中的层
    expect(screen.getByText('Conv2D · 卷积层')).toBeInTheDocument();
    expect(screen.getByText('outChannels (输出通道)')).toBeInTheDocument();
    expect(useLayerStore.getState().selectedId).toBe('conv-1');
    // 清单没有被条件分支卸载：同一 DOM 节点仍在文档中且保持焦点
    expect(row.isConnected).toBe(true);
    expect(document.activeElement).toBe(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(overviewRows()).toHaveLength(2);
    // SceneStats 被参数编辑器替换，仍不存在重复摘要
    expect(screen.queryByText('场景统计')).toBeNull();
    expect(screen.queryByText('网络形状')).toBeNull();
  });

  it('清单选层只写 selectedId：层数据、训练与数据集状态深值不变', () => {
    seed();
    render(<MainLayout />);
    const layersBefore = businessSnapshot();
    const trainingBefore = trainingSnapshot();
    const datasetBefore = JSON.parse(JSON.stringify(useDatasetStore.getState()));

    fireEvent.click(overviewRows()[1]);

    expect(useLayerStore.getState().selectedId).toBe('conv-1');
    expect(businessSnapshot()).toEqual(layersBefore);
    expect(trainingSnapshot()).toEqual(trainingBefore);
    expect(JSON.parse(JSON.stringify(useDatasetStore.getState()))).toEqual(datasetBefore);
  });

  it('清单选层后 ParamPanel 的编辑/移动/删除仍生效，并驱动清单刷新', () => {
    seed();
    render(<MainLayout />);
    fireEvent.click(overviewRows()[1]);

    // 移动：卷积层上移到第 1 层
    fireEvent.click(screen.getByRole('button', { name: '⇈ 上移' }));
    expect(overviewRows().map(rowTitle)).toEqual(['第 1 层 · 卷积层', '第 2 层 · 输入层']);
    expect(useLayerStore.getState().layers.find(l => l.id === 'conv-1')?.order).toBe(0);

    // 删除当前层后回到场景统计，清单不残留旧行
    fireEvent.click(screen.getByRole('button', { name: '删除此层' }));
    expect(useLayerStore.getState().selectedId).toBeNull();
    expect(screen.getByText('场景统计')).toBeInTheDocument();
    expect(overviewRows().map(rowTitle)).toEqual(['第 1 层 · 输入层']);
    expect(screen.queryByText('网络形状')).toBeNull();
  });

  it('活动栏导航与收起状态不回归：切走时清单卸载，收起时子树仍挂载', () => {
    seed();
    const view = render(<MainLayout />);

    fireEvent.click(screen.getByRole('button', { name: '数据集' }));
    expect(screen.getByTestId('mock-panel-dataset')).toBeInTheDocument();
    expect(screen.queryByText('网络结构')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '参数' }));
    expect(overviewRows()).toHaveLength(2);
    expect(screen.queryByText('网络形状')).toBeNull();

    // 再点一次当前入口 = 收起：隐藏但保持挂载（不卸载清单，局部状态不丢）
    fireEvent.click(screen.getByRole('button', { name: '参数' }));
    const panel = view.getByTestId('right-panel');
    expect(panel.style.display).toBe('none');
    expect(panel.textContent).toContain('网络结构');
    expect(panel.textContent).not.toContain('网络形状');
  });
});

describe('SceneStats 显示开关默认值', () => {
  it('独立使用 SceneStats（默认 props）时网络形状摘要照旧显示', () => {
    seed();
    render(<SceneStats />);
    expect(screen.getByText('网络形状')).toBeInTheDocument();
    expect(screen.getByText('[3, 24, 40]')).toBeInTheDocument();
    expect(screen.getByText('[8, 12, 20]')).toBeInTheDocument();
  });

  it('宿主显式关闭时只去掉摘要，统计与布局/保存入口保留', () => {
    seed();
    render(<SceneStats showNetworkShapeSummary={false} />);
    expect(screen.queryByText('网络形状')).toBeNull();
    expect(screen.getByText('总参数量：')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自由模式' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '💾 保存' })).toBeInTheDocument();
  });
});
