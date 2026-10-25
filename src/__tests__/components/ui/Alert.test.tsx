import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';

describe('Alert（设计系统）', () => {
  it('danger 使用可访问的 alert 角色', () => {
    render(
      <Alert tone="danger" title="审计异常">
        账本哈希链校验失败，禁止继续裁决。
      </Alert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('审计异常');
    expect(alert).toHaveTextContent('账本哈希链校验失败，禁止继续裁决。');
  });

  it('普通 information / success / warning 不滥用 alert 角色', () => {
    for (const tone of ['info', 'success', 'warning'] as const) {
      const { unmount } = render(
        <Alert tone={tone} title={`提示-${tone}`}>
          内容
        </Alert>,
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(`提示-${tone}`);
      unmount();
    }
  });

  it('action 按钮能触发且支持键盘（原生 Button）', () => {
    const onRetry = vi.fn();
    render(
      <Alert
        tone="danger"
        title="训练启动失败"
        action={
          <Button size="small" variant="danger" onClick={onRetry}>
            重试启动
          </Button>
        }
      >
        sidecar 进程未就绪。
      </Alert>,
    );
    const actionButton = screen.getByRole('button', { name: '重试启动' });
    expect(actionButton.tagName).toBe('BUTTON');
    fireEvent.click(actionButton);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('dismissible 提供关闭按钮并回调', () => {
    const onDismiss = vi.fn();
    render(
      <Alert tone="info" dismissible onDismiss={onDismiss}>
        已知悉。
      </Alert>,
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('长错误内容不溢出（容器允许换行，无固定宽度）', () => {
    const longMessage =
      '这是一个非常长的错误说明：解封许可消耗后无法恢复，且本次裁决使用的冻结模型与主张版本不一致，系统已经拒绝写入审计记录，请回到课题页面核对候选身份之后重新发起。';
    render(
      <Alert tone="danger" title="裁决被拒绝">
        {longMessage}
      </Alert>,
    );
    expect(screen.getByText(longMessage)).toBeInTheDocument();
  });
});
