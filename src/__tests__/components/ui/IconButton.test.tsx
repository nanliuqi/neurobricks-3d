import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IconButton from '@/components/ui/IconButton';
import Tooltip from '@/components/ui/Tooltip';

const TrashIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
    <path d="M3 4h10M6.5 4V2.8h3V4M4.5 4l.6 9h5.8l.6-9" />
  </svg>
);

describe('IconButton（设计系统）', () => {
  it('必须有可访问名称（aria-label）', () => {
    render(<IconButton label="删除这条主张" icon={TrashIcon} />);
    expect(screen.getByRole('button', { name: '删除这条主张' })).toBeInTheDocument();
  });

  it('使用原生 button 元素，整个点击区域可触发，支持键盘激活', () => {
    const onClick = vi.fn();
    render(<IconButton label="重试" icon={TrashIcon} onClick={onClick} />);
    const button = screen.getByRole('button', { name: '重试' });
    // 原生 <button> 保证 Enter/Space 键盘激活，无需自造可聚焦 div
    expect(button.tagName).toBe('BUTTON');
    expect(button.tabIndex).toBe(0);
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disabled 不触发回调', () => {
    const onClick = vi.fn();
    render(<IconButton label="冻结" icon={TrashIcon} disabled onClick={onClick} />);
    const button = screen.getByRole('button', { name: '冻结' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading 期间不重复触发', () => {
    const onClick = vi.fn();
    render(<IconButton label="导出" icon={TrashIcon} loading onClick={onClick} />);
    const button = screen.getByRole('button', { name: '导出' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('tooltip 可通过键盘聚焦显示', () => {
    render(
      <Tooltip content="恢复最近一次自动保存的网络结构">
        <IconButton label="恢复" icon={TrashIcon} />
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: '恢复' });
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('恢复最近一次自动保存的网络结构');
    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('active 与 tone 语义类名生效', () => {
    render(<IconButton label="置顶" icon={TrashIcon} active tone="danger" />);
    const button = screen.getByRole('button', { name: '置顶' });
    expect(button.className).toContain('nb-icon-button--active');
    expect(button.className).toContain('nb-icon-button--danger');
  });
});
