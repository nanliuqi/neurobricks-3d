import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppErrorBoundary from '@/components/errors/AppErrorBoundary';

function BrokenView(): never {
  throw new TypeError('sensitive local detail must not be rendered');
}

describe('AppErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders children during the normal path', () => {
    render(<AppErrorBoundary><p>正常界面</p></AppErrorBoundary>);
    expect(screen.getByText('正常界面')).toBeInTheDocument();
  });

  it('turns an uncaught renderer exception into a recoverable, non-destructive screen', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<AppErrorBoundary><BrokenView /></AppErrorBoundary>);

    expect(screen.getByRole('alert')).toHaveTextContent('项目数据未被清除');
    expect(screen.getByRole('button', { name: '重新加载应用' })).toBeInTheDocument();
    expect(screen.getByText('错误类型：TypeError')).toBeInTheDocument();
    expect(screen.queryByText(/sensitive local detail/)).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });
});
