import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

export type IconButtonTone = 'default' | 'primary' | 'success' | 'warning' | 'danger';
export type IconButtonSize = 'small' | 'medium' | 'large';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** 可访问名称，必填：图标按钮没有文字，必须显式提供语义描述。 */
  label: string;
  /** 线条 SVG 或任意 ReactNode；不接受 emoji 作为正式图标。 */
  icon: ReactNode;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  active?: boolean;
  loading?: boolean;
  /** 悬停/聚焦提示文案；缺省回退到 label；显式传 null 可禁用原生 title（如已用自定义 Tooltip 包裹时）。 */
  tooltip?: string | null;
}

/**
 * 图标按钮：整个按钮区域响应点击（而非仅 SVG），原生 button 元素保证键盘可达性。
 * aria-label 为必填属性，确保无文字控件仍有可访问名称。
 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    tone = 'default',
    size = 'medium',
    active = false,
    loading = false,
    tooltip,
    disabled,
    type = 'button',
    className,
    onClick,
    ...rest
  },
  ref,
) {
  const isBlocked = disabled || loading;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (isBlocked) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      title={tooltip === null ? undefined : tooltip ?? label}
      aria-busy={loading || undefined}
      data-active={active || undefined}
      disabled={isBlocked}
      className={[
        'nb-icon-button',
        `nb-icon-button--${size}`,
        tone !== 'default' && `nb-icon-button--${tone}`,
        active && 'nb-icon-button--active',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
    >
      {loading ? (
        <span className="nb-button__spinner" aria-hidden="true" />
      ) : (
        <span className="nb-icon-button__icon" aria-hidden="true">{icon}</span>
      )}
    </button>
  );
});

export default IconButton;
