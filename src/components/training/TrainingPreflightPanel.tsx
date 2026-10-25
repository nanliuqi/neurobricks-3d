import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import type {
  TrainingPreflightCategory,
  TrainingPreflightIssue,
  TrainingPreflightResult,
  TrainingPreflightTarget,
} from '@/utils/trainingPreflight';

/** 分组显示顺序与中文标签（仅展示用途）。 */
const CATEGORY_ORDER: TrainingPreflightCategory[] = ['data', 'model', 'split', 'parameters', 'runtime', 'study'];
const CATEGORY_LABELS: Record<TrainingPreflightCategory, string> = {
  data: '数据',
  model: '模型',
  split: '切分',
  parameters: '训练参数',
  runtime: '运行环境',
  study: 'Study/启动阶段',
};

const READY_TEXT = '当前可见训练前检查已通过，启动时仍会执行数据契约、Study 和受控管线最终检查。';

export interface TrainingPreflightPanelHandle {
  /** 展开问题列表并把焦点移到首个问题。
   * 已展开时直接重新聚焦（不残留 pending 状态）；
   * 无实时问题但存在权威启动错误时聚焦错误区域，都没有则聚焦摘要。 */
  expandAndFocusFirst: () => void;
}

interface TrainingPreflightPanelProps {
  result: TrainingPreflightResult;
  /** 启动阶段最终检查的真实错误（与训练监控同源）；历史错误不影响实时 canStart。 */
  authoritativeError: { title: string; detail: string } | null;
  onNavigateTarget: (target: TrainingPreflightTarget) => void;
}

function IssueRow({ issue, onNavigateTarget }: {
  issue: TrainingPreflightIssue;
  onNavigateTarget: (target: TrainingPreflightTarget) => void;
}) {
  return (
    <div className="preflight-issue">
      <StatusBadge
        tone={issue.severity === 'blocker' ? 'danger' : 'warning'}
        label={issue.title}
      />
      <div className="preflight-issue__detail">{issue.detail}</div>
      {issue.target.kind !== 'none' && (
        <Button
          size="small"
          variant="ghost"
          className="preflight-issue__action"
          aria-label={`处理：${issue.title}`}
          onClick={() => onNavigateTarget(issue.target)}
        >
          去处理
        </Button>
      )}
    </div>
  );
}

/**
 * 统一训练前检查面板：只读展示 evaluateTrainingPreflight 的结果。
 * - 收起时约一行：状态 + 阻断/警告数量 + 展开按钮；
 * - 展开后按类别分组显示全部问题（不只第一个）；
 * - 启动阶段最终失败（权威检查）用 Alert 展示真实错误并可导航到训练监控；
 * - 状态变化不自动抢焦点；仅在被阻断且用户点击开始时按需移动焦点。
 */
const TrainingPreflightPanel = forwardRef<TrainingPreflightPanelHandle, TrainingPreflightPanelProps>(
  function TrainingPreflightPanel({ result, authoritativeError, onNavigateTarget }, ref) {
    const [expanded, setExpanded] = useState(false);
    const pendingFocusRef = useRef(false);
    const expandedRef = useRef(false);
    const summaryRef = useRef<HTMLDivElement>(null);
    const authoritativeRef = useRef<HTMLDivElement>(null);
    // 问题行 ref 按 issue.id 索引：聚焦时始终使用当下真实的首个问题。
    const issueElementsRef = useRef(new Map<string, HTMLDivElement>());
    const resultRef = useRef(result);
    resultRef.current = result;
    const listId = 'training-preflight-list';

    useEffect(() => {
      expandedRef.current = expanded;
    }, [expanded]);

    // 聚焦优先级：首个问题（blocker 优先）→ 权威错误区域 → 摘要。
    // 只用 ref 定位，不用 setTimeout / querySelector / 中文文案查找。
    const focusFirstIssue = () => {
      const current = resultRef.current;
      const targetId = (current.blockers[0] ?? current.issues[0])?.id;
      const issueElement = targetId ? issueElementsRef.current.get(targetId) : undefined;
      (issueElement ?? authoritativeRef.current ?? summaryRef.current)?.focus();
    };

    useImperativeHandle(ref, () => ({
      expandAndFocusFirst: () => {
        if (expandedRef.current) {
          // 已展开：直接重新聚焦当前首个问题，不留任何 pending 状态。
          focusFirstIssue();
          return;
        }
        pendingFocusRef.current = true;
        setExpanded(true);
      },
    }), []);

    // 展开提交后再聚焦（不用 setTimeout 猜测 DOM 已渲染）；执行后立即清除 pending。
    useEffect(() => {
      if (!expanded || !pendingFocusRef.current) return;
      pendingFocusRef.current = false;
      focusFirstIssue();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expanded]);

    const { status, blockers, warnings } = result;
    const firstBlocker = blockers[0];

    const grouped = CATEGORY_ORDER
      .map(category => ({
        category,
        issues: result.issues.filter(issue => issue.category === category),
      }))
      .filter(group => group.issues.length > 0);

    const statusBadge = status === 'checking'
      ? <StatusBadge tone="info" label="正在检查" />
      : status === 'blocked'
        ? <StatusBadge tone="danger" label={`${blockers.length} 项阻断`} />
        : status === 'warning'
          ? <StatusBadge tone="warning" label={`${warnings.length} 项注意`} />
          : <StatusBadge tone="success" label="检查通过" />;

    return (
      <div className="preflight-panel" data-testid="preflight-panel">
        {/* 摘要行：普通状态更新使用 role=status（polite），不用 alert 制造打断 */}
        <div ref={summaryRef} className="preflight-panel__summary" role="status" data-status={status} tabIndex={-1}>
          {statusBadge}
          <span className="preflight-panel__summary-text" data-testid="preflight-summary-text">
            {status === 'ready' && READY_TEXT}
            {status === 'checking' && '正在检查训练运行环境…'}
            {status === 'blocked' && firstBlocker && !expanded && `首个阻断：${firstBlocker.title}`}
            {status === 'warning' && '可以启动，但存在注意事项'}
          </span>
          {/* 没有实时问题时不渲染无效的展开按钮；权威错误单独展示，不依赖空列表展开 */}
          {result.issues.length > 0 && (
            <button
              type="button"
              className="preflight-panel__toggle"
              aria-expanded={expanded}
              aria-controls={listId}
              data-testid="preflight-toggle"
              onClick={() => setExpanded(value => !value)}
            >
              {expanded ? '收起' : '查看全部'}
            </button>
          )}
        </div>

        {/* 启动阶段最终检查失败：真实错误，与训练监控同源 */}
        {authoritativeError && (
          <div ref={authoritativeRef} tabIndex={-1}>
            <Alert
              tone="danger"
              title={authoritativeError.title}
              action={
                <Button size="small" variant="danger" onClick={() => onNavigateTarget({ kind: 'monitor' })}>
                  前往训练监控
                </Button>
              }
            >
              {authoritativeError.detail}
              {' '}
              修改条件后可重新尝试启动。
            </Alert>
          </div>
        )}

        {expanded && result.issues.length > 0 && (
          <div id={listId} className="preflight-panel__list" data-testid="preflight-list">
            {grouped.map(group => (
              <section key={group.category} className="preflight-panel__group">
                <h4 className="preflight-panel__group-title">{CATEGORY_LABELS[group.category]}</h4>
                {group.issues.map(issue => (
                  <div
                    key={issue.id}
                    ref={element => {
                      if (element) issueElementsRef.current.set(issue.id, element);
                      else issueElementsRef.current.delete(issue.id);
                    }}
                    tabIndex={-1}
                  >
                    <IssueRow issue={issue} onNavigateTarget={onNavigateTarget} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    );
  },
);

export default TrainingPreflightPanel;
