import type { WorkflowStageProjection } from '@/types/workflow';
import { WORKFLOW_STAGE_ICONS, WORKFLOW_STATUS_ICONS } from './workflowIcons';

interface WorkflowStageItemProps {
  stage: WorkflowStageProjection;
  onNavigate: (stageId: WorkflowStageProjection['id']) => void;
}

/**
 * 单个工作流阶段：只负责呈现名称、状态与图标，并上报导航意图；不含业务判断。
 * 可访问名称 = 阶段名称 + 当前状态；状态同时由文字、线条图标与边框形状表达。
 */
export default function WorkflowStageItem({ stage, onNavigate }: WorkflowStageItemProps) {
  const StageIcon = WORKFLOW_STAGE_ICONS[stage.id];
  const StatusIcon = WORKFLOW_STATUS_ICONS[stage.status];
  return (
    <li className="workflow-stage-item">
      <button
        type="button"
        className={[
          'workflow-stage',
          `workflow-stage--${stage.status}`,
          stage.recommended && 'workflow-stage--recommended',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-current={stage.recommended ? 'step' : undefined}
        aria-label={stage.accessibleName}
        title={stage.note ? `${stage.statusLabel}：${stage.note}` : stage.statusLabel}
        data-testid={`workflow-stage-${stage.id}`}
        onClick={() => onNavigate(stage.id)}
      >
        <StageIcon />
        <span className="workflow-stage__name">{stage.name}</span>
        <StatusIcon />
        <span className="workflow-stage__status">{stage.statusLabel}</span>
      </button>
    </li>
  );
}
