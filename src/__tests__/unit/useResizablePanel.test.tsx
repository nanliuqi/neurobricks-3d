import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  calculateRightPanelDragWidth,
  clampResizablePanelWidth,
  useResizablePanel,
} from '@/hooks/useResizablePanel';

function ResizeHarness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const resize = useResizablePanel({
    containerRef,
    defaultWidth: 280,
    minWidth: 260,
    maxWidth: 560,
    reservedWidth: 560,
    storageKey: 'test:right-panel-width',
  });

  return (
    <div ref={containerRef}>
      <div {...resize.separatorProps} data-testid="separator" />
      <output data-testid="width">{resize.width}</output>
      <output data-testid="max-width">{resize.maxWidth}</output>
    </div>
  );
}

describe('useResizablePanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1200,
    });
  });

  it('clamps invalid and out-of-range widths', () => {
    expect(clampResizablePanelWidth(Number.NaN, 260, 560)).toBe(260);
    expect(clampResizablePanelWidth(200, 260, 560)).toBe(260);
    expect(clampResizablePanelWidth(700, 260, 560)).toBe(560);
    expect(clampResizablePanelWidth(340, 260, 560)).toBe(340);
  });

  it('grows the right panel when its left edge moves left', () => {
    expect(calculateRightPanelDragWidth(280, 900, 850, 260, 560)).toBe(330);
    expect(calculateRightPanelDragWidth(280, 900, 980, 260, 560)).toBe(260);
  });

  it('supports keyboard resizing, bounds and default-width reset', () => {
    const view = render(<ResizeHarness />);
    const separator = view.getByTestId('separator');
    const width = view.getByTestId('width');

    expect(separator).toHaveAttribute('role', 'separator');
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(width).toHaveTextContent('280');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(width).toHaveTextContent('292');

    fireEvent.keyDown(separator, { key: 'End' });
    expect(width).toHaveTextContent('560');

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(width).toHaveTextContent('260');

    fireEvent.doubleClick(separator);
    expect(width).toHaveTextContent('280');
    expect(window.localStorage.getItem('test:right-panel-width')).toBe('280');
  });

  it('limits the panel so the fixed left side and minimum scene remain visible', () => {
    Object.defineProperty(window, 'innerWidth', { value: 960 });
    window.localStorage.setItem('test:right-panel-width', '999');

    const view = render(<ResizeHarness />);

    expect(view.getByTestId('max-width')).toHaveTextContent('400');
    expect(view.getByTestId('width')).toHaveTextContent('400');
  });

  it('tracks pointer movement and restores global interaction styles on release', () => {
    const view = render(<ResizeHarness />);
    const separator = view.getByTestId('separator');
    const width = view.getByTestId('width');

    fireEvent.pointerDown(separator, { button: 0, pointerId: 7, clientX: 900 });
    expect(document.body.style.cursor).toBe('col-resize');

    fireEvent.pointerMove(window, { pointerId: 7, clientX: 840 });
    expect(width).toHaveTextContent('340');

    fireEvent.pointerUp(window, { pointerId: 7, clientX: 840 });
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });
});
