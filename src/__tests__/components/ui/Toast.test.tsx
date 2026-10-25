import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContainer, useToastStore } from '@/components/ui/Toast';

describe('Toast（全局通知）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    act(() => useToastStore.setState({ toasts: [] }));
  });

  afterEach(() => {
    act(() => useToastStore.setState({ toasts: [] }));
    vi.useRealTimers();
  });

  it('错误使用 alert，其余通知使用 polite status，并以文字和图标共同表达', () => {
    act(() => {
      useToastStore.getState().addToast('error', '账本写入失败', 1000);
      useToastStore.getState().addToast('info', '训练配置已保存', 1000);
    });
    render(<ToastContainer />);

    expect(screen.getByRole('region', { name: '应用通知' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('账本写入失败');
    expect(screen.getByRole('status')).toHaveTextContent('训练配置已保存');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getAllByRole('button', { name: /^关闭通知：/ })).toHaveLength(2);
  });

  it('关闭由真实按钮完成，不把整张通知伪装成鼠标专用按钮', () => {
    act(() => {
      useToastStore.getState().addToast('warning', '验证集切分不同', 1000);
    });
    render(<ToastContainer />);
    const message = screen.getByText('验证集切分不同');
    expect(message.closest('.nb-toast')).not.toHaveAttribute('tabindex');

    fireEvent.click(screen.getByRole('button', { name: '关闭通知：验证集切分不同' }));
    expect(screen.queryByText('验证集切分不同')).not.toBeInTheDocument();
  });

  it('到期自动移除，突发通知最多展示最近五条', () => {
    act(() => {
      for (let index = 1; index <= 6; index += 1) {
        useToastStore.getState().addToast('success', `通知 ${index}`, 1000);
      }
    });
    expect(useToastStore.getState().toasts.map(item => item.message)).toEqual([
      '通知 2', '通知 3', '通知 4', '通知 5', '通知 6',
    ]);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
