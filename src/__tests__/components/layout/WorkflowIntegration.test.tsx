import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layout/MainLayout';
import { useLayerStore } from '@/stores/useLayerStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { useExperimentStore } from '@/stores/useExperimentStore';

const mockMounts = vi.hoisted(() => ({ dataset: 0, param: 0 }));

vi.mock('@/components/panels/DatasetPanel', async () => {
  const { useEffect } = await import('react');
  return {
    default: function MockDatasetPanel() {
      useEffect(() => {
        mockMounts.dataset += 1;
      }, []);
      return <div data-testid="mock-panel-dataset" />;
    },
  };
});
vi.mock('@/components/panels/ParamPanel', async () => {
  const { useEffect } = await import('react');
  return {
    default: function MockParamPanel() {
      useEffect(() => {
        mockMounts.param += 1;
      }, []);
      return <div data-testid="mock-panel-param" />;
    },
  };
});

vi.mock('@/components/layout/TitleBar', () => ({ default: () => <div data-testid="mock-title-bar" /> }));
vi.mock('@/components/panels/LayerLibrary', () => ({ default: () => <div data-testid="mock-layer-library" /> }));
vi.mock('@/components/scene3d/NeuroScene', () => ({ default: () => <div data-testid="mock-neuro-scene" /> }));
vi.mock('@/components/scene3d/SceneControls', () => ({ default: () => <div data-testid="mock-scene-controls" /> }));
vi.mock('@/components/scene3d/SceneStats', () => ({ default: () => <div data-testid="mock-scene-stats" /> }));
vi.mock('@/components/panels/ErrorPanel', () => ({ default: () => <div data-testid="mock-error-panel" /> }));
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

describe('MainLayout 工作流导航集成', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
    mockMounts.dataset = 0;
    mockMounts.param = 0;
    act(() => {
      useLayerStore.setState({ selectedId: null });
      useExperimentStore.getState().resetLedgerForTests();
      useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
      useTrainingStore.setState({ status: 'idle', isTraining: false, isPaused: false, error: null, errorKind: null });
    });
  });

  it('工作流导航呈现六个阶段与下一步建议', () => {
    render(<MainLayout />);
    expect(screen.getByTestId('workflow-bar')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '可信实验工作流' })).toBeInTheDocument();
    for (const id of ['data', 'model', 'train', 'compare', 'claim', 'export']) {
      expect(screen.getByTestId(`workflow-stage-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('workflow-next-action')).toBeInTheDocument();
  });

  it('点击数据阶段：打开数据集面板；收起状态点击会展开', () => {
    render(<MainLayout />);
    // 先收起右侧面板（默认激活参数面板，点击参数入口收起）
    fireEvent.click(screen.getByTestId('panel-option-param'));
    expect(screen.getByTestId('right-panel').style.display).toBe('none');

    fireEvent.click(screen.getByTestId('workflow-stage-data'));
    const panel = screen.getByTestId('right-panel');
    expect(panel.style.display).not.toBe('none');
    expect(screen.getByTestId('mock-panel-dataset')).toBeInTheDocument();
  });

  it('各阶段点击映射到正确面板', () => {
    render(<MainLayout />);
    // 模型阶段导航到参数面板；未选中积木时参数面板呈现场景统计视图（既有行为）
    const expectations: Array<[string, string]> = [
      ['workflow-stage-model', 'mock-scene-stats'],
      ['workflow-stage-train', 'mock-panel-trainmonitor'],
      ['workflow-stage-compare', 'mock-panel-study'],
      ['workflow-stage-claim', 'mock-panel-study'],
      ['workflow-stage-export', 'mock-panel-export'],
    ];
    for (const [stageTestId, panelTestId] of expectations) {
      fireEvent.click(screen.getByTestId(stageTestId));
      expect(screen.getByTestId(panelTestId)).toBeInTheDocument();
    }
  });

  it('点击步骤与建议按钮不修改业务 store、不启动训练', () => {
    render(<MainLayout />);
    fireEvent.click(screen.getByTestId('workflow-stage-data'));
    fireEvent.click(screen.getByTestId('workflow-next-action-btn'));

    expect(useTrainingStore.getState().status).toBe('idle');
    expect(useTrainingStore.getState().isTraining).toBe(false);
    expect(useLayerStore.getState().selectedId).toBeNull();
    expect(useDatasetStore.getState().datasetInfo).toBeNull();
    expect(useExperimentStore.getState().ledger.claims).toHaveLength(0);
  });

  it('工作流状态变化不重新挂载当前右侧面板（草稿不丢）', () => {
    render(<MainLayout />);
    fireEvent.click(screen.getByTestId('workflow-stage-data'));
    expect(mockMounts.dataset).toBe(1);

    // 训练状态变化引起投影更新：数据集面板实例保持挂载
    act(() => useTrainingStore.setState({ status: 'training', isTraining: true }));
    expect(screen.getByTestId('mock-panel-dataset')).toBeInTheDocument();
    expect(mockMounts.dataset).toBe(1);

    act(() => useTrainingStore.setState({ status: 'paused', isPaused: true }));
    expect(mockMounts.dataset).toBe(1);
  });

  it('快速连续切换六个阶段：内容始终与最后一次点击一致', () => {
    render(<MainLayout />);
    for (const id of ['model', 'train', 'compare', 'claim', 'export', 'data']) {
      fireEvent.click(screen.getByTestId(`workflow-stage-${id}`));
    }
    expect(screen.getByTestId('mock-panel-dataset')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-panel-export')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-panel-study')).not.toBeInTheDocument();
  });

  it('窄窗口自动收起面板后，工作流步骤仍全部可见', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 800 });
    render(<MainLayout />);
    for (const id of ['data', 'model', 'train', 'compare', 'claim', 'export']) {
      expect(screen.getByTestId(`workflow-stage-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('right-panel').style.display).toBe('none');
  });
});
