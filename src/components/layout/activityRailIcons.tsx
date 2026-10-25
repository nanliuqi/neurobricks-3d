import type { ReactElement } from 'react';
import type { RightPanelId } from '../../types/workspace';

export interface RailIconProps {
  className?: string;
}

/**
 * 活动栏线性图标集：统一 viewBox(16) / strokeWidth(1.5) / round 端点与拐角，
 * 不使用任何第三方图标库或 emoji。图标均为装饰性元素（aria-hidden），
 * 可访问名称由外层按钮（aria-label）提供。
 */
function createRailIcon(content: ReactElement) {
  return function RailIcon({ className }: RailIconProps): ReactElement {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={className}
      >
        {content}
      </svg>
    );
  };
}

export const RIGHT_PANEL_ICONS: Record<RightPanelId, (props: RailIconProps) => ReactElement> = {
  // 参数：滑块
  param: createRailIcon(
    <>
      <path d="M2.5 5.2h11" />
      <circle cx="6" cy="5.2" r="1.7" />
      <path d="M2.5 10.8h11" />
      <circle cx="10" cy="10.8" r="1.7" />
    </>,
  ),
  // 数据集：圆柱数据库
  dataset: createRailIcon(
    <>
      <ellipse cx="8" cy="3.8" rx="5" ry="1.8" />
      <path d="M3 3.8v8.4c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V3.8" />
      <path d="M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8" />
    </>,
  ),
  // 课题：打开的书
  study: createRailIcon(
    <>
      <path d="M8 3.6C6.6 2.6 4.6 2.4 2.5 2.8v9.5c2.1-.4 4.1-.2 5.5.9 1.4-1.1 3.4-1.3 5.5-.9V2.8c-2.1-.4-4.1-.2-5.5.8Z" />
      <path d="M8 3.6v9.6" />
    </>,
  ),
  // 导出：下箭头入托盘
  export: createRailIcon(
    <>
      <path d="M8 2.5v7" />
      <path d="m5.2 6.9 2.8 2.6 2.8-2.6" />
      <path d="M3 11.2v1.3c0 .6.4 1 1 1h8c.6 0 1-.4 1-1v-1.3" />
    </>,
  ),
  // 设备：芯片
  gpu: createRailIcon(
    <>
      <rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1" />
      <rect x="6.7" y="6.7" width="2.6" height="2.6" />
      <path d="M6.2 2.2v2.4M9.8 2.2v2.4M6.2 11.4v2.4M9.8 11.4v2.4M2.2 6.2h2.4M2.2 9.8h2.4M11.4 6.2h2.4M11.4 9.8h2.4" />
    </>,
  ),
  // 训练监控：折线图
  trainMonitor: createRailIcon(
    <>
      <path d="M2.5 13.5h11" />
      <path d="m3.4 9.6 2.7-3.1 2.4 2 3.7-4.6" />
    </>,
  ),
  // 云端训练：云
  cloud: createRailIcon(
    <path d="M5.2 12.6h6.3a2.9 2.9 0 0 0 .6-5.7 4.1 4.1 0 0 0-8-.5 3.2 3.2 0 0 0 1.1 6.2Z" />,
  ),
  // 推理：放大镜
  predict: createRailIcon(
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="m10.3 10.3 3.2 3.2" />
    </>,
  ),
  // 代码：尖括号
  code: createRailIcon(
    <>
      <path d="m5.6 4.4-3.4 3.6 3.4 3.6" />
      <path d="m10.4 4.4 3.4 3.6-3.4 3.6" />
    </>,
  ),
  // 帮助：问号圆
  help: createRailIcon(
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M6.2 6.3c.2-1 1-1.7 2-1.6.9.1 1.6.8 1.6 1.7 0 1.2-1.8 1.4-1.8 2.6" />
      <path d="M8 11.4v.01" />
    </>,
  ),
};
