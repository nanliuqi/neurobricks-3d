import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StatusBadge from '@/components/ui/StatusBadge';

describe('StatusBadge（设计系统）', () => {
  it('渲染正确的状态文字与描述', () => {
    render(<StatusBadge tone="success" label="执行可信" description="通过独立验证" />);
    expect(screen.getByText('执行可信')).toBeInTheDocument();
    expect(screen.getByText('通过独立验证')).toBeInTheDocument();
  });

  it('状态不只依赖颜色：每种语气都带非颜色线索（线条图标）', () => {
    const tones = ['neutral', 'info', 'success', 'warning', 'danger'] as const;
    for (const tone of tones) {
      const { container, unmount } = render(<StatusBadge tone={tone} label={`状态-${tone}`} />);
      expect(container.querySelector('svg.nb-status-icon')).toBeTruthy();
      unmount();
    }
  });

  it('长中文状态正常渲染，不强制窄宽度', () => {
    const longLabel = '该主张的统计预演出现了边界告警，需要在冻结之前人工复核全部阈值设置';
    render(<StatusBadge tone="warning" label={longLabel} />);
    const label = screen.getByText(longLabel);
    expect(label).toBeInTheDocument();
    // 组件自身不设固定宽度，宽度由父容器和内容决定
    expect(label.style.width).toBe('');
  });

  it('支持自定义图标与 className/style 透传', () => {
    render(
      <StatusBadge
        tone="info"
        label="已冻结"
        icon={<svg data-testid="custom-icon" />}
        className="extra-badge"
        style={{ alignSelf: 'start' }}
      />,
    );
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    const badge = screen.getByText('已冻结').closest('.nb-badge');
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain('extra-badge');
    expect((badge as HTMLElement).style.alignSelf).toBe('start');
  });
});
