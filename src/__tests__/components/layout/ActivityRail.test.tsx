import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActivityRail from '@/components/layout/ActivityRail';
import { RIGHT_PANELS } from '@/types/workspace';

const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

describe('ActivityRail', () => {
  it('展示全部现有面板入口，每个按钮有可访问名称、无 emoji、无原生 title', () => {
    render(<ActivityRail activePanel="param" collapsed={false} onSelect={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(RIGHT_PANELS.length);
    for (const panel of RIGHT_PANELS) {
      const button = screen.getByRole('button', { name: panel.label });
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('data-testid', `panel-option-${panel.id.toLowerCase()}`);
      // 悬停提示已统一为模块 01 Tooltip：不再保留同用途的原生 title，避免双提示叠加
      expect(button).not.toHaveAttribute('title');
      expect(panel.label).not.toMatch(EMOJI_PATTERN);
    }
    expect(screen.getByTestId('panel-selector')).toHaveAttribute('aria-label', '右侧面板导航');
  });

  it('激活入口具备非颜色线索：aria-current 与 data-active', () => {
    render(<ActivityRail activePanel="dataset" collapsed={false} onSelect={() => {}} />);
    const activeButton = screen.getByRole('button', { name: '数据集' });
    expect(activeButton).toHaveAttribute('aria-current', 'true');
    expect(activeButton).toHaveAttribute('data-active', 'true');
    expect(activeButton.className).toContain('nb-icon-button--active');

    const inactiveButton = screen.getByRole('button', { name: '帮助' });
    expect(inactiveButton).not.toHaveAttribute('aria-current');
    expect(inactiveButton).not.toHaveAttribute('data-active');
  });

  it('点击入口上报对应面板 ID', () => {
    const onSelect = vi.fn();
    render(<ActivityRail activePanel="param" collapsed={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '训练监控' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('trainMonitor');
  });

  it('收起状态下活动栏仍完整存在且入口可用', () => {
    const onSelect = vi.fn();
    render(<ActivityRail activePanel="param" collapsed onSelect={onSelect} />);
    expect(screen.getByTestId('panel-selector')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getAllByRole('button')).toHaveLength(RIGHT_PANELS.length);
    // 激活身份在收起状态下仍被标记
    expect(screen.getByRole('button', { name: '参数' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: '参数' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('param');
  });

  it('图标为装饰性元素（aria-hidden），名称只来自按钮', () => {
    const { container } = render(<ActivityRail activePanel="param" collapsed={false} onSelect={() => {}} />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(RIGHT_PANELS.length);
    for (const svg of svgs) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }
  });

  describe('统一 Tooltip（模块 01，placement=left）', () => {
    it('鼠标悬停显示中文 Tooltip', () => {
      render(<ActivityRail activePanel="param" collapsed={false} onSelect={() => {}} />);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      fireEvent.mouseOver(screen.getByRole('button', { name: '数据集' }));
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toHaveTextContent('数据集：选择内置数据集或导入自定义数据');
      // 左侧定位：fixed 气泡，避免越过窗口右缘或被滚动容器裁剪
      expect(tooltip.className).toContain('nb-tooltip-bubble--left');
      expect(tooltip.className).toContain('nb-tooltip-bubble--fixed');
    });

    it('键盘聚焦显示，失焦关闭', () => {
      render(<ActivityRail activePanel="param" collapsed={false} onSelect={() => {}} />);
      const button = screen.getByRole('button', { name: '推理' });
      fireEvent.focus(button);
      expect(screen.getByRole('tooltip')).toHaveTextContent('推理');
      fireEvent.blur(button);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('Escape 关闭 Tooltip', () => {
      render(<ActivityRail activePanel="param" collapsed={false} onSelect={() => {}} />);
      const button = screen.getByRole('button', { name: '帮助' });
      fireEvent.focus(button);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      fireEvent.keyDown(button, { key: 'Escape' });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('鼠标移出关闭，且 Tooltip 不拦截按钮点击', () => {
      const onSelect = vi.fn();
      render(<ActivityRail activePanel="param" collapsed={false} onSelect={onSelect} />);
      const button = screen.getByRole('button', { name: '导出' });
      fireEvent.mouseOver(button);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      fireEvent.mouseOut(button);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      // 气泡为 pointer-events: none（CSS），包裹层不拦截点击：按钮仍可正常触发
      fireEvent.click(button);
      expect(onSelect).toHaveBeenCalledWith('export');
    });
  });
});
