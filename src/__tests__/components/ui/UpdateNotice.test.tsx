import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UpdateNotice from '@/components/ui/UpdateNotice';

describe('UpdateNotice（应用更新提示）', () => {
  it('版本缺失时不显示 undefined，且提供有名称的更新操作', () => {
    render(<UpdateNotice onInstall={vi.fn()} />);
    expect(screen.getByRole('complementary', { name: '应用更新通知' })).toHaveTextContent('有新版本可用');
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即更新' })).toBeInTheDocument();
  });

  it('同一安装请求只触发一次，并在进行中锁定按钮', () => {
    const onInstall = vi.fn(() => new Promise<void>(() => undefined));
    render(<UpdateNotice version="v0.2.0" onInstall={onInstall} />);
    const button = screen.getByRole('button', { name: '立即更新' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onInstall).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '正在更新' })).toBeDisabled();
    expect(screen.getByText('版本 v0.2.0 已可用。')).toBeInTheDocument();
  });

  it('安装失败转为可读错误并允许显式重试', async () => {
    const onInstall = vi.fn().mockRejectedValueOnce(new Error('offline'));
    render(<UpdateNotice version="0.2.0" onInstall={onInstall} />);
    fireEvent.click(screen.getByRole('button', { name: '立即更新' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('自动更新失败'));
    expect(screen.getByRole('button', { name: '重试更新' })).toBeEnabled();
    expect(screen.getByRole('alert')).not.toHaveTextContent('offline');
  });
});
