/**
 * 审计状态横幅（模块 08）：
 * - degraded：显示审计链损坏原因与修复入口（保留既有可访问名）；
 * - unavailable：诚实显示档案持久化不可用，绝不伪装为健康状态；
 * - healthy：不渲染。
 */
import Button from '@/components/ui/Button';

interface ClaimAuditBannerProps {
  auditPersistence: 'unavailable' | 'healthy' | 'degraded';
  auditError: string | null;
  busy: boolean;
  onRepair: () => void;
}

export default function ClaimAuditBanner({ auditPersistence, auditError, busy, onRepair }: ClaimAuditBannerProps) {
  if (auditPersistence === 'healthy') return null;

  if (auditPersistence === 'degraded') {
    return (
      <div className="claim-composer__audit-warning" role="alert">
        <div>
          <strong>只追加审计链异常，解封入口已关闭</strong>
          <span>{auditError ?? '磁盘审计状态与当前事件快照不一致'}</span>
        </div>
        <Button size="small" variant="warning" loading={busy} onClick={onRepair}>
          修复并重新校验审计链
        </Button>
      </div>
    );
  }

  return (
    <div className="claim-composer__audit-warning claim-composer__audit-warning--unavailable" role="status">
      <div>
        <strong>档案持久化不可用</strong>
        <span>当前环境无法写入只追加审计链（浏览器模式或后端未就绪）；冻结与解封必须留痕，因此已失败关闭。这不是健康状态，也不提供越界入口。</span>
      </div>
    </div>
  );
}
