/**
 * Study 面板控制层（模块 06）：协调 store 与既有 runtime action。
 * - 创建防重入使用同步锁；React submitting 状态仅用于展示；失败保留草稿并释放锁；
 * - 候选选择/更换/撤回、归档一律经 ConfirmDialog 确认后调用既有 runtime；
 * - runtime 仍是业务合法性的最终裁决者，控制层不复制授权/阻断规则。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import type { StudyKind } from '@/types/experiment';
import {
  archiveStudy,
  createStudyFromCurrentContext,
  revokeStudyCandidate,
  selectStudyCandidate,
} from '@/studyRuntime';
import {
  buildEvidenceSummary,
  projectStudyClaimEvidence,
  resolveActiveStudy,
  scopeStudyEvidence,
  type StudyEvidenceScope,
} from './studyOverviewViewModel';

export type PendingCandidateAction =
  | { kind: 'select'; attemptId: string; label: string; replacing: boolean }
  | { kind: 'revoke'; label: string };

export interface StudyCreateDraft {
  name: string;
  question: string;
  kind: StudyKind;
  selectionRule: string;
  maxExperiments: number;
  maxGpuMinutes: number;
}

export const DEFAULT_CREATE_DRAFT: StudyCreateDraft = {
  name: '',
  question: '',
  kind: 'candidate_selection',
  selectionRule: '手动选择（行为留痕，不声称自动执行排序规则）',
  maxExperiments: 5,
  maxGpuMinutes: 240,
};

export function useStudyPanelController() {
  const ledger = useExperimentStore(state => state.ledger);
  const activeStudyId = useExperimentStore(state => state.activeStudyId);
  const auditPersistence = useExperimentStore(state => state.auditPersistence);
  const auditError = useExperimentStore(state => state.auditError);
  const setActiveStudy = useExperimentStore(state => state.setActiveStudy);
  const datasetInfo = useDatasetStore(state => state.datasetInfo);
  const targetField = useDatasetStore(state => state.targetField);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<StudyCreateDraft>(DEFAULT_CREATE_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState(false);
  const [pendingCandidateAction, setPendingCandidateAction] = useState<PendingCandidateAction | null>(null);

  // 同步重入锁：双击防护不得只依赖下一次渲染后的 submitting 状态。
  const createLockRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ---------------- 活动 Study 与证据作用域（纯派生） ---------------- */

  // activeStudyId 指向不存在或已归档 Study 时安全返回 null；
  // 不在渲染阶段修改 store，也不读取其他 Study 作为替代。
  const activeStudy = useMemo(() => resolveActiveStudy(ledger, activeStudyId), [ledger, activeStudyId]);

  const evidence: StudyEvidenceScope = useMemo(
    () => (activeStudy ? scopeStudyEvidence(ledger, activeStudy.id) : { experiments: [], attempts: [], claims: [] }),
    [ledger, activeStudy],
  );

  const evidenceSummary = useMemo(
    () => buildEvidenceSummary(evidence.experiments, evidence.attempts, evidence.claims),
    [evidence],
  );

  // Claim 证据投影：裁决记录、审计完整性与结论信任分离；
  // attempts 为严格作用域集合，跨 Study 引用自动落入不可采信。
  const claimProjection = useMemo(
    () => (activeStudy
      ? projectStudyClaimEvidence(activeStudy, evidence.attempts, evidence.claims, ledger.events, auditPersistence)
      : null),
    [activeStudy, evidence.attempts, evidence.claims, ledger.events, auditPersistence],
  );

  const visibleStudies = useMemo(() => ledger.studies.filter(study => !study.archivedAt), [ledger.studies]);
  const archivedStudyCount = ledger.studies.length - visibleStudies.length;
  const candidateLockedByClaim = evidence.claims.length > 0;

  /* ---------------- Study 切换 ---------------- */

  const handleSwitchStudy = useCallback((studyId: string | null) => {
    try {
      setActiveStudy(studyId);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }, [setActiveStudy]);

  /* ---------------- Study 创建（防重入 + 草稿保留） ---------------- */

  const toggleForm = useCallback(() => {
    setFormOpen(value => !value);
    setCreateError(null);
  }, []);

  const updateDraft = useCallback((patch: Partial<StudyCreateDraft>) => {
    setDraft(current => ({ ...current, ...patch }));
    setCreateError(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (createLockRef.current || submitting) return;
    createLockRef.current = true;
    if (mountedRef.current) {
      setSubmitting(true);
      setCreateError(null);
    }
    try {
      await createStudyFromCurrentContext({
        name: draft.name,
        question: draft.question,
        kind: draft.kind,
        selectionRule: draft.selectionRule,
        maxExperiments: draft.maxExperiments,
        maxGpuMinutes: draft.maxGpuMinutes,
      });
      // 创建成功后才清空草稿。
      if (mountedRef.current) {
        setDraft(DEFAULT_CREATE_DRAFT);
        setFormOpen(false);
      }
      toast.success('Study 已创建并设为活动课题');
    } catch (error) {
      // 失败保留草稿、显示真实错误、允许重试。
      if (mountedRef.current) setCreateError((error as Error).message);
      toast.error((error as Error).message);
    } finally {
      createLockRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }, [draft, submitting]);

  /* ---------------- 候选操作（确认后才调用 runtime） ---------------- */

  const requestCandidateAction = useCallback((action: PendingCandidateAction) => {
    setPendingCandidateAction(action);
  }, []);

  const cancelCandidateAction = useCallback(() => {
    setPendingCandidateAction(null);
  }, []);

  const confirmCandidateAction = useCallback(() => {
    if (!activeStudy) return;
    try {
      if (pendingCandidateAction?.kind === 'select') {
        selectStudyCandidate(activeStudy.id, pendingCandidateAction.attemptId);
        toast.success(pendingCandidateAction.replacing
          ? '候选已更换；新旧选择均已留痕'
          : '候选方案与具体权重已标记，选择行为已留痕');
      } else if (pendingCandidateAction?.kind === 'revoke') {
        revokeStudyCandidate(activeStudy.id);
        toast.success('候选已撤回；实验结果和历史选择记录仍完整保留');
      }
      setPendingCandidateAction(null);
    } catch (error) {
      // runtime 拒绝时保留界面状态并显示真实原因，允许重试。
      toast.error((error as Error).message);
    }
  }, [activeStudy, pendingCandidateAction]);

  /* ---------------- 归档（语义为归档，不是物理删除） ---------------- */

  const requestArchive = useCallback(() => {
    if (!activeStudy) return;
    setPendingArchive(true);
  }, [activeStudy]);

  const cancelArchive = useCallback(() => {
    setPendingArchive(false);
  }, []);

  const confirmArchive = useCallback(() => {
    if (!activeStudy) return;
    try {
      archiveStudy(activeStudy.id);
      setPendingArchive(false);
      toast.success('课题已归档；Study、Experiment、Attempt、Claim 与审计记录均保留');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }, [activeStudy]);

  return {
    // store 镜像
    ledger,
    activeStudyId,
    auditPersistence,
    auditError,
    datasetInfo,
    targetField,
    // 派生
    activeStudy,
    evidence,
    evidenceSummary,
    claimProjection,
    visibleStudies,
    archivedStudyCount,
    candidateLockedByClaim,
    // 创建
    formOpen,
    draft,
    submitting,
    createError,
    toggleForm,
    updateDraft,
    handleCreate,
    // 切换
    handleSwitchStudy,
    // 候选
    pendingCandidateAction,
    requestCandidateAction,
    cancelCandidateAction,
    confirmCandidateAction,
    // 归档
    pendingArchive,
    requestArchive,
    cancelArchive,
    confirmArchive,
  };
}

export type StudyPanelController = ReturnType<typeof useStudyPanelController>;
