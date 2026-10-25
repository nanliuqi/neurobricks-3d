import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

export type TooltipPlacement = 'top' | 'right' | 'bottom' | 'left';

export interface TooltipProps {
  /** 完整说明文案，支持长中文。 */
  content: ReactNode;
  /** 触发元素；disabled 控件无法聚焦，但包裹层仍可悬停触发。 */
  children: ReactNode;
  /** 气泡方向；默认 'top'，与既有调用方行为完全一致。 */
  placement?: TooltipPlacement;
  className?: string;
  style?: CSSProperties;
}

/**
 * 轻量提示：鼠标悬停与键盘聚焦均可触发，Escape / 失焦 / 移出关闭。
 * - top / bottom：气泡就近绝对定位在包裹层上/下方（旧行为）。
 * - left / right：气泡用 fixed 定位并按触发元素实际坐标摆放。原因：贴窗口边缘的
 *   滚动容器（如 ActivityRail 的 overflow 滚动区）会裁剪绝对定位气泡，
 *   fixed 定位无需 Portal 即可避开裁剪，同时做视口纵向钳制避免越过上下边界。
 */
export default function Tooltip({
  content,
  children,
  placement = 'top',
  className,
  style,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [sidePos, setSidePos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const bubbleId = useId();
  const sideMode = placement === 'left' || placement === 'right';

  // 侧向气泡打开时按触发元素坐标定位，并把纵向中心钳制在视口内（顶部/底部入口不越界）。
  useLayoutEffect(() => {
    if (!open || !sideMode) return;
    const wrap = wrapRef.current;
    if (!wrap || typeof window === 'undefined') return;
    const rect = wrap.getBoundingClientRect();
    const bubbleHeight = bubbleRef.current?.offsetHeight ?? 0;
    const half = bubbleHeight / 2;
    const gap = 6;
    const centerY = rect.top + rect.height / 2;
    const clampedY = window.innerHeight > 0
      ? Math.min(Math.max(centerY, half + 4), window.innerHeight - half - 4)
      : centerY;
    const left = placement === 'left' ? rect.left - gap : rect.right + gap;
    setSidePos({ top: clampedY, left });
  }, [open, sideMode, placement]);

  return (
    <span
      ref={wrapRef}
      className={['nb-tooltip-wrap', className].filter(Boolean).join(' ')}
      style={style}
      aria-describedby={open ? bubbleId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={event => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      {children}
      {open && (sideMode ? (
        <span
          id={bubbleId}
          ref={bubbleRef}
          role="tooltip"
          className={`nb-tooltip-bubble nb-tooltip-bubble--fixed nb-tooltip-bubble--${placement}`}
          style={sidePos
            ? {
                top: sidePos.top,
                left: sidePos.left,
                transform: placement === 'left' ? 'translate(-100%, -50%)' : 'translateY(-50%)',
              }
            // 首帧坐标未算出前先隐藏，避免在错误位置闪现
            : { visibility: 'hidden' }}
        >
          {content}
        </span>
      ) : (
        <span
          id={bubbleId}
          role="tooltip"
          className={`nb-tooltip-bubble nb-tooltip-bubble--${placement}`}
        >
          {content}
        </span>
      ))}
    </span>
  );
}
