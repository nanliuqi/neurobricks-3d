import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  calculateRightPanelDragWidth,
  clampResizablePanelWidth,
  useResizablePanel,
} from '@/hooks/useResizablePanel';

/**
 * 拉伸方向核验（模块 02 验收补丁）：
 * 分隔条位于右侧面板左边缘，统一空间语义为
 * - 分隔条向左移动 / ArrowLeft → 面板增宽
 * - 分隔条向右移动 / ArrowRight → 面板变窄
 * 指针与键盘必须符合同一语义；动态最大值参与钳制。
 */

const MIN = 260;
const MAX = 560;

function DirectionHarness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const resize = useResizablePanel({
    containerRef,
    defaultWidth: 280,
    minWidth: MIN,
    maxWidth: MAX,
    reservedWidth: 560,
  });
  return (
    <div ref={containerRef}>
      <div {...resize.separatorProps} data-testid="separator" />
      <output data-testid="width">{resize.width}</output>
    </div>
  );
}

describe('拉伸方向语义', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1200 });
  });

  it('纯函数：指针左移增宽、右移变窄', () => {
    // pointerX 减小（向左拖）→ 宽度增加
    expect(calculateRightPanelDragWidth(280, 900, 850, MIN, MAX)).toBe(330);
    expect(calculateRightPanelDragWidth(280, 900, 700, MIN, MAX)).toBe(480);
    // pointerX 增大（向右拖）→ 宽度减小
    expect(calculateRightPanelDragWidth(280, 900, 920, MIN, MAX)).toBe(260);
    expect(calculateRightPanelDragWidth(320, 900, 910, MIN, MAX)).toBe(310);
  });

  it('纯函数：超出动态边界时钳制而非产生非法宽度', () => {
    expect(calculateRightPanelDragWidth(280, 900, 100, MIN, MAX)).toBe(MAX);
    expect(calculateRightPanelDragWidth(280, 900, 2000, MIN, MAX)).toBe(MIN);
    expect(clampResizablePanelWidth(Number.NaN, MIN, MAX)).toBe(MIN);
    // 非有限输入（含 +Infinity）一律视为非法并安全回退最小值，与既有 NaN 语义一致；
    // 真实调用链的输入（clientX/键盘步进/持久化宽度）均为有限值。
    expect(clampResizablePanelWidth(Number.POSITIVE_INFINITY, MIN, MAX)).toBe(MIN);
  });

  it('键盘：ArrowLeft 增宽、ArrowRight 变窄，方向与指针一致', () => {
    const view = render(<DirectionHarness />);
    const separator = view.getByTestId('separator');
    expect(view.getByTestId('width')).toHaveTextContent('280');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(view.getByTestId('width')).toHaveTextContent('292'); // +12 增宽

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(view.getByTestId('width')).toHaveTextContent('280'); // -12 变窄

    fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true });
    expect(view.getByTestId('width')).toHaveTextContent('260'); // 280 - 48 = 232 → 被最小值 260 钳制
  });

  it('指针拖动全程与键盘方向一致并停在动态边界', () => {
    const view = render(<DirectionHarness />);
    const separator = view.getByTestId('separator');

    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 900 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 800 }); // 左移 → 增宽
    expect(view.getByTestId('width')).toHaveTextContent('380');
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 1000 }); // 右移 → 变窄
    expect(view.getByTestId('width')).toHaveTextContent('260'); // 280 + (900-1000) = 180 → 钳制到 260
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 1000 });
  });
});
