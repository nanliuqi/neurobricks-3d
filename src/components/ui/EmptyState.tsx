import type { CSSProperties, ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** 建议传入 Button/IconButton 节点；组件本身不绑定任何业务行为。 */
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * 空状态占位：不包含面板级固定宽高，由父容器决定占位范围。
 * 业务文案（如“尚无 Experiment”）由调用方传入，本组件不内置。
 */
export default function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
  style,
}: EmptyStateProps) {
  return (
    <div className={['nb-empty-state', className].filter(Boolean).join(' ')} style={style}>
      {icon && (
        <div className="nb-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <strong className="nb-empty-state__title">{title}</strong>
      {description && <div className="nb-empty-state__description">{description}</div>}
      {(primaryAction || secondaryAction) && (
        <div className="nb-empty-state__actions">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
