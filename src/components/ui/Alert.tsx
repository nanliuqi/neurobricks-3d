import type { CSSProperties, ReactNode } from 'react';
import { StatusToneIcon, type StatusTone } from './statusIcons';

export type AlertTone = Exclude<StatusTone, 'neutral'>;

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  /** 正文说明，支持长中文内容自动换行。 */
  children?: ReactNode;
  /** 操作区：放置按钮等交互，需自行保证键盘可达（建议用 Button/IconButton）。 */
  action?: ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * 行内提示条。
 * role 语义：只有 danger（需要即时打断用户注意力的错误）使用 role="alert"；
 * 其余语气使用 role="status"（polite 播报），避免 alert 滥用稀释真正错误的注意力。
 */
export default function Alert({
  tone = 'info',
  title,
  children,
  action,
  dismissible = false,
  onDismiss,
  className,
  style,
}: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={['nb-alert', `nb-alert--${tone}`, className].filter(Boolean).join(' ')}
      style={style}
    >
      <StatusToneIcon tone={tone} />
      <div className="nb-alert__body">
        {title && <strong className="nb-alert__title">{title}</strong>}
        {children && <div className="nb-alert__description">{children}</div>}
      </div>
      {(action || dismissible) && (
        <div className="nb-alert__actions">
          {action}
          {dismissible && (
            <button
              type="button"
              className="nb-alert__dismiss"
              aria-label="关闭"
              onClick={onDismiss}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
