/**
 * 候选操作确认框（模块 06）：保持既有确认语义与文案；
 * 确认后调用既有 runtime（selectStudyCandidate / revokeStudyCandidate），
 * 不直接修改 store 中的 candidateAttemptId。
 */
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { PendingCandidateAction } from './useStudyPanelController';

interface StudyCandidateControlsProps {
  pendingAction: PendingCandidateAction | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function StudyCandidateControls({ pendingAction, onCancel, onConfirm }: StudyCandidateControlsProps) {
  if (!pendingAction) return null;
  return (
    <ConfirmDialog
      title={pendingAction.kind === 'revoke'
        ? '撤回当前候选？'
        : pendingAction.replacing
          ? '更换当前候选？'
          : '确认选择这个候选？'}
      description={pendingAction.kind === 'revoke' ? (
        <>
          <p>将撤回“{pendingAction.label}”的当前候选身份，但不会删除对应的 Experiment、Attempt、权重或指标。</p>
          <p>本次撤回会写入只追加审计记录；之后可以重新选择其他可信 Attempt。</p>
        </>
      ) : (
        <>
          <p>将“{pendingAction.label}”标记为本课题的候选权重，后续评估主张只会绑定这次具体执行。</p>
          <p>{pendingAction.replacing
            ? '原候选不会被删除，本次更换及前后候选身份都会留痕。'
            : '建立任何评估主张前仍可撤回或更换；主张建立后，为防止权重被静默替换，候选将锁定。'}</p>
        </>
      )}
      confirmLabel={pendingAction.kind === 'revoke'
        ? '确认撤回'
        : pendingAction.replacing
          ? '确认更换'
          : '确认选择'}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
