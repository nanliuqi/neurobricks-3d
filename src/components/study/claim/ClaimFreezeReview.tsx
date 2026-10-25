/**
 * 冻结复核内容（模块 08）：确认框必须完整呈现真正被冻结的身份与规格。
 * - 草稿版本、Study、Experiment/Attempt；
 * - 三个身份哈希（截断展示 + Tooltip 完整值，可核对不留省略死角）；
 * - 主指标与全部 AND 护栏的 metric/operator/threshold/targetClass/aggregation/
 *   confidenceLevel/intervalMethod/minimumEffectiveSampleSize/bootstrap 参数；
 * - 全部统计预演 blocker 与 warning。
 */
import Tooltip from '@/components/ui/Tooltip';
import type { EvaluationClaim, Experiment, Study } from '@/types/experiment';
import { predicateSpecRows, truncateHash } from '@/utils/claimComposerViewModel';

interface ClaimFreezeReviewProps {
  draft: EvaluationClaim;
  study: Study;
  experiment: Experiment | null;
  attemptOrdinal: number | null;
  warnings: string[];
}

export default function ClaimFreezeReview({ draft, study, experiment, attemptOrdinal, warnings }: ClaimFreezeReviewProps) {
  const hashRow = (label: string, hash: string | null) => (
    <span className="claim-composer__review-hash">
      {label}：<Tooltip content={<code>{hash ?? '缺失'}</code>}><code>{truncateHash(hash)}</code></Tooltip>
    </span>
  );
  return (
    <div className="claim-composer__review">
      <p>冻结后，指标、阈值、统计方法、候选权重和测试集身份都不能原地修改。需要调整时只能建立新的派生主张。</p>
      <div className="claim-composer__review-identity">
        <span>草稿版本：v{draft.revision ?? 'legacy'} · Claim <code>{draft.id}</code></span>
        <span>Study：{study.name} · 方案：{experiment?.name ?? draft.attemptId}{attemptOrdinal !== null ? ` · Attempt #${attemptOrdinal}` : ''}</span>
        {hashRow('权重', draft.modelWeightsHash)}
        {hashRow('测试集', draft.testDatasetHash)}
        {hashRow('预处理', draft.preprocessingHash)}
      </div>
      {draft.predicates.map(predicate => (
        <div key={predicate.id} className="claim-composer__review-predicate">
          <strong>{predicate.role === 'primary' ? '主指标' : 'AND 护栏'} <code>{predicate.id}</code></strong>
          <dl>
            {predicateSpecRows(predicate).map(row => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {warnings.length > 0 ? (
        <div className="protocol-confirm__warnings">
          <strong>统计预演警告</strong>
          {warnings.map((message, index) => <span key={`${index}-${message}`}>• {message}</span>)}
        </div>
      ) : (
        <p>当前统计预演没有阻断项；这不代表模型必然达标。</p>
      )}
    </div>
  );
}
