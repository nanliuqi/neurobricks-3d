import type { CSSProperties, ReactNode } from 'react';
import { StatusToneIcon, type StatusTone } from './statusIcons';

export type { StatusTone };

export interface StatusBadgeProps {
  tone?: StatusTone;
  /** 状态文字，必填：状态含义必须由文字承载，不能只靠颜色。 */
  label: string;
  description?: ReactNode;
  /** 自定义图标；缺省使用与 tone 匹配的内建线条图标。 */
  icon?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * 状态徽章：宽度随内容自适应，支持长中文状态文案。
 * 仅提供通用状态语义；“执行可信”“已冻结”等业务映射由上层模块负责。
 */
export default function StatusBadge({
  tone = 'neutral',
  label,
  description,
  icon,
  className,
  style,
}: StatusBadgeProps) {
  return (
    <span
      className={['nb-badge', `nb-badge--${tone}`, className].filter(Boolean).join(' ')}
      style={style}
    >
      {icon ? (
        <span className="nb-badge__icon" aria-hidden="true">{icon}</span>
      ) : (
        <StatusToneIcon tone={tone} />
      )}
      <span className="nb-badge__body">
        <span className="nb-badge__label">{label}</span>
        {description && <span className="nb-badge__description">{description}</span>}
      </span>
    </span>
  );
}
