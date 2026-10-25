import type { ReactElement } from 'react';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * 内联线条状态图标：供 StatusBadge 与 Alert 共用。
 * 状态语义由文字承载，图标仅作强化，避免只靠颜色区分状态。
 */
export function StatusToneIcon({ tone }: { tone: StatusTone }): ReactElement {
  const inner: Record<StatusTone, ReactElement> = {
    neutral: <path d="M5 8h6" />,
    info: (
      <>
        <path d="M8 7.4v3.2" />
        <path d="M8 5.2v.01" />
      </>
    ),
    success: <path d="m5.3 8.3 1.9 1.9 3.5-4" />,
    warning: (
      <>
        <path d="M8 6v2.6" />
        <path d="M8 10.9v.01" />
      </>
    ),
    danger: (
      <>
        <path d="m5.9 5.9 4.2 4.2" />
        <path d="m10.1 5.9-4.2 4.2" />
      </>
    ),
  };

  return (
    <svg
      className="nb-status-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {tone === 'warning' ? <path d="M8 2.6 14.6 13.8H1.4Z" /> : <circle cx="8" cy="8" r="6.3" />}
      {inner[tone]}
    </svg>
  );
}
