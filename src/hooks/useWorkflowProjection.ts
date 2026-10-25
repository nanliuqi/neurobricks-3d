import { useMemo } from 'react';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { projectWorkflow } from '@/utils/workflowProjection';
import type { WorkflowFacts, WorkflowProjectionResult } from '@/types/workflow';
import type { LedgerEvent } from '@/types/experiment';

/** 导出完成事件类型；归属判定另需实体作用域匹配，不得仅按类型采信。 */
const EXPORT_COMPLETED_EVENT_TYPES = new Set([
  'experiment_package_export_completed',
  'study_report_export_completed',
]);

/** Attempt 是否被受控管线采信完成（只读复用既有判定字段，不重新实现 executionTrust 规则）。 */
function isTrustedCompleted(status: string, executionTrust: string): boolean {
  return status === 'completed' && executionTrust === 'trusted';
}

/**
 * 导出完成事件是否归属当前活动 Study（集中 selector，不散落组件）：
 * - 课题报告：entityType='study' 且 entityId === 活动 Study id；
 * - 实验包：entityType='attempt' 且 entityId 属于当前 Study 下的 Attempt；
 * - legacy-export 等无法关联的实体一律不得证明当前 Study 已导出。
 */
function exportEventBelongsToCurrentStudy(
  event: LedgerEvent,
  activeStudyId: string | null,
  currentStudyAttemptIds: ReadonlySet<string>,
): boolean {
  if (activeStudyId === null) return false;
  if (event.eventType === 'study_report_export_completed') {
    return event.entityType === 'study' && event.entityId === activeStudyId;
  }
  if (event.eventType === 'experiment_package_export_completed') {
    return event.entityType === 'attempt' && currentStudyAttemptIds.has(event.entityId);
  }
  return false;
}

/**
 * 只读投影钩子：用细粒度 selector 读取现有状态、组装纯事实对象，再调用纯投影函数。
 * - 不订阅完整 store（只取判断所需的摘要字段，且均为引用/原始值）；
 * - 不写 localStorage、不修改任何业务状态；
 * - 结果仅在输入引用变化时重算。
 */
export function useWorkflowProjection(): WorkflowProjectionResult {
  const datasetInfo = useDatasetStore(state => state.datasetInfo);
  const targetField = useDatasetStore(state => state.targetField);
  const layerCount = useLayerStore(state => state.layers.length);
  const structureValid = useLayerStore(state => state.validationResult.isValid);
  const trainStatus = useTrainingStore(state => state.status);
  const ledger = useExperimentStore(state => state.ledger);
  const activeStudyId = useExperimentStore(state => state.activeStudyId);
  const auditPersistence = useExperimentStore(state => state.auditPersistence);

  return useMemo<WorkflowProjectionResult>(() => {
    const activeStudy = ledger.studies.find(study => study.id === activeStudyId) ?? null;

    let studyFacts: WorkflowFacts['activeStudy'] = null;
    // 当前活动 Study 下的 Attempt 集合（作用域口径与 StudyPanel 一致）。
    let currentStudyAttemptIds: ReadonlySet<string> = new Set();
    if (activeStudy) {
      // 关联口径与 StudyPanel 一致：Experiment 按 studyId，Attempt 按 experimentId。
      const experimentIds = new Set(
        ledger.experiments.filter(item => item.studyId === activeStudy.id).map(item => item.id),
      );
      const attempts = ledger.attempts.filter(item => experimentIds.has(item.experimentId));
      currentStudyAttemptIds = new Set(attempts.map(item => item.id));
      const trustedAttemptCount = attempts.filter(
        item => isTrustedCompleted(item.status, item.provenance.executionTrust),
      ).length;
      studyFacts = {
        kind: activeStudy.kind,
        candidateSelected: Boolean(activeStudy.selectedAttemptId),
        attemptCount: attempts.length,
        trustedAttemptCount,
      };
    }

    // 历史存在：不属于当前活动 Study 的可信完成 Attempt（无活动 Study 时为账本内任意此类记录）。
    const hasHistoricalTrustedAttempt = ledger.attempts.some(
      item => isTrustedCompleted(item.status, item.provenance.executionTrust)
        && !currentStudyAttemptIds.has(item.id),
    );

    // 导出记录：必须实体归属匹配才算当前证据；其余仅作为历史存在提示。
    const currentStudyExportRecorded = ledger.events.some(event =>
      exportEventBelongsToCurrentStudy(event, activeStudy?.id ?? null, currentStudyAttemptIds));
    const hasHistoricalExportRecord = !currentStudyExportRecorded
      && ledger.events.some(event => EXPORT_COMPLETED_EVENT_TYPES.has(event.eventType));

    const studyClaims = activeStudy
      ? ledger.claims.filter(claim => claim.studyId === activeStudy.id)
      : [];
    const latestClaim = studyClaims.length > 0
      ? [...studyClaims].sort((left, right) => right.updatedAt - left.updatedAt)[0]
      : null;

    const facts: WorkflowFacts = {
      hasDataset: datasetInfo !== null,
      // Excel 可导入预览但当前训练后端不支持；CSV 回归目标未确认同样不可直接训练。
      datasetAttention: datasetInfo !== null
        && (datasetInfo.type === 'excel' || (datasetInfo.type === 'csv' && targetField === null)),
      hasLayers: layerCount > 0,
      structureValid,
      trainStatus,
      activeStudy: studyFacts,
      latestClaim: latestClaim ? { status: latestClaim.status, verdict: latestClaim.verdict } : null,
      auditDegraded: auditPersistence === 'degraded',
      hasHistoricalTrustedAttempt,
      currentStudyExportRecorded,
      hasHistoricalExportRecord,
    };

    return projectWorkflow(facts);
  }, [datasetInfo, targetField, layerCount, structureValid, trainStatus, ledger, activeStudyId, auditPersistence]);
}
