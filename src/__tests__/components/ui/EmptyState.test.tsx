import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';

describe('EmptyState（设计系统）', () => {
  it('渲染标题、描述与主次操作，且操作可点击', () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(
      <EmptyState
        icon={<svg data-testid="empty-icon" />}
        title="尚未选择数据集"
        description="先在数据集面板导入或选择一个可用数据集，再开始训练。"
        primaryAction={<Button variant="primary" onClick={onPrimary}>去选择数据集</Button>}
        secondaryAction={<Button variant="ghost" onClick={onSecondary}>查看帮助</Button>}
      />,
    );
    expect(screen.getByText('尚未选择数据集')).toBeInTheDocument();
    expect(screen.getByText('先在数据集面板导入或选择一个可用数据集，再开始训练。')).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '去选择数据集' }));
    expect(onPrimary).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '查看帮助' }));
    expect(onSecondary).toHaveBeenCalledOnce();
  });

  it('无操作时正常显示，不渲染空操作区', () => {
    const { container } = render(<EmptyState title="尚无推理卡片" description="训练完成后可以创建推理卡片。" />);
    expect(screen.getByText('尚无推理卡片')).toBeInTheDocument();
    expect(container.querySelector('.nb-empty-state__actions')).toBeNull();
  });

  it('不写死面板级宽高，className/style 透传', () => {
    const { container } = render(
      <EmptyState title="空" className="custom-empty" style={{ height: '100%' }} />,
    );
    const root = container.querySelector('.nb-empty-state') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.className).toContain('custom-empty');
    expect(root.style.height).toBe('100%');
    // 组件自身不声明固定宽度
    expect(root.style.width).toBe('');
  });
});
