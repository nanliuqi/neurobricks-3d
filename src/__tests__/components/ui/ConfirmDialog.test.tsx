import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders an explicit in-app confirmation and defaults focus to cancel', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="确认冻结？"
        description="冻结后不能原地修改。"
        confirmLabel="确认冻结"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('alertdialog', { name: '确认冻结？' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '确认冻结' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels with Escape but ignores Escape while a protocol action is busy', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        title="确认解封？"
        description="解封会消耗独立验证资格。"
        confirmLabel="确认解封"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(
      <ConfirmDialog
        title="确认解封？"
        description="解封会消耗独立验证资格。"
        confirmLabel="确认解封"
        busy
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
