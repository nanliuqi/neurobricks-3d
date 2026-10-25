import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

afterEach(() => {
  vi.useRealTimers();
});

function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const result = render(
    <ConfirmDialog
      title="确认选择这个候选？"
      description="选择后会写入只追加审计记录。"
      confirmLabel="确认选择"
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onCancel, onConfirm, ...result };
}

describe('ConfirmDialog（设计系统增强）', () => {
  it('保持既有调用接口兼容：弹窗语义、焦点进入弹窗且默认聚焦取消', () => {
    renderDialog({ tone: 'danger' });
    expect(screen.getByRole('alertdialog', { name: '确认选择这个候选？' })).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  });

  it('快速连续确认只执行一次（确认锁存），即使调用方来不及置 busy', () => {
    const { onConfirm } = renderDialog();
    const confirmButton = screen.getByRole('button', { name: '确认选择' });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('事件循环结束后锁存释放：确认失败且未置 busy 时仍可重试', () => {
    vi.useFakeTimers();
    const { onConfirm } = renderDialog();
    const confirmButton = screen.getByRole('button', { name: '确认选择' });
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    vi.runOnlyPendingTimers();
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('busy 回到 false 后（调用方允许重试）可以再次确认', () => {
    vi.useFakeTimers();
    const { onConfirm, rerender } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    vi.runOnlyPendingTimers();

    rerender(
      <ConfirmDialog
        title="确认选择这个候选？"
        description="选择后会写入只追加审计记录。"
        confirmLabel="确认选择"
        busy
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    rerender(
      <ConfirmDialog
        title="确认选择这个候选？"
        description="选择后会写入只追加审计记录。"
        confirmLabel="确认选择"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('busy 时不能通过确认按钮、Escape 或背景点击绕过', () => {
    const { onCancel, onConfirm } = renderDialog({ busy: true });
    // busy 时确认按钮文案切换为“正在处理…”（与既有行为一致），两个按钮均禁用
    expect(screen.getByRole('button', { name: '正在处理…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();

    const backdrop = screen.getByRole('alertdialog').parentElement;
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop!);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Tab / Shift+Tab 焦点在取消与确认之间循环', () => {
    renderDialog();
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '确认选择' });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab' });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it('Escape 触发取消，回调正确', () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('连续打开多个弹窗时，最新弹窗默认聚焦取消、焦点不丢失', () => {
    renderDialog({ title: '第一个弹窗？', confirmLabel: '确认一' });
    renderDialog({ title: '第二个弹窗？', confirmLabel: '确认二' });
    const cancels = screen.getAllByRole('button', { name: '取消' });
    expect(cancels[cancels.length - 1]).toHaveFocus();
    expect(screen.getByRole('alertdialog', { name: '第二个弹窗？' })).toBeInTheDocument();
  });

  it('busy 时确认按钮显示处理中文案，避免状态不确定', () => {
    renderDialog({ busy: true });
    expect(screen.getByRole('button', { name: '正在处理…' })).toBeInTheDocument();
  });
});
