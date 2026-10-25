import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Tooltip from '@/components/ui/Tooltip';
import Button from '@/components/ui/Button';

describe('Tooltip（设计系统）', () => {
  it('鼠标悬停显示，移开隐藏', () => {
    render(
      <Tooltip content="冻结后指标与阈值都不能再原地修改">
        <Button>冻结</Button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    // React 通过 mouseover/mouseout 委托实现 onMouseEnter/onMouseLeave
    fireEvent.mouseOver(screen.getByRole('button', { name: '冻结' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('冻结后指标与阈值都不能再原地修改');
    fireEvent.mouseOut(screen.getByRole('button', { name: '冻结' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('键盘聚焦显示，Escape 关闭', () => {
    render(
      <Tooltip content="通过键盘也能看到的完整说明">
        <Button>查看</Button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: '查看' });
    fireEvent.focus(button);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('disabled 控件无法聚焦时，仍可通过悬停包裹层看到说明', () => {
    render(
      <Tooltip content="需要先选择数据集才能开始训练">
        <Button disabled>开始训练</Button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: '开始训练' });
    expect(button).toBeDisabled();
    fireEvent.mouseOver(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('需要先选择数据集才能开始训练');
  });

  it('支持长中文说明且 className/style 透传', () => {
    const longContent =
      '候选一旦选定就会写入只追加审计记录，撤回或更换都会消耗审计资格并留下越界留痕，请在确认前仔细核对实验条件。';
    render(
      <Tooltip content={longContent} className="my-tip" style={{ zIndex: 5 }}>
        <Button>选择候选</Button>
      </Tooltip>,
    );
    fireEvent.mouseOver(screen.getByRole('button', { name: '选择候选' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(longContent);
    const wrap = screen.getByRole('button', { name: '选择候选' }).closest('.nb-tooltip-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap!.className).toContain('my-tip');
    expect((wrap as HTMLElement).style.zIndex).toBe('5');
  });
});

describe('Tooltip（placement 扩展，验收补丁）', () => {
  it('默认 placement 保持旧行为：绝对定位气泡，无 fixed/方向类', () => {
    render(
      <Tooltip content="默认顶部提示">
        <Button>默认</Button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: '默认' }));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.className).toContain('nb-tooltip-bubble');
    expect(tooltip.className).not.toContain('nb-tooltip-bubble--fixed');
  });

  it('placement="left" 使用 fixed 侧向气泡', () => {
    render(
      <Tooltip content="左侧提示" placement="left">
        <Button>左侧</Button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: '左侧' }));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('左侧提示');
    expect(tooltip.className).toContain('nb-tooltip-bubble--left');
    expect(tooltip.className).toContain('nb-tooltip-bubble--fixed');
  });

  it('placement="right" 与 "bottom" 方向类正确', () => {
    const first = render(
      <Tooltip content="右侧提示" placement="right">
        <Button>右侧</Button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: '右侧' }));
    expect(screen.getByRole('tooltip').className).toContain('nb-tooltip-bubble--right');
    first.unmount();

    render(
      <Tooltip content="底部提示" placement="bottom">
        <Button>底部</Button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: '底部' }));
    const bottom = screen.getByRole('tooltip');
    expect(bottom.className).toContain('nb-tooltip-bubble--bottom');
    expect(bottom.className).not.toContain('nb-tooltip-bubble--fixed');
  });
});
