import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Button from '@/components/ui/Button';

describe('Button（设计系统）', () => {
  it('正常点击触发一次 onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>开始训练</Button>);
    fireEvent.click(screen.getByRole('button', { name: '开始训练' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disabled 使用原生语义且不触发回调', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        不可用
      </Button>,
    );
    const button = screen.getByRole('button', { name: '不可用' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading 期间快速连点不会重复触发', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        提交
      </Button>,
    );
    const button = screen.getByRole('button', { name: '提交' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('className 与 style 透传到原生按钮', () => {
    render(
      <Button className="my-extra" style={{ marginTop: '7px' }}>
        透传
      </Button>,
    );
    const button = screen.getByRole('button', { name: '透传' });
    expect(button.className).toContain('nb-button');
    expect(button.className).toContain('my-extra');
    expect(button.style.marginTop).toBe('7px');
  });

  it('默认 type 为 button，避免在表单中意外提交', () => {
    render(<Button>普通</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('调用方显式传 type="submit" 时保留原生提交语义', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">保存</Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: '保存' });
    expect(button).toHaveAttribute('type', 'submit');
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('variant 语义类名正确且危险按钮保留文字语义', () => {
    render(
      <Button variant="danger">删除并归档课题</Button>,
    );
    const button = screen.getByRole('button', { name: '删除并归档课题' });
    expect(button.className).toContain('nb-button--danger');
    expect(button).toHaveTextContent('删除并归档课题');
  });
});
