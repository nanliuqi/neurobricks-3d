/**
 * 审计状态区（模块 06）：独立展示只追加审计链的健康状况。
 * - 不显示内部枚举；磁盘写入失败不得降级为普通提示；
 * - 不在 UI 假装修复 ledger，也不因审计异常隐藏已有证据；
 * - 措辞承认档案完整性限制。
 */
import Alert from '@/components/ui/Alert';
import StatusBadge from '@/components/ui/StatusBadge';
import { auditPersistenceLabel } from './studyLabels';

interface StudyAuditStatusProps {
  auditPersistence: 'unavailable' | 'healthy' | 'degraded';
  auditError: string | null;
}

export default function StudyAuditStatus({ auditPersistence, auditError }: StudyAuditStatusProps) {
  return (
    <section className="study-wb-section" aria-label="审计状态">
      <h4 className="study-wb-section__title">只追加审计链</h4>
      <StatusBadge
        tone={auditPersistence === 'healthy' ? 'success' : auditPersistence === 'degraded' ? 'danger' : 'neutral'}
        label={`审计状态：${auditPersistenceLabel(auditPersistence)}`}
      />
      {auditPersistence === 'degraded' && (
        <Alert tone="danger" title="磁盘审计写入失败">
          {auditError ?? '未知错误'}。在审计链恢复健康前，本次结论不得声称档案完整；
          关键动作可能被运行时拒绝。
        </Alert>
      )}
      {auditPersistence === 'unavailable' && (
        <p className="study-wb-note">
          浏览器环境无法写入桌面端只追加审计链；桌面运行时将自动启用。
        </p>
      )}
    </section>
  );
}
