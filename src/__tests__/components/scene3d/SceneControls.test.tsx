import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SceneControls from '@/components/scene3d/SceneControls';
import { useLayerStore } from '@/stores/useLayerStore';

afterEach(() => {
  vi.restoreAllMocks();
  useLayerStore.getState().clearAllLayers();
});

describe('SceneControls', () => {
  it('应该渲染所有控制按钮', () => {
    render(<SceneControls />);

    expect(screen.getByText('🔓 视角自由')).toBeInTheDocument();
    expect(screen.getByText('🔄 复位')).toBeInTheDocument();
    expect(screen.getByText('🗑️ 清除')).toBeInTheDocument();
  });

  it('控制按钮应该带有 data-testid（测试钩子）', () => {
    render(<SceneControls />);

    expect(screen.getByTestId('reset-view-btn')).toBeInTheDocument();
    expect(screen.getByTestId('clear-scene-btn')).toBeInTheDocument();
  });

  it('点击视角按钮应该切换锁定状态并发送 scene-lock 事件', () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

    render(<SceneControls />);

    const lockButton = screen.getByText('🔓 视角自由');
    fireEvent.click(lockButton);

    expect(screen.getByText('🔒 视角已锁定')).toBeInTheDocument();
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scene-lock' })
    );
  });

  it('点击复位按钮应该触发 scene-reset 事件', () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

    render(<SceneControls />);

    const resetButton = screen.getByText('🔄 复位');
    fireEvent.click(resetButton);

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scene-reset' })
    );
  });

  it('点击清除按钮确认后应该清空 store 中的图层', () => {
    // 预置图层
    useLayerStore.getState().addLayer('Input', [0, 0, 0]);
    expect(useLayerStore.getState().layers).toHaveLength(1);

    render(<SceneControls />);

    const clearButton = screen.getByText('🗑️ 清除');
    fireEvent.click(clearButton);

    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(screen.getByRole('alertdialog', { name: '确认清空场景？' })).toBeInTheDocument();
    expect(screen.getByText('场景中的 1 个积木将被删除，应用内无法撤销。已单独保存的项目文件不受影响。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '确认清除' }));

    expect(useLayerStore.getState().layers).toHaveLength(0);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('点击清除按钮取消确认时不应清空图层', () => {
    useLayerStore.getState().addLayer('Input', [0, 0, 0]);
    const selectedId = useLayerStore.getState().layers[0].id;
    useLayerStore.getState().setSelectedId(selectedId);

    render(<SceneControls />);

    const clearButton = screen.getByText('🗑️ 清除');
    fireEvent.click(clearButton);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(useLayerStore.getState().selectedId).toBe(selectedId);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('按 Escape 应关闭确认框且不清空图层', () => {
    useLayerStore.getState().addLayer('Input', [0, 0, 0]);
    render(<SceneControls />);

    fireEvent.click(screen.getByText('🗑️ 清除'));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('确认框打开时场景删除快捷键不应穿透', () => {
    useLayerStore.getState().addLayer('Input', [0, 0, 0]);
    const simulatedSceneShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Backspace') useLayerStore.getState().clearAllLayers();
    };
    window.addEventListener('keydown', simulatedSceneShortcut);

    try {
      render(<SceneControls />);
      fireEvent.click(screen.getByText('🗑️ 清除'));
      fireEvent.keyDown(window, { key: 'Backspace' });

      expect(useLayerStore.getState().layers).toHaveLength(1);
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    } finally {
      window.removeEventListener('keydown', simulatedSceneShortcut);
    }
  });
});
