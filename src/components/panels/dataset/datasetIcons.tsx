/**
 * 数据集工作台线性图标：统一风格、随 currentColor 着色、全部 aria-hidden。
 * 替代 emoji 图标；状态语义由文字与 StatusBadge 承担，图标不单独承载状态。
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function baseProps({ size = 14, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false',
    ...rest,
  };
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

export function TableIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10M15 10v10" />
    </svg>
  );
}

export function SheetIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M15 2v5h5M9 12h6M9 16h6" />
    </svg>
  );
}

export function DatabaseIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M4 7h16M10 4h4M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M7 12h10" />
    </svg>
  );
}
