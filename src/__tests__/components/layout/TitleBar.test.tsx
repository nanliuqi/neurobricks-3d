import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TitleBar from '@/components/layout/TitleBar';

describe('TitleBar（窗口标题栏）', () => {
  it('窗口控制全部是有可访问名称的原生按钮', () => {
    render(<TitleBar />);
    expect(screen.getByRole('banner', { name: '应用标题栏' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '窗口控制' })).toBeInTheDocument();
    for (const name of ['最小化窗口', '最大化窗口', '关闭窗口']) {
      const button = screen.getByRole('button', { name });
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
    }
  });
});
