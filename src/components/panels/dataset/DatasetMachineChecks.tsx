/**
 * 机器检查结果展示：逐项展示检查类型、状态（文字+图标）、说明与 detail。
 * - machineChecks 为空时显示“尚无逐项机器检查记录”，不得显示“全部通过”；
 * - 存在 failed 时在顶部给出摘要告警，不隐藏；
 * - 文案只陈述实际协议行为：检查未全部通过时结论信任等级不能升到最高（金标，
 *   见 claimProtocol）；训练是否可启动由统一训练前检查裁决，本区域不虚构阻断。
 */
import Alert from '@/components/ui/Alert';
import StatusBadge from '@/components/ui/StatusBadge';
import type { DatasetInfo } from '@/types/dataset';
import {
  MACHINE_CHECK_DESCRIPTIONS,
  MACHINE_CHECK_LABELS,
  MACHINE_CHECK_STATUS_LABELS,
  type MachineCheckStatus,
  type MachineCheckType,
} from '@/utils/datasetPanelViewModel';
import { ScanIcon } from './datasetIcons';

const STATUS_TONE: Record<MachineCheckStatus, 'success' | 'danger' | 'neutral'> = {
  passed: 'success',
  failed: 'danger',
  not_run: 'neutral',
};

interface DatasetMachineChecksProps {
  datasetInfo: DatasetInfo;
}

export default function DatasetMachineChecks({ datasetInfo }: DatasetMachineChecksProps) {
  const checks = datasetInfo.machineChecks ?? [];

  return (
    <section className="dataset-wb-section" aria-label="机器检查">
      <h4 className="dataset-wb-section__title">机器检查</h4>

      {checks.length === 0 ? (
        <div className="dataset-wb-machine-empty">
          <ScanIcon size={16} />
          <span>尚无逐项机器检查记录</span>
        </div>
      ) : (
        <>
          {checks.some(check => check.status === 'failed') && (
            <Alert tone="danger" title="存在未通过的泄漏检查">
              机器检查未全部通过时，该证据不能获得最高结论信任等级（金标）；
              训练是否可启动以统一训练前检查为准。
            </Alert>
          )}
          <ul className="dataset-wb-machine-list">
            {checks.map(check => {
              const label = MACHINE_CHECK_LABELS[check.check as MachineCheckType] ?? check.check;
              const description = MACHINE_CHECK_DESCRIPTIONS[check.check as MachineCheckType];
              return (
                <li key={`${check.check}-${check.status}`} className="dataset-wb-machine-item">
                  <div className="dataset-wb-machine-item__head">
                    <strong className="dataset-wb-machine-item__name">{label}</strong>
                    <StatusBadge
                      tone={STATUS_TONE[check.status] ?? 'neutral'}
                      label={MACHINE_CHECK_STATUS_LABELS[check.status] ?? check.status}
                    />
                  </div>
                  {description && <p className="dataset-wb-note">{description}</p>}
                  {check.details && <p className="dataset-wb-note dataset-wb-note--mono">{check.details}</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
