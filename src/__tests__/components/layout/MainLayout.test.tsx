import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layout/MainLayout';
import { useLayerStore } from '@/stores/useLayerStore';
import { WORKSPACE_PREFS_STORAGE_KEY } from '@/utils/workspaceLayoutUtils';

// 3D 场景与业务面板全部替换为纯 DOM 标记：本测试只验证布局/导航/持久化语义，
// 不触碰任何业务面板内部实现。
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
vi.mock('@/components/panels/HelpPanel', () => ({ default: () => <div data-testid="mock-panel-help" /> }));
vi.mock('@/components/panels/PredictPanel', () => ({ default: () => <div data-testid="mock-panel-predict" /> }));
vi.mock('@/components/panels/CodePanel', () => ({ default: () => <div data-testid="mock-panel-code" /> }));
vi.mock('@/components/panels/StudyPanel', () => ({ default: () => <div data-testid="mock-panel-study" /> }));
vi.mock('@/components/training/TrainMonitor', () => ({ default: () => <div data-testid="mock-panel-trainmonitor" /> }));
vi.mock('@/components/training/QuickTrain', () => ({ default: () => <div data-testid="mock-quick-train" /> }));
vi.mock('@/components/training/TrainProgress', () => ({ default: () => <div data-testid="mock-train-progress" /> }));

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

/** 当前挂载的业务面板标记（含未选中积木时参数面板的 SceneStats 替代视图）。 */
function mountedPanelMarkers(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="mock-panel-"], [data-testid="mock-scene-stats"]'))
    .map(el => el.getAttribute('data-testid') ?? '');
}

describe('MainLayout 工作区外壳', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    setWindowWidth(1024);
    useLayerStore.setState({ selectedId: null });
  });

  it('默认渲染：参数面板激活，活动栏与分隔条就位', () => {
    const view = render(<MainLayout />);
    expect(view.getByText('参数')).toBeInTheDocument();
    expect(view.getByTestId('mock-scene-stats')).toBeInTheDocument();
    expect(view.getByTestId('panel-selector')).toBeInTheDocument();
    const resizer = view.getByTestId('right-panel-resizer');
    expect(resizer).toHaveAttribute('role', 'separator');
    expect(resizer).toHaveAttribute('aria-valuenow', '280');
    // 中栏与底部训练栏存在且位于同一列
    expect(view.getByTestId('scene-workspace')).toBeInTheDocument();
    expect(view.getByTestId('mock-quick-train')).toBeInTheDocument();
  });

  it('提供跳转主工作区入口与清晰的页面地标', () => {
    render(<MainLayout />);
    expect(screen.getByRole('link', { name: '跳到主工作区' })).toHaveAttribute('href', '#main-workspace');
    expect(screen.getByRole('main', { name: '网络实验工作区' })).toHaveAttribute('id', 'main-workspace');
    expect(screen.getByRole('complementary', { name: '网络层组件' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '三维网络结构场景' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '训练控制' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '参数' })).toBeInTheDocument();
  });

  it('快速连续切换入口：任一时刻只有一个面板，激活图标与内容一致', () => {
    const view = render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: '数据集' }));
    fireEvent.click(screen.getByRole('button', { name: '课题' }));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    // 面板标题栏显示当前面板（精确选择器，避免与工作流阶段名歧义）
    expect(view.container.querySelector('.right-panel-host__header')?.textContent).toBe('导出');
    expect(mountedPanelMarkers(view.container)).toEqual(['mock-panel-export']);
    expect(screen.getByRole('button', { name: '导出' })).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: '课题' })).not.toHaveAttribute('aria-current');
  });

  it('点击当前激活入口收起面板：隐藏但保持挂载，活动栏仍可见且身份保留', () => {
    const view = render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: '参数' }));

    // 收起：不占布局、退出可访问树，但子树保持挂载（局部状态不丢）
    const panel = view.getByTestId('right-panel');
    expect(panel.style.display).toBe('none');
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    // 分隔条在隐藏宿主内，随祖先一起退出布局与 Tab 顺序（自身不再单独渲染开关）
    expect(panel.contains(view.getByTestId('right-panel-resizer'))).toBe(true);
    // 活动栏仍在，且激活身份保留
    expect(screen.getByTestId('panel-selector')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '参数' })).toHaveAttribute('aria-current', 'true');
    // 中央工作区与底部训练栏不受影响
    expect(view.getByTestId('scene-workspace')).toBeInTheDocument();
  });

  it('收起后再次点击同一入口恢复面板与最近合法宽度', () => {
    const view = render(<MainLayout />);
    // 先调整宽度，制造“最近一次合法宽度 ≠ 默认值”
    fireEvent.keyDown(view.getByTestId('right-panel-resizer'), { key: 'ArrowLeft' });
    expect(view.getByTestId('right-panel-resizer')).toHaveAttribute('aria-valuenow', '292');

    fireEvent.click(screen.getByRole('button', { name: '参数' })); // 收起
    expect(view.getByTestId('right-panel').style.display).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: '参数' })); // 恢复

    expect(view.getByTestId('right-panel').style.display).not.toBe('none');
    expect(view.getByTestId('right-panel-resizer')).toHaveAttribute('aria-valuenow', '292');
  });

  it('收起状态下选中积木：参数面板自动激活并展开（既有行为不回归）', () => {
    const view = render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: '数据集' }));
    fireEvent.click(screen.getByRole('button', { name: '参数' })); // 切回参数面板（激活）
    fireEvent.click(screen.getByRole('button', { name: '参数' })); // 再次点击：收起
    expect(view.getByTestId('right-panel').style.display).toBe('none');

    act(() => {
      useLayerStore.setState({ selectedId: 'layer-1' });
    });

    expect(view.getByTestId('right-panel').style.display).not.toBe('none');
    expect(view.getByText('参数')).toBeInTheDocument();
    expect(view.getByTestId('mock-panel-param')).toBeInTheDocument();
  });

  it('偏好持久化：切换后重启仍恢复激活面板与收起状态', () => {
    const first = render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: '代码' }));
    first.unmount();

    const stored = JSON.parse(window.localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY) ?? '');
    expect(stored.activePanel).toBe('code');

    const second = render(<MainLayout />);
    expect(second.getByText('代码')).toBeInTheDocument();
    expect(second.getByTestId('mock-panel-code')).toBeInTheDocument();
  });

  it('持久化的未知面板 ID / 损坏 JSON 均回退默认面板启动', () => {
    window.localStorage.setItem(
      WORKSPACE_PREFS_STORAGE_KEY,
      JSON.stringify({ version: 1, activePanel: 'ghost-panel', collapsed: false }),
    );
    const first = render(<MainLayout />);
    expect(first.getByText('参数')).toBeInTheDocument();
    first.unmount();

    window.localStorage.setItem(WORKSPACE_PREFS_STORAGE_KEY, '{not json');
    const second = render(<MainLayout />);
    expect(second.getByText('参数')).toBeInTheDocument();
  });

  it('localStorage 读取异常不白屏', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    const view = render(<MainLayout />);
    expect(view.getByText('参数')).toBeInTheDocument();
    expect(view.getByTestId('panel-selector')).toBeInTheDocument();
  });

  it('localStorage 写入异常不阻断面板切换', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: '推理' }));
    expect(screen.getByRole('button', { name: '推理' })).toHaveAttribute('aria-current', 'true');
  });

  it('分隔条键盘调整：方向键 / Shift 大步 / Home / End 均落在合法边界', () => {
    const view = render(<MainLayout />);
    const resizer = view.getByTestId('right-panel-resizer');

    fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
    expect(resizer).toHaveAttribute('aria-valuenow', '292');

    fireEvent.keyDown(resizer, { key: 'ArrowLeft', shiftKey: true });
    expect(resizer).toHaveAttribute('aria-valuenow', '340');

    fireEvent.keyDown(resizer, { key: 'End' });
    // 动态上限 = 1024 - 预留(240+320+48) = 416，而非静态 560
    expect(resizer).toHaveAttribute('aria-valuenow', '416');

    fireEvent.keyDown(resizer, { key: 'Home' });
    expect(resizer).toHaveAttribute('aria-valuenow', '260');

    fireEvent.doubleClick(resizer);
    expect(resizer).toHaveAttribute('aria-valuenow', '280');
  });

  it('拖拽宽度不突破动态边界', () => {
    const view = render(<MainLayout />);
    const resizer = view.getByTestId('right-panel-resizer');

    fireEvent.pointerDown(resizer, { button: 0, pointerId: 3, clientX: 700 });
    // 向左拖动很远：应被动态上限 416 截断
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 100 });
    expect(resizer).toHaveAttribute('aria-valuenow', '416');

    // 向右拖动很远：应被最小值 260 截断
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 2000 });
    expect(resizer).toHaveAttribute('aria-valuenow', '260');

    fireEvent.pointerUp(window, { pointerId: 3, clientX: 2000 });
  });

  it('窄窗口确定性降级：自动收起（隐藏）右侧面板而非横向溢出', () => {
    setWindowWidth(800); // 800 - 608(预留) = 192 < 260(最小面板宽度)
    const view = render(<MainLayout />);
    const panel = view.getByTestId('right-panel');
    expect(panel.style.display).toBe('none');
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(view.getByTestId('panel-selector')).toBeInTheDocument();
    expect(view.getByTestId('scene-workspace')).toBeInTheDocument();
  });

  it('ARIA 数值与实际宽度一致', () => {
    const view = render(<MainLayout />);
    const resizer = view.getByTestId('right-panel-resizer');
    const panel = view.getByTestId('right-panel');
    expect(panel.style.width).toBe(`${resizer.getAttribute('aria-valuenow')}px`);
  });
});
