/**
 * 方差资格（模块 07）：
 * - 单 seed → “未验证方差”，禁止显著/稳定/可靠措辞；
 * - 多 seed 未配对 → 显示真实 seed 数并说明不自动构成配对消融证据；
 * - 配对消融 → 显示配对数量；n=1 仍标记方差证据不足。
 */
import StatusBadge from '@/components/ui/StatusBadge';
import type { VarianceQualification } from '@/utils/comparisonViewModel';

interface VarianceEvidenceProps {
  qualification: VarianceQualification | null;
}

export default function VarianceEvidence({ qualification }: VarianceEvidenceProps) {
  if (!qualification) return null;

  if (qualification.kind === 'single_seed') {
    return (
      <div className="comparison-view__variance">
        <StatusBadge tone="neutral" label="未验证方差（单 seed）" />
        <small>
          当前对比只覆盖 seed={qualification.seed ?? '未固定'} 的一次运行；不能据此声称差异显著、稳定或可靠。
        </small>
      </div>
    );
  }
  if (qualification.kind === 'multi_seed_unpaired') {
    return (
      <div className="comparison-view__variance">
        <StatusBadge tone="info" label={`多 seed 记录（${qualification.seedCount} 个）`} />
        <small>
          已有多 seed 记录（{qualification.seeds.join('、')}），但不自动构成配对消融证据；
          未配对的多 seed 也不代表方差已验证。
        </small>
      </div>
    );
  }
  return (
    <div className="comparison-view__variance">
      <StatusBadge
        tone={qualification.pairCount >= 2 ? 'success' : 'warning'}
        label={`配对消融证据：${qualification.pairCount} 对 / ${qualification.seedCount} 个 seed`}
      />
      <small>
        {qualification.pairCount < 2
          ? '配对数量 n=1：方差证据不足，不能声称差异稳定。'
          : '配对区间由既有 seeded bootstrap 协议函数给出；配对数量与 seed 交集见下方面板。'}
      </small>
    </div>
  );
}
