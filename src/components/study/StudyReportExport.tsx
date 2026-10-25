import { useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useExperimentStore, verifyExperimentLedgerAudit } from '@/stores/useExperimentStore';
import { generateStudyReport, type StudyReportBundle } from '@/utils/studyReport';

interface StudyReportExportProps {
  studyId: string;
  studyName: string;
}

/**
 * 待确认导出快照（TOCTOU 修复）：降级确认是对“请求时冻结的报告快照”的确认，
 * 不是对未来任意状态的授权：
 * - bundle 在审计检查后立即生成并冻结（水印由请求时的审计状态决定）；
 * - 确认时直接写出冻结 bundle，不用确认时最新 ledger 重新生成；
 * - 审计后来恢复不会自动移除水印；想要健康版本应取消并重新发起；
 * - 等待期间新增的 Attempt/Claim/事件不会混入本次导出。
 */
interface PendingExport {
  studyId: string;
  studyName: string;
  directory: string;
  /** 冻结的目录名（含请求时时间戳）。 */
  directoryName: string;
  /** 请求时的审计状态；降级确认时强制为 degraded。 */
  auditPersistenceAtRequest: 'unavailable' | 'healthy' | 'degraded';
  /** 请求时生成并冻结的报告内容。 */
  bundle: StudyReportBundle;
}

function safeFilename(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[.\s]+$/, '')
    .slice(0, 80) || 'neurobricks-study';
}

export default function StudyReportExport({ studyId, studyName }: StudyReportExportProps) {
  const [choosing, setChoosing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(null);

  // 同步锁：同一时刻只允许一个目录选择器；最终导出单独加锁防止连续确认双发。
  const pickerLockRef = useRef(false);
  const exportLockRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const performExport = async (pending: PendingExport) => {
    // 身份防串用：等待确认期间切换/归档了 Study，不得把旧 Study 的报告导出。
    const state = useExperimentStore.getState();
    const study = state.ledger.studies.find(item => item.id === pending.studyId);
    if (!study || study.archivedAt || state.activeStudyId !== pending.studyId) {
      if (mountedRef.current) setPendingExport(null);
      toast.error('Study 已变化，待确认的导出已取消；请在当前 Study 重新发起导出');
      return;
    }
    if (exportLockRef.current) return;
    exportLockRef.current = true;
    if (mountedRef.current) setExporting(true);
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      // 直接写出请求时冻结的 bundle：不重新生成、不因审计恢复移除水印、
      // 不混入等待期间新增的证据；也不再打开目录选择器。
      const separator = pending.directory.endsWith('\\') || pending.directory.endsWith('/') ? '' : '\\';
      await invoke('export_study_report', {
        dirPath: `${pending.directory}${separator}${pending.directoryName}`,
        readmeMd: pending.bundle.readme,
        manifestJson: pending.bundle.manifestJson,
        comparisonCsv: pending.bundle.comparisonCsv,
      });
      useExperimentStore.getState().appendEvent('study', pending.studyId, 'study_report_export_completed', {
        format: 'neurobricks-study-report-v1',
        auditPersistence: pending.auditPersistenceAtRequest,
      });
      await verifyExperimentLedgerAudit();
      if (mountedRef.current) setPendingExport(null);
      toast.success(`Study 报告已导出：${pending.directoryName}`);
    } catch (error) {
      useExperimentStore.getState().appendEvent('study', pending.studyId, 'study_report_export_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      toast.error(`Study 报告导出失败：${error instanceof Error ? error.message : String(error)}`);
      // 失败后弹窗保留（锁存复位），重试仍使用同一个冻结快照。
    } finally {
      exportLockRef.current = false;
      if (mountedRef.current) setExporting(false);
    }
  };

  /** 请求时生成并冻结报告快照（bundle + 目录名 + 审计状态）。 */
  const freezeReportSnapshot = (directory: string, auditHealthy: boolean): PendingExport => {
    const state = useExperimentStore.getState();
    const auditAtRequest = auditHealthy ? state.auditPersistence : 'degraded';
    const bundle = generateStudyReport(state.ledger, studyId, auditAtRequest);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    return {
      studyId,
      studyName,
      directory,
      directoryName: `${safeFilename(studyName)}_study_${timestamp}`,
      auditPersistenceAtRequest: auditAtRequest,
      bundle,
    };
  };

  const handleExport = async () => {
    if (pickerLockRef.current || pendingExport) return;
    pickerLockRef.current = true;
    if (mountedRef.current) setChoosing(true);
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const parent = await open({ directory: true, title: '选择 Study 报告保存位置' });
      // 用户取消选择器不是错误，也不写取消事件。
      if (!parent || Array.isArray(parent)) return;

      useExperimentStore.getState().appendEvent('study', studyId, 'study_report_export_requested', {
        format: 'neurobricks-study-report-v1',
      });
      const auditHealthy = await verifyExperimentLedgerAudit();
      // 审计检查后立即基于当时的 ledger 冻结报告快照。
      const snapshot = freezeReportSnapshot(parent, auditHealthy);
      if (!auditHealthy) {
        // 审计降级：确认针对的是这个冻结快照；确认前不得调用最终导出。
        if (mountedRef.current) setPendingExport(snapshot);
        return;
      }
      await performExport(snapshot);
    } catch (error) {
      useExperimentStore.getState().appendEvent('study', studyId, 'study_report_export_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      toast.error(`Study 报告导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pickerLockRef.current = false;
      if (mountedRef.current) setChoosing(false);
    }
  };

  const handleCancelPending = () => {
    if (!pendingExport) return;
    // 取消仍写入既有的 export_cancelled 事件，不导出文件。
    useExperimentStore.getState().appendEvent('study', pendingExport.studyId, 'study_report_export_cancelled', {
      reason: 'audit_degraded',
    });
    setPendingExport(null);
  };

  return (
    <>
      <Button
        size="small"
        onClick={handleExport}
        disabled={choosing || exporting || Boolean(pendingExport)}
        aria-busy={choosing || exporting}
      >
        {choosing || exporting ? '正在导出…' : '导出 Study 报告'}
      </Button>
      {pendingExport && (
        <ConfirmDialog
          title="审计链未通过校验，仍然导出？"
          tone="warning"
          busy={exporting}
          confirmLabel="带档案不完整标记导出"
          cancelLabel="取消导出"
          description={
            <>
              <p>只追加审计链当前未通过完整性校验。报告已按请求时状态冻结，将强制标注“档案不完整”；即使确认前审计恢复，本次导出也不会移除水印。</p>
              <p>若需要不带标记的版本，请取消后重新发起导出。切换 Study 或归档会使本次待确认导出作废。</p>
            </>
          }
          onCancel={handleCancelPending}
          onConfirm={() => { void performExport(pendingExport); }}
        />
      )}
    </>
  );
}
