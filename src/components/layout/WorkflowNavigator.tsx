import type { WorkflowProjectionResult } from '@/types/workflow';
import { WORKFLOW_STAGE_TARGETS } from '@/types/workflow';
import type { RightPanelId } from '@/types/workspace';
import WorkflowStageItem from './WorkflowStageItem';
import NextActionGuide from './NextActionGuide';

interface WorkflowNavigatorProps {
  /** 只读投影结果（由 useWorkflowProjection 提供）。 */
  projection: WorkflowProjectionResult;
  /** 导航回调：由工作区外壳提供（复用既有面板导航状态，不新建第二套）。 */
  onNavigate: (panel: RightPanelId) => void;
}

/**
 * 可信实验工作流导航：数据 → 模型 → 训练 → 对比 → 主张 → 导出。
 * 只呈现六个阶段并发出导航意图；不直接读取业务 store、不执行业务动作。
 * 连接线为 CSS 伪元素，不进入可访问树；横向滚动时键盘仍可逐项访问。
 */
export default function WorkflowNavigator({ projection, onNavigate }: WorkflowNavigatorProps) {
  return (
    <div className="workflow-bar" data-testid="workflow-bar">
      <nav aria-label="可信实验工作流" className="workflow-bar__nav">
        <ol className="workflow-bar__steps">
          {projection.stages.map(stage => (
            <WorkflowStageItem
              key={stage.id}
              stage={stage}
              onNavigate={stageId => onNavigate(WORKFLOW_STAGE_TARGETS[stageId])}
            />
          ))}
        </ol>
      </nav>
      <NextActionGuide action={projection.nextAction} onNavigate={onNavigate} />
    </div>
  );
}
