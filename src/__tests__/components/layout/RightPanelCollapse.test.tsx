import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layout/MainLayout';
import { useLayerStore } from '@/stores/useLayerStore';

// 共享挂载计数器：用 vi.hoisted 保证在 vi.mock 工厂提升后仍可安全访问
const mockState = vi.hoisted(() => ({ datasetMounts: 0, exportMounts: 0 }));

// 数据集面板替换为“带局部输入状态”的模拟面板：
// 用于验证收起/展开不卸载组件实例、草稿不丢失；切换面板仍按原语义卸载。
vi.mock('@/components/panels/DatasetPanel', async () => {
  const { useEffect, useState } = await import('react');
  return {
    default: function MockDatasetPanel() {
      useEffect(() => {
        mockState.datasetMounts += 1;
      }, []);
      const [value, setValue] = useState('');
      return (
        <input
          data-testid="mock-dataset-input"
          value={value}
          onChange={event => setValue(event.target.value)}
        />
      );
    },
  };
});

vi.mock('@/components/panels/ExportPanel', async () => {
  const { useEffect } = await import('react');
  return {
    default: function MockExportPanel() {
      useEffect(() => {
        mockState.exportMounts += 1;
      }, []);
      return <div data-testid="mock-panel-export" />;
    },
  };
});

vi.mock('@/components/layout/TitleBar', () => ({ default: () => <div data-testid="mock-title-bar" /> }));
vi.mock('@/components/panels/LayerLibrary', () => ({ default: () => <div data-testid="mock-layer-library" /> }));
vi.mock('@/components/scene3d/NeuroScene', () => ({ default: () => <div data-testid="mock-neuro-scene" /> }));
vi.mock('@/components/scene3d/SceneControls', () => ({ default: () => <div data-testid="mock-scene-controls" /> }));
vi.mock('@/components/panels/ParamPanel', () => ({ default: () => <div data-testid="mock-panel-param" /> }));
vi.mock('@/components/scene3d/SceneStats', () => ({ default: () => <div data-testid="mock-scene-stats" /> }));
vi.mock('@/components/panels/ErrorPanel', () => ({ default: () => <div data-testid="mock-error-panel" /> }));
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

function openDatasetPanelAndType(view: ReturnType<typeof render>, text: string) {
  fireEvent.click(screen.getByRole('button', { name: '数据集' }));
  fireEvent.change(view.getByTestId('mock-dataset-input'), { target: { value: text } });
}

describe('右侧面板收起的状态保留（验收补丁）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    setWindowWidth(1024);
    mockState.datasetMounts = 0;
    mockState.exportMounts = 0;
    act(() => {
      useLayerStore.setState({ selectedId: null });
    });
  });

  it('收起不卸载面板：草稿保留、实例不重建；展开后原样恢复', () => {
    const view = render(<MainLayout />);
    openDatasetPanelAndType(view, '我的数据集草稿');
    expect(mockState.datasetMounts).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '数据集' })); // 再次点击：收起
    const panel = view.getByTestId('right-panel');
    // 收起：不可见、不占布局宽度、退出可访问树
    expect(panel.style.display).toBe('none');
    expect(panel.style.width).toBe('');
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    // 但子树仍挂载：输入节点还在（仅被隐藏），且未重新挂载
    const input = view.getByTestId('mock-dataset-input') as HTMLInputElement;
    expect(input.value).toBe('我的数据集草稿');
    expect(mockState.datasetMounts).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '数据集' })); // 恢复
    expect(view.getByTestId('right-panel').style.display).not.toBe('none');
    expect((view.getByTestId('mock-dataset-input') as HTMLInputElement).value).toBe('我的数据集草稿');
    expect(mockState.datasetMounts).toBe(1); // 同一实例，未重建
  });

  it('切换面板仍是卸载语义：收起后再切走，旧面板实例被卸载', () => {
    const view = render(<MainLayout />);
    openDatasetPanelAndType(view, '会被丢弃的草稿');
    fireEvent.click(screen.getByRole('button', { name: '数据集' })); // 收起

    fireEvent.click(screen.getByRole('button', { name: '导出' })); // 切换：旧面板卸载、新面板挂载
    expect(view.queryByTestId('mock-dataset-input')).not.toBeInTheDocument();
    expect(view.getByTestId('mock-panel-export')).toBeInTheDocument();
    expect(mockState.exportMounts).toBe(1);
    expect(view.getByTestId('right-panel').style.display).not.toBe('none'); // 切换会自动展开

    // 切回数据集：是新实例（原草稿按卸载语义丢弃）
    fireEvent.click(screen.getByRole('button', { name: '数据集' }));
    expect(mockState.datasetMounts).toBe(2);
    expect((view.getByTestId('mock-dataset-input') as HTMLInputElement).value).toBe('');
  });

  it('窄窗口自动收起不丢草稿；窗口恢复后重新展开仍是同一实例', () => {
    const view = render(<MainLayout />);
    openDatasetPanelAndType(view, '窄窗口下的草稿');
    expect(mockState.datasetMounts).toBe(1);

    // 窗口变窄触发确定性降级自动收起
    setWindowWidth(800);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(view.getByTestId('right-panel').style.display).toBe('none');
    expect((view.getByTestId('mock-dataset-input') as HTMLInputElement).value).toBe('窄窗口下的草稿');
    expect(mockState.datasetMounts).toBe(1);

    // 窗口变宽后手动重新展开：草稿仍在、实例未重建
    setWindowWidth(1024);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    fireEvent.click(screen.getByRole('button', { name: '数据集' }));
    expect(view.getByTestId('right-panel').style.display).not.toBe('none');
    expect((view.getByTestId('mock-dataset-input') as HTMLInputElement).value).toBe('窄窗口下的草稿');
    expect(mockState.datasetMounts).toBe(1);
  });

  it('窄窗口自动收起时焦点在面板内：焦点移回活动栏激活入口，无隐藏焦点陷阱', () => {
    const view = render(<MainLayout />);
    openDatasetPanelAndType(view, 'x');
    const input = view.getByTestId('mock-dataset-input') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    setWindowWidth(800);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(view.getByTestId('right-panel').style.display).toBe('none');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '数据集' }));
  });
});
