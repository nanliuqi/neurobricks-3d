import Button from '../ui/Button';
import type { WorkflowNextAction } from '@/types/workflow';
import type { RightPanelId } from '@/types/workspace';

interface NextActionGuideProps {
  action: WorkflowNextAction;
  onNavigate: (panel: RightPanelId) => void;
}

/**
 * “建议下一步”引导：展示由纯函数确定的建议（当前事实 + 建议动作 + 将打开的区域）。
 * 按钮只发出导航动作，绝不启动训练、冻结主张、解封或导出。
 */
export default function NextActionGuide({ action, onNavigate }: NextActionGuideProps) {
  return (
    <div className="workflow-guide" data-testid="workflow-next-action">
      <span className="workflow-guide__message">{action.message}</span>
      <Button
        size="small"
        variant="primary"
        data-testid="workflow-next-action-btn"
        onClick={() => onNavigate(action.target)}
      >
        {action.buttonLabel}
      </Button>
    </div>
  );
}
