/**
 * 严格对比控制层（模块 07）：选择、确认、切换与事件写入。
 * - Study 切换：清除不属于新 Study 的选择、pending 确认与临时 override；
 * - 非严格 override：请求时冻结精确上下文（studyId + 排序 attemptIds + 原因 +
 *   指标语义 + fingerprint），确认时逐项复核，任一变化即取消且不写事件；
 * - 审计持久化非 healthy 时失败关闭，不授予临时 override；
 * - 事件写入后必须 flush 且持久化仍健康才展示非严格曲线；
 * - 同步锁防止同一事件循环双击重复写入；
 * - 不修改候选 Attempt，不把图表选择等同于候选选择。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { flushExperimentLedgerAudit, useExperimentStore } from '@/stores/useExperimentStore';
import type { Attempt, Study } from '@/types/experiment';
import { COMPARISON_WATERMARK, forceComparison, groupStrictComparableAttempts } from '@/utils/comparability';
import { pairedAblationEvidence } from '@/utils/studyProtocol';
import {
  assessSelection,
  canonicalOverrideAttemptIds,
  commonMetricNames,
  comparisonScope,
  defaultSelection,
  findMatchingOverride,
  MAX_COMPARISON_CURVES,
  overrideFingerprint,
  restoreOverrides,
  type MetricViewContext,
  type OverrideContext,
} from '@/utils/comparisonViewModel';
import { extractStrictSeries, type StrictSeriesOk, type StrictSeriesResult } from '@/utils/metricSeries';

/** 请求时冻结的逐 Attempt 事实快照：确认时逐项与最新 ledger 比对。 */
interface AttemptFactSnapshot {
  id: string;
  status: string;
  executionTrust: string;
  datasetContentHash: string | null;
  splitHash: string | null;
  preprocessingHash: string | null;
}

function snapshotAttemptFacts(attempts: readonly Attempt[]): AttemptFactSnapshot[] {
  return attempts.map(attempt => ({
    id: attempt.id,
    status: String(attempt.status),
    executionTrust: String(attempt.provenance.executionTrust),
    datasetContentHash: attempt.provenance.datasetContentHash,
    splitHash: attempt.provenance.splitHash,
    preprocessingHash: attempt.provenance.preprocessingHash,
  }));
}

interface PendingOverride {
  context: OverrideContext;
  fingerprint: string;
  attemptFacts: AttemptFactSnapshot[];
}

export function useComparisonController(study: Study) {
  const ledger = useExperimentStore(state => state.ledger);
  const appendEvent = useExperimentStore(state => state.appendEvent);
  const auditPersistence = useExperimentStore(state => state.auditPersistence);

  const scope = useMemo(() => comparisonScope(ledger, study.id), [ledger, study.id]);
  const groups = useMemo(
    () => groupStrictComparableAttempts(ledger, scope.eligibleAttempts.map(attempt => attempt.id)),
    [ledger, scope.eligibleAttempts],
  );
  const ablationEvidence = useMemo(
    () => (study.kind === 'controlled_ablation' ? pairedAblationEvidence(ledger, study.id) : []),
    [ledger, study.id, study.kind],
  );

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [metricChoice, setMetricChoice] = useState<string | null>(null);
  const [pendingOverride, setPendingOverride] = useState<PendingOverride | null>(null);
  const [grantedFingerprint, setGrantedFingerprint] = useState<string | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [confirmingOverride, setConfirmingOverride] = useState(false);
  const [overflowNotice, setOverflowNotice] = useState<string | null>(null);

  // 同步锁：双击确认只能写入一次事件（不依赖渲染后的 disabled）。
  const overrideLockRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ---------------- Study 切换清理 ---------------- */
  const studyIdRef = useRef(study.id);
  useEffect(() => {
    if (studyIdRef.current !== study.id) {
      studyIdRef.current = study.id;
      // 清除不属于新 Study 的选择、pending 确认与临时 override；默认选择由下方 effect 重建。
      setSelectedIds([]);
      setPendingOverride(null);
      setGrantedFingerprint(null);
      setMetricChoice(null);
      setOverrideError(null);
      setOverflowNotice(null);
    }
  }, [study.id]);

  /* ---------------- 默认选择（确定且可复现） ---------------- */
  const defaults = useMemo(() => defaultSelection(study, scope, ledger), [study, scope, ledger]);
  useEffect(() => {
    setSelectedIds(current => {
      const eligible = new Set(scope.eligibleAttempts.map(attempt => attempt.id));
      const valid = current.filter(id => eligible.has(id));
      if (valid.length === current.length && current.length > 0) return current;
      return defaults.attemptIds;
    });
    if (defaults.overflowCount > 0 && mountedRef.current) {
      setOverflowNotice(`严格可比证据共 ${defaults.attemptIds.length + defaults.overflowCount} 条，超过 ${MAX_COMPARISON_CURVES} 条上限，已按稳定排序显示前 ${MAX_COMPARISON_CURVES} 条`);
    }
  }, [defaults, scope.eligibleAttempts]);

  /* ---------------- 选择与指标 ---------------- */
  const selected = useMemo(
    () => selectedIds
      .map(id => scope.eligibleAttempts.find(attempt => attempt.id === id))
      .filter((attempt): attempt is Attempt => Boolean(attempt)),
    [selectedIds, scope.eligibleAttempts],
  );

  const toggleAttempt = useCallback((attemptId: string) => {
    setOverflowNotice(null);
    setSelectedIds(current => {
      if (current.includes(attemptId)) return current.filter(id => id !== attemptId);
      if (current.length >= MAX_COMPARISON_CURVES) {
        setOverflowNotice(`最多同时对比 ${MAX_COMPARISON_CURVES} 条曲线；请先取消一条再选择`);
        return current;
      }
      return [...current, attemptId];
    });
  }, []);

  const commonMetrics = useMemo(() => commonMetricNames(selected), [selected]);
  const activeMetric = metricChoice !== null && commonMetrics.includes(metricChoice)
    ? metricChoice
    : commonMetrics.length >= 1
      ? commonMetrics[0]
      : null;

  const series: StrictSeriesResult[] = useMemo(
    () => (activeMetric
      ? selected.map(attempt => extractStrictSeries(attempt, activeMetric))
      : selected.map(attempt => extractStrictSeries(attempt))),
    [selected, activeMetric],
  );
  const seriesReady = selected.length >= 2 && activeMetric !== null && series.every(item => item.ok);

  /* ---------------- 可比性与 override ---------------- */
  const assessment = useMemo(() => assessSelection(ledger, selected), [ledger, selected]);

  const restored = useMemo(() => {
    const ids = new Set(scope.studyAttempts.map(attempt => attempt.id));
    return restoreOverrides(ledger.events, study, ids);
  }, [ledger.events, study, scope.studyAttempts]);

  /**
   * 完整指标视图（指纹必须覆盖）：逐 Attempt 实际方向，
   * 非严格对比双方方向不同时不能用第一条代表全部曲线。
   */
  const metricView: MetricViewContext | null = activeMetric && selected.length >= 2 && series.every(item => item.ok)
    ? {
        metricName: activeMetric,
        split: 'validation',
        scope: 'epoch',
        directions: selected
          .map((attempt, index) => {
            const result = series[index];
            return result.ok
              ? { attemptId: attempt.id, optimizationDirection: result.direction }
              : null;
          })
          .filter((item): item is { attemptId: string; optimizationDirection: 'maximize' | 'minimize' } => item !== null),
      }
    : null;

  const currentOverrideContext: OverrideContext | null = selected.length >= 2 && activeMetric && metricView
    ? {
        studyId: study.id,
        attemptIds: canonicalOverrideAttemptIds(selectedIds),
        reasons: assessment.reasons,
        metricSemantics: activeMetric,
        metricView,
      }
    : null;
  const currentFingerprint = currentOverrideContext ? overrideFingerprint(currentOverrideContext) : null;

  // 历史精确匹配恢复 或 本次会话授予（指纹一致才生效；增删 Attempt/换指标自动失效）。
  const historyMatch = currentOverrideContext
    ? findMatchingOverride(restored.valid, currentOverrideContext)
    : null;
  /**
   * 赋权失败关闭（模块 07 验收补丁）：审计持久化必须 healthy。
   * - append 已入内存但 flush 失败/degraded → 历史事件不得激活；
   * - healthy 变 degraded → 已展示的非严格曲线立即隐藏（订阅驱动重算）；
   * - 事件保留在 append-only ledger 中作为事实，不删除。
   */
  const overrideActive = auditPersistence === 'healthy' && Boolean(
    currentFingerprint
    && ((grantedFingerprint !== null && grantedFingerprint === currentFingerprint) || historyMatch),
  );

  /** 非严格入口只在存在可诚实叠加的序列时可操作；否则展示说明而非无反应按钮。 */
  const overrideEntryAvailable = selected.length >= 2 && metricView !== null;

  /** 被排除记录的警告聚合（图表附近 Alert 消费）。 */
  const seriesWarnings = selected
    .map((attempt, index) => ({ attempt, result: series[index] }))
    .filter((item): item is { attempt: Attempt; result: Extract<typeof item.result, { ok: true }> } => (
      item.result.ok === true && (item.result as { ok: true; excludedCount: number }).excludedCount > 0
    ))
    .map(item => ({
      attemptId: item.attempt.id,
      ordinal: item.attempt.ordinal,
      excludedCount: (item.result as { ok: true; excludedCount: number }).excludedCount,
      warnings: (item.result as { ok: true; warnings: string[] }).warnings,
    }));

  const requestOverride = useCallback(() => {
    if (!currentOverrideContext || !currentFingerprint) return;
    // 纵深防御 guard（UI 入口已按审计状态门控，此处保留作为第二道闸门）。
    if (auditPersistence !== 'healthy') {
      setOverrideError('只追加审计链当前不可用或降级；非严格对比必须留痕后才能展示，已失败关闭。请先修复审计状态。');
      return;
    }
    setOverrideError(null);
    // 冻结请求时的逐 Attempt 事实快照，供确认瞬间与最新 ledger 比对。
    setPendingOverride({
      context: currentOverrideContext,
      fingerprint: currentFingerprint,
      attemptFacts: snapshotAttemptFacts(selected),
    });
  }, [auditPersistence, currentFingerprint, currentOverrideContext, selected]);

  const cancelOverride = useCallback(() => {
    setPendingOverride(null);
  }, []);

  const confirmOverride = useCallback(async () => {
    if (overrideLockRef.current) return;
    const pending = pendingOverride;
    if (!pending) return;
    overrideLockRef.current = true;
    if (mountedRef.current) setConfirmingOverride(true);
    try {
      /* 确认瞬间基于最新 store 快照重建全部复核材料（最终证据闭环补丁）：
       * 绝不使用 React 闭包中的旧 selected/currentFingerprint 完成最终授权。 */
      const state = useExperimentStore.getState();
      const cancel = (message: string): void => {
        if (mountedRef.current) {
          setPendingOverride(null);
          setOverrideError(message);
        }
      };

      if (state.activeStudyId !== pending.context.studyId || pending.context.studyId !== study.id) {
        cancel('活动 Study 已变化；本次确认已取消，未写入事件。请重新发起。');
        return;
      }
      const freshScope = comparisonScope(state.ledger, pending.context.studyId);
      const freshSelected: Attempt[] = [];
      for (const id of pending.context.attemptIds) {
        // 归属 + 仍具备严格资格（completed+trusted）：任一丧失即取消。
        const fresh = freshScope.eligibleAttempts.find(attempt => attempt.id === id);
        if (!fresh) {
          cancel('Attempt 归属或完成/可信资格已变化；本次确认已取消，未写入事件。请重新发起。');
          return;
        }
        freshSelected.push(fresh);
      }
      // 逐 Attempt 事实比对：status/executionTrust/数据/切分/预处理哈希任一篡改即取消。
      for (const fact of pending.attemptFacts) {
        const fresh = freshSelected.find(attempt => attempt.id === fact.id);
        if (
          !fresh
          || String(fresh.status) !== fact.status
          || String(fresh.provenance.executionTrust) !== fact.executionTrust
          || fresh.provenance.datasetContentHash !== fact.datasetContentHash
          || fresh.provenance.splitHash !== fact.splitHash
          || fresh.provenance.preprocessingHash !== fact.preprocessingHash
        ) {
          cancel('Attempt 状态、执行信任或数据/切分/预处理哈希在确认前发生变化；本次确认已取消，未写入事件。');
          return;
        }
      }
      // fresh 评估与序列：不可比原因、指标语义/方向/split/scope 全部重建。
      const freshAssessment = assessSelection(state.ledger, freshSelected);
      if ([...freshAssessment.reasons].sort().join('|') !== [...pending.context.reasons].sort().join('|')) {
        cancel('不可比原因已变化；本次确认已取消，未写入事件。请重新发起。');
        return;
      }
      const freshSeries = freshSelected.map(attempt => extractStrictSeries(attempt, pending.context.metricSemantics));
      if (!freshSeries.every(item => item.ok)) {
        cancel('指标序列在确认前不再合法（metricName/方向/数值变化）；本次确认已取消，未写入事件。');
        return;
      }
      const freshView: MetricViewContext = {
        metricName: pending.context.metricSemantics,
        split: 'validation',
        scope: 'epoch',
        directions: freshSelected
          .map((attempt, index) => ({
            attemptId: attempt.id,
            optimizationDirection: (freshSeries[index] as StrictSeriesOk).direction,
          }))
          .sort((left, right) => left.attemptId.localeCompare(right.attemptId)),
      };
      const freshFingerprint = overrideFingerprint({
        studyId: pending.context.studyId,
        attemptIds: pending.context.attemptIds,
        reasons: freshAssessment.reasons,
        metricSemantics: pending.context.metricSemantics,
        metricView: freshView,
      });
      if (freshFingerprint !== pending.fingerprint) {
        cancel('比较指纹与冻结上下文不一致；本次确认已取消，未写入事件。请重新发起。');
        return;
      }
      if (state.auditPersistence !== 'healthy') {
        cancel('审计状态在确认前发生变化；已失败关闭，未写入事件。');
        return;
      }

      const forced = forceComparison({ relation: 'incomparable', reasons: pending.context.reasons, watermark: null });
      appendEvent('study', pending.context.studyId, 'comparison_override', {
        attemptIds: pending.context.attemptIds,
        reasons: forced.reasons,
        watermark: forced.watermark ?? COMPARISON_WATERMARK,
        metricSemantics: pending.context.metricSemantics,
        metricView: pending.context.metricView,
        fingerprint: pending.fingerprint,
      });
      // 只有审计事件成功持久化后才展示非严格对比。
      await flushExperimentLedgerAudit();
      const persisted = useExperimentStore.getState().auditPersistence === 'healthy';
      if (!persisted) {
        cancel('越界事件未能持久化到只追加审计链；不展示非严格对比，也不授予临时豁免。');
        return;
      }
      if (mountedRef.current) {
        setGrantedFingerprint(pending.fingerprint);
        setPendingOverride(null);
      }
      toast.warning('非严格对比已留痕；曲线与导出报告将强制携带“非严格可比”水印');
    } catch (error) {
      if (mountedRef.current) setOverrideError(`越界确认失败：${(error as Error).message}`);
    } finally {
      overrideLockRef.current = false;
      if (mountedRef.current) setConfirmingOverride(false);
    }
  }, [pendingOverride, study.id, appendEvent]);

  return {
    ledger,
    scope,
    groups,
    ablationEvidence,
    auditPersistence,
    selectedIds,
    selected,
    toggleAttempt,
    overflowNotice,
    commonMetrics,
    activeMetric,
    setMetricChoice,
    series,
    seriesReady,
    assessment,
    overrideActive,
    overrideEntryAvailable,
    seriesWarnings,
    historyMatch,
    restored,
    pendingOverride,
    overrideError,
    confirmingOverride,
    requestOverride,
    cancelOverride,
    confirmOverride,
    currentOverrideContext,
  };
}

export type ComparisonController = ReturnType<typeof useComparisonController>;
