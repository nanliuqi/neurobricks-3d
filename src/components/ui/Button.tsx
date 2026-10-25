import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'warning' | 'danger' | 'ghost';
export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/**
 * 设计系统基础按钮。
 * 默认 type 为 'button'：若沿用浏览器默认的 submit，放在表单里会意外触发表单提交；
 * 需要提交表单的调用方必须显式传入 type="submit"。
 * 组件不写死外层宽度与 margin，布局由父容器控制。
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'medium',
    loading = false,
    leftIcon,
    rightIcon,
    disabled,
    type = 'button',
    className,
    children,
    onClick,
    ...rest
  },
  ref,
) {
  const isBlocked = disabled || loading;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // 原生 disabled 已阻断点击，这里再兜底，防止 loading 期间被程序化触发重复提交
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
      disabled={isBlocked}
      aria-busy={loading || undefined}
      className={['nb-button', `nb-button--${variant}`, `nb-button--${size}`, className]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
    >
      {loading ? (
        <span className="nb-button__spinner" aria-hidden="true" />
      ) : (
        leftIcon && <span className="nb-button__icon" aria-hidden="true">{leftIcon}</span>
      )}
      {children !== undefined && children !== null && (
        <span className="nb-button__label">{children}</span>
      )}
      {!loading && rightIcon && (
        <span className="nb-button__icon" aria-hidden="true">{rightIcon}</span>
      )}
    </button>
  );
});

export default Button;
