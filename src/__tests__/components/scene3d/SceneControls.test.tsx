import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SceneControls from '../../components/scene3d/SceneControls';

describe('SceneControls', () => {
  it('应该渲染所有控制按钮', () => {
    render(<SceneControls />);
    
    expect(screen.getByText('🔓 自由')).toBeInTheDocument();
    expect(screen.getByText('🔄 复位')).toBeInTheDocument();
    expect(screen.getByText('🗑️ 清除')).toBeInTheDocument();
  });

  it('点击锁定按钮应该切换状态', () => {
    render(<SceneControls />);
    
    const lockButton = screen.getByText('🔓 自由');
    fireEvent.click(lockButton);
    
    expect(screen.getByText('🔒 已锁定')).toBeInTheDocument();
  });

  it('点击复位按钮应该触发自定义事件', () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    
    render(<SceneControls />);
    
    const resetButton = screen.getByText('🔄 复位');
    fireEvent.click(resetButton);
    
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scene-reset' })
    );
  });

  it('点击清除按钮应该显示确认对话框并触发事件', () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    
    render(<SceneControls />);
    
    const clearButton = screen.getByText('🗑️ 清除');
    fireEvent.click(clearButton);
    
    expect(confirmSpy).toHaveBeenCalled();
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scene-clear' })
    );
    
    confirmSpy.mockRestore();
  });

  it('点击清除按钮时如果取消确认不应该不触发事件', () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    
    render(<SceneControls />);
    
    const clearButton = screen.getByText('🗑️ 清除');
    fireEvent.click(clearButton);
    
    expect(confirmSpy).toHaveBeenCalled();
    expect(dispatchEventSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scene-clear' })
    );
    
    confirmSpy.mockRestore();
  });
});
