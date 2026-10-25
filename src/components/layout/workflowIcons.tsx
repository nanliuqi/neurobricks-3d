import type { ReactElement } from 'react';
import type { WorkflowStageId, WorkflowStageStatus } from '@/types/workflow';

/**
 * 工作流线性图标集：统一 viewBox(16) / strokeWidth(1.5) / round 端点，
 * 不使用第三方图标库与 emoji。所有图标均为装饰性（aria-hidden），
 * 可访问名称由按钮的 aria-label 提供。
 */
function createWorkflowIcon(content: ReactElement) {
  return function WorkflowIcon(): ReactElement {
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
      >
        {content}
      </svg>
    );
  };
}

/** 六个阶段的语义图标。 */
export const WORKFLOW_STAGE_ICONS: Record<WorkflowStageId, () => ReactElement> = {
  // 数据：圆柱数据库
  data: createWorkflowIcon(
    <>
      <ellipse cx="8" cy="3.8" rx="5" ry="1.8" />
      <path d="M3 3.8v8.4c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V3.8" />
      <path d="M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8" />
    </>,
  ),
  // 模型：积木块
  model: createWorkflowIcon(
    <>
      <path d="M8 2.2 13.8 5 8 7.8 2.2 5Z" />
      <path d="M2.2 5v6L8 13.8l5.8-2.8V5" />
      <path d="M8 7.8v6" />
    </>,
  ),
  // 训练：仪表盘
  train: createWorkflowIcon(
    <>
      <path d="M2.8 11.5a5.6 5.6 0 1 1 10.4 0" />
      <path d="m8 9.8 2.6-3" />
      <path d="M8 9.8v.01" />
    </>,
  ),
  // 对比：并列柱状
  compare: createWorkflowIcon(
    <>
      <path d="M2.5 13.5h11" />
      <path d="M4.5 13.5V7.2h2.4v6.3" />
      <path d="M9.1 13.5V3.8h2.4v9.7" />
    </>,
  ),
  // 主张：盾牌与核对
  claim: createWorkflowIcon(
    <>
      <path d="M8 1.8 13 3.6v4.6c0 3-2.1 5-5 6-2.9-1-5-3-5-6V3.6Z" />
      <path d="m5.8 7.8 1.6 1.6 2.8-3" />
    </>,
  ),
  // 导出：箱出箭头
  export: createWorkflowIcon(
    <>
      <path d="M8 9.8V2.6" />
      <path d="m5.2 5.2 2.8-2.6 2.8 2.6" />
      <path d="M3 9.8v2.7c0 .6.4 1 1 1h8c.6 0 1-.4 1-1V9.8" />
    </>,
  ),
};

/** 五种状态的线条图标：状态不只靠颜色区分。 */
export const WORKFLOW_STATUS_ICONS: Record<WorkflowStageStatus, () => ReactElement> = {
  // 未开始：虚线圆
  not_started: createWorkflowIcon(<circle cx="8" cy="8" r="5.6" strokeDasharray="2.4 2.6" />),
  // 可继续：前进三角
  ready: createWorkflowIcon(<path d="M5.4 3.6v8.8L12.6 8Z" />),
  // 进行中：旋转弧（静态弧线，动画尊重减弱动效偏好故不使用）
  in_progress: createWorkflowIcon(<path d="M13.6 8a5.6 5.6 0 1 1-2.1-4.35" />),
  // 需处理：警告三角
  attention: createWorkflowIcon(
    <>
      <path d="M8 2.4 14.6 13.6H1.4Z" />
      <path d="M8 6.6v3" />
      <path d="M8 11.7v.01" />
    </>,
  ),
  // 已完成：对勾圆
  completed: createWorkflowIcon(
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="m5.4 8.2 1.8 1.8 3.4-3.8" />
    </>,
  ),
};
