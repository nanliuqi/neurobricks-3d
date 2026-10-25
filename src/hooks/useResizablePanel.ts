import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type RefObject,
} from 'react';

interface UseResizablePanelOptions {
  containerRef: RefObject<HTMLElement>;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  reservedWidth: number;
  storageKey?: string;
  keyboardStep?: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startWidth: number;
}

export function clampResizablePanelWidth(width: number, minWidth: number, maxWidth: number): number {
  const safeMaxWidth = Math.max(minWidth, maxWidth);
  if (!Number.isFinite(width)) return minWidth;
  return Math.min(safeMaxWidth, Math.max(minWidth, width));
}

export function calculateRightPanelDragWidth(
  startWidth: number,
  startX: number,
  currentX: number,
  minWidth: number,
  maxWidth: number,
): number {
  // 右栏的拖拽线在左边缘：向左拖动应增大面板，向右拖动应减小面板。
  return clampResizablePanelWidth(startWidth + startX - currentX, minWidth, maxWidth);
}

function loadStoredWidth(storageKey: string | undefined, fallback: number): number {
  if (!storageKey || typeof window === 'undefined') return fallback;
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function useResizablePanel({
  containerRef,
  defaultWidth,
  minWidth,
  maxWidth,
  reservedWidth,
  storageKey,
  keyboardStep = 12,
}: UseResizablePanelOptions) {
  const initialContainerWidth = typeof window === 'undefined' ? reservedWidth + maxWidth : window.innerWidth;
  const [containerWidth, setContainerWidth] = useState(initialContainerWidth);
  const effectiveMaxWidth = useMemo(
    () => Math.max(minWidth, Math.min(maxWidth, containerWidth - reservedWidth)),
    [containerWidth, maxWidth, minWidth, reservedWidth],
  );
  const [width, setWidth] = useState(() => clampResizablePanelWidth(
    loadStoredWidth(storageKey, defaultWidth),
    minWidth,
    Math.max(minWidth, Math.min(maxWidth, initialContainerWidth - reservedWidth)),
  ));
  const [isResizing, setIsResizing] = useState(false);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    const measure = () => {
      const measuredWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
      setContainerWidth(measuredWidth > 0 ? measuredWidth : window.innerWidth);
    };

    measure();
    window.addEventListener('resize', measure);

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure);
    if (containerRef.current) resizeObserver?.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', measure);
      resizeObserver?.disconnect();
    };
  }, [containerRef]);

  useEffect(() => {
    setWidth(current => clampResizablePanelWidth(current, minWidth, effectiveMaxWidth));
  }, [effectiveMaxWidth, minWidth]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, String(Math.round(width)));
    } catch {
      // 隐私模式或受限 WebView 中 localStorage 可能不可写，不影响本次缩放。
    }
  }, [storageKey, width]);

  const stopResizing = useCallback(() => {
    dragStateRef.current = null;
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      setWidth(calculateRightPanelDragWidth(
        dragState.startWidth,
        dragState.startX,
        event.clientX,
        minWidth,
        effectiveMaxWidth,
      ));
    };
    const handlePointerEnd = (event: PointerEvent) => {
      if (dragStateRef.current?.pointerId === event.pointerId) stopResizing();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stopResizing();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('blur', stopResizing);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('blur', stopResizing);
    };
  }, [effectiveMaxWidth, isResizing, minWidth, stopResizing]);

  const handlePointerDown: PointerEventHandler<HTMLDivElement> = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 极旧 WebView 不支持 Pointer Capture；window 级监听仍可完成拖拽。
    }
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
    setIsResizing(true);
  }, [width]);

  const handleLostPointerCapture: PointerEventHandler<HTMLDivElement> = useCallback(() => {
    if (dragStateRef.current) stopResizing();
  }, [stopResizing]);

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = useCallback((event) => {
    const step = event.shiftKey ? keyboardStep * 4 : keyboardStep;
    let nextWidth: number | null = null;

    if (event.key === 'ArrowLeft') nextWidth = width + step;
    if (event.key === 'ArrowRight') nextWidth = width - step;
    if (event.key === 'Home') nextWidth = minWidth;
    if (event.key === 'End') nextWidth = effectiveMaxWidth;
    if (nextWidth === null) return;

    event.preventDefault();
    setWidth(clampResizablePanelWidth(nextWidth, minWidth, effectiveMaxWidth));
  }, [effectiveMaxWidth, keyboardStep, minWidth, width]);

  const handleDoubleClick = useCallback(() => {
    setWidth(clampResizablePanelWidth(defaultWidth, minWidth, effectiveMaxWidth));
  }, [defaultWidth, effectiveMaxWidth, minWidth]);

  return {
    width,
    isResizing,
    minWidth,
    maxWidth: effectiveMaxWidth,
    // 未与 minWidth 调和的原始可用宽度（容器宽 - 预留宽），
    // 供上层判断窗口是否窄到需要确定性降级（如自动收起面板）。
    availableWidth: containerWidth - reservedWidth,
    separatorProps: {
      role: 'separator' as const,
      tabIndex: 0,
      'aria-label': '调整右侧面板宽度',
      'aria-orientation': 'vertical' as const,
      'aria-valuemin': Math.round(minWidth),
      'aria-valuemax': Math.round(effectiveMaxWidth),
      'aria-valuenow': Math.round(width),
      'aria-valuetext': `${Math.round(width)} 像素`,
      onPointerDown: handlePointerDown,
      onLostPointerCapture: handleLostPointerCapture,
      onKeyDown: handleKeyDown,
      onDoubleClick: handleDoubleClick,
    },
  };
}
