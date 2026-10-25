/**
 * 当前候选绑定卡片（模块 08）：只读展示，不伪装成可重新选择的下拉框。
 * - 无候选：明确引导先完成候选选择；
 * - 候选不属于当前 Study：失败关闭；
 * - 已绑定：展示 Experiment / Attempt / seed / 执行信任 / 三个身份哈希（截断 + Tooltip 完整值）
 *   与严格验证指标（模块 07 单一来源，不读数组尾项、不猜指标名/单位）；
 * - 严格指标不可用时诚实说明，但不阻止合法 Claim 创建；
 * - 已有 Claim 的绑定展示在各自记录卡内，不随当前候选变化。
 */
import Alert from '@/components/ui/Alert';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import Tooltip from '@/components/ui/Tooltip';
import type { CandidateBinding } from '@/utils/claimComposerViewModel';
import { truncateHash } from '@/utils/claimComposerViewModel';
import { executionTrustLabel } from '@/components/panels/study/studyLabels';

interface ClaimCandidateBindingProps {
  binding: CandidateBinding;
}

function HashCell({ label, hash }: { label: string; hash: string | null }) {
  return (
    <span className="claim-composer__binding-hash">
      {label}：
      <Tooltip content={<code>{hash ?? '缺失'}</code>}>
        <code>{truncateHash(hash)}</code>
      </Tooltip>
    </span>
  );
}

export default function ClaimCandidateBinding({ binding }: ClaimCandidateBindingProps) {
  if (binding.status === 'no_candidate') {
    return (
      <EmptyState
        title="尚无候选 Attempt"
        description="评估主张只能绑定当前 Study 的已选候选。请先在上方“候选与结论”中完成候选选择，再回到这里冻结主张。"
      />
    );
  }
  if (binding.status === 'candidate_not_in_study') {
    return (
      <Alert tone="danger" title="候选绑定异常">
        {binding.blockers.join('；')}。不以任何回退方式选择其他 Attempt。
      </Alert>
    );
  }
  const attempt = binding.attempt;
  if (!attempt) return null;

  return (
    <div className="claim-composer__binding" aria-label="当前候选绑定">
      <div className="claim-composer__binding-head">
        <strong>当前候选绑定（只读）</strong>
        {binding.canCreateClaim
          ? <StatusBadge tone="success" label="可创建主张" />
          : <StatusBadge tone="danger" label="暂不可创建主张" />}
      </div>
      <div className="claim-composer__binding-facts">
        <span>方案 {binding.experimentNumber} · {binding.experiment?.name ?? attempt.experimentId}</span>
        <span>Attempt #{attempt.ordinal}（{attempt.id}）</span>
        <span>seed {attempt.config.seed ?? '未固定'}</span>
        <span>执行信任：{executionTrustLabel(attempt.provenance.executionTrust)}</span>
      </div>
      <div className="claim-composer__binding-facts">
        <HashCell label="权重身份" hash={attempt.provenance.modelWeightsHash} />
        <HashCell label="测试集身份" hash={attempt.provenance.testSetHash} />
        <HashCell label="预处理身份" hash={attempt.provenance.preprocessingHash} />
      </div>
      <small className="claim-composer__binding-metric">
        {binding.strictMetricAvailable
          ? `严格验证指标：${binding.strictMetricText}`
          : '严格验证指标不可用（缺少唯一、完整且有限的 validation/epoch 指标）；这不影响主张创建，裁决仍以解封时的协议计算为准。'}
      </small>
      {binding.blockers.length > 0 && (
        <Alert tone="warning" title="候选资格阻断">
          {binding.blockers.join('；')}。修复前不能以该候选创建主张。
        </Alert>
      )}
    </div>
  );
}
