/**
 * S2 真实接线测试：HelpPanel 与 QuickStartGuide 均不 mock，
 * 只 mock 兄弟面板与重型场景组件，确保断言的是 MainLayout → HelpPanel → 引导 → expandPanel
 * 这条真实回调链，而不是被 mock 掩盖的假象。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layout/MainLayout';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { WORKSPACE_PREFS_STORAGE_KEY } from '@/utils/workspaceLayoutUtils';

vi.mock('@/components/layout/TitleBar', () => ({ default: () => <div data-testid="mock-title-bar" /> }));
vi.mock('@/components/panels/LayerLibrary', () => ({ default: () => <div data-testid="mock-layer-library" /> }));
vi.mock('@/components/scene3d/NeuroScene', () => ({ default: () => <div data-testid="mock-neuro-scene" /> }));
vi.mock('@/components/scene3d/SceneControls', () => ({ default: () => <div data-testid="mock-scene-controls" /> }));
vi.mock('@/components/panels/ParamPanel', () => ({ default: () => <div data-testid="mock-panel-param" /> }));
vi.mock('@/components/scene3d/SceneStats', () => ({ default: () => <div data-testid="mock-scene-stats" /> }));
vi.mock('@/components/panels/ErrorPanel', () => ({ default: () => <div data-testid="mock-error-panel" /> }));
vi.mock('@/components/panels/DatasetPanel', () => ({ default: () => <div data-testid="mock-panel-dataset" /> }));
vi.mock('@/components/panels/ExportPanel', () => ({ default: () => <div data-testid="mock-panel-export" /> }));
vi.mock('@/components/panels/GPUPanel', () => ({ default: () => <div data-testid="mock-panel-gpu" /> }));
vi.mock('@/components/panels/CloudPanel', () => ({ default: () => <div data-testid="mock-panel-cloud" /> }));
vi.mock('@/components/panels/PredictPanel', () => ({ default: () => <div data-testid="mock-panel-predict" /> }));
vi.mock('@/components/panels/CodePanel', () => ({ default: () => <div data-testid="mock-panel-code" /> }));
vi.mock('@/components/panels/StudyPanel', () => ({ default: () => <div data-testid="mock-panel-study" /> }));
vi.mock('@/components/training/TrainMonitor', () => ({ default: () => <div data-testid="mock-panel-trainmonitor" /> }));
vi.mock('@/components/training/QuickTrain', () => ({ default: () => <div data-testid="mock-quick-train" /> }));
vi.mock('@/components/training/TrainProgress', () => ({ default: () => <div data-testid="mock-train-progress" /> }));

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function panelTitle(container: HTMLElement): string | undefined {
  return container.querySelector('.right-panel-host__header')?.textContent;
}

function readPrefs(): Record<string, unknown> {
  const raw = window.localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

/** 用标准 Storage API 枚举键名（happy-dom 不把键暴露为可枚举属性）。 */
function storageKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key !== null) keys.push(key);
  }
  return keys.sort();
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  setWindowWidth(1024);
  act(() => {
    useLayerStore.setState({ layers: [], selectedId: null });
  });
});

describe('MainLayout 与帮助引导的真实导航接线', () => {
  it('打开帮助后点导航按钮：切换到真实目标面板并强制展开', () => {
    const view = render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    expect(panelTitle(view.container)).toBe('帮助');
    expect(view.getByTestId('quick-start-guide')).toBeInTheDocument();

    fireEvent.click(view.getByTestId('guide-nav-dataset'));
    expect(panelTitle(view.container)).toBe('数据集');
    expect(view.getByTestId('mock-panel-dataset')).toBeInTheDocument();
    expect(view.getByTestId('right-panel').style.display).not.toBe('none');
    // 复用既有唯一面板状态：写回的仍是同一个持久化键，没有第二套导航状态
    expect(readPrefs()).toMatchObject({ activePanel: 'dataset', collapsed: false });
  });

  it('引导里每个导航按钮都能在主工作区把面板切过去（逐个真实验证）', () => {
    const view = render(<MainLayout />);
    const cases = [
      { panelId: 'dataset', title: '数据集', marker: 'mock-panel-dataset' },
      { panelId: 'trainMonitor', title: '训练监控', marker: 'mock-panel-trainmonitor' },
      { panelId: 'predict', title: '推理', marker: 'mock-panel-predict' },
      { panelId: 'study', title: '课题', marker: 'mock-panel-study' },
      { panelId: 'export', title: '导出', marker: 'mock-panel-export' },
    ] as const;

    for (const item of cases) {
      fireEvent.click(screen.getByRole('button', { name: '帮助' }));
      fireEvent.click(view.getByTestId(`guide-nav-${item.panelId}`));
      expect(panelTitle(view.container), `引导导航未切到 ${item.title}`).toBe(item.title);
      expect(view.getByTestId(item.marker)).toBeInTheDocument();
    }

    // 参数面板：未选中积木时按既有语义显示整体统计，而不是参数编辑器
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    fireEvent.click(view.getByTestId('guide-nav-param'));
    expect(panelTitle(view.container)).toBe('参数');
    expect(view.getByTestId('mock-scene-stats')).toBeInTheDocument();
  });

  it('收起状态下的导航沿用 expandPanel 语义：切换即展开', () => {
    const view = render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: '数据集' }));
    fireEvent.click(screen.getByRole('button', { name: '数据集' })); // 再点一次收起
    expect(view.getByTestId('right-panel').style.display).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: '帮助' })); // 切换自动展开
    expect(view.getByTestId('right-panel').style.display).not.toBe('none');
    fireEvent.click(view.getByTestId('guide-nav-param'));
    expect(panelTitle(view.container)).toBe('参数');
    expect(readPrefs()).toMatchObject({ activePanel: 'param', collapsed: false });
  });

  it('导航只改面板身份：不动积木、不选数据集、不启动训练，也不新增持久化键', () => {
    const layersBefore = useLayerStore.getState().layers;
    const selectedBefore = useLayerStore.getState().selectedId;
    const datasetBefore = useDatasetStore.getState().datasetInfo;
    const trainingBefore = useTrainingStore.getState().isTraining;

    const view = render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    const keysBefore = storageKeys();
    for (const panelId of ['dataset', 'param', 'trainMonitor', 'predict', 'study', 'export']) {
      fireEvent.click(view.getByTestId(`guide-nav-${panelId}`));
      fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    }

    expect(useLayerStore.getState().layers).toBe(layersBefore);
    expect(useLayerStore.getState().selectedId).toBe(selectedBefore);
    expect(useDatasetStore.getState().datasetInfo).toBe(datasetBefore);
    expect(useTrainingStore.getState().isTraining).toBe(trainingBefore);
    // 导航不新增持久化键；面板身份仍由既有工作区偏好键唯一持有
    expect(storageKeys()).toEqual(keysBefore);
    expect(readPrefs().activePanel).toBe('help');
  });

  it('较窄窗口中折叠引导不影响帮助宿主（不替代真实像素布局验收）', () => {
    setWindowWidth(900);
    const view = render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));

    const toggle = view.getByTestId('quick-start-guide-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(view.queryAllByTestId(/^guide-step-/)).toHaveLength(0);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(view.queryAllByTestId(/^guide-step-/)).toHaveLength(7);
    // 帮助面板未被引导折叠影响：标题与容器仍在
    expect(panelTitle(view.container)).toBe('帮助');
  });

  it('收起再展开右栏时，帮助引导保留自身的折叠状态', () => {
    const view = render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    fireEvent.click(view.getByTestId('quick-start-guide-toggle'));
    expect(view.getByTestId('quick-start-guide-toggle')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    expect(view.getByTestId('right-panel').style.display).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    expect(view.getByTestId('right-panel').style.display).not.toBe('none');
    expect(view.getByTestId('quick-start-guide-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(view.queryAllByTestId(/^guide-step-/)).toHaveLength(0);
  });
});
