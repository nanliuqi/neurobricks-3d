/**
 * 解封复核内容（模块 08 可信边界补丁）：三种确认语义 + invalid 不渲染。
 * - first：第 1 次（首次独立验证）+“永久消耗这份测试集的一次独立验证资格”+“取消不会访问封存集”；
 * - subsequent：真实第 N 次事后验证，明确测试集此前已解封，不恢复金标资格，
 *   绝不使用“首次独立验证”措辞；这是新 Claim 的新解封事件，不是 retry；
 * - retry：原序号（只追加事件为准）、不创建新主张、不分配新序号；
 * - 冻结 Claim 自身身份与当前 Attempt 身份分开展示（不得互相冒充）；
 * - 快照与事件不一致时展示档案不一致警告。
 */
import Tooltip from '@/components/ui/Tooltip';
import type { UnsealReview } from '@/utils/claimComposerViewModel';
import { truncateHash } from '@/utils/claimComposerViewModel';

interface ClaimUnsealReviewProps {
  review: UnsealReview;
}

export default function ClaimUnsealReview({ review }: ClaimUnsealReviewProps) {
  const hashRow = (label: string, hash: string | null) => (
    <span className="claim-composer__review-hash">
      {label}：<Tooltip content={<code>{hash ?? '缺失'}</code>}><code>{truncateHash(hash)}</code></Tooltip>
    </span>
  );
  return (
    <div className="claim-composer__review">
      <div className="claim-composer__review-identity">
        <span>Claim <code>{review.claimId}</code> · v{review.revision ?? 'legacy'} · Attempt <code>{review.attemptId}</code></span>
        {hashRow('冻结 frozenHash', review.frozenHash)}
        <span>冻结 Claim 身份（冻结时刻的值）：</span>
        {hashRow('冻结权重', review.claimModelWeightsHash)}
        {hashRow('冻结测试集', review.claimTestDatasetHash)}
        {hashRow('冻结预处理', review.claimPreprocessingHash)}
        <span>当前 Attempt 身份（供核对，漂移已在入口关闭）：</span>
        {hashRow('当前权重', review.attemptModelWeightsHash)}
        {hashRow('当前测试集', review.attemptTestSetHash)}
        {hashRow('当前预处理', review.attemptPreprocessingHash)}
        <span>Attempt 权重文件身份：<code>{review.attemptModelId ?? '缺失'}</code></span>
      </div>

      {review.snapshotMismatch && (
        <p><strong>档案不一致警告：</strong>{review.reasons.find(reason => reason.includes('不一致')) ?? '快照与审计事件不一致，以只追加事件为准。'}</p>
      )}

      {review.mode === 'first' && (
        <p>
          预计解封序号：<strong>第 {review.sequence} 次（首次独立验证）</strong>。
          解封许可一旦通过只追加审计并开始 eval-only，就会永久消耗这份测试集的一次独立验证资格。取消不会访问封存集。
        </p>
      )}
      {review.mode === 'subsequent' && (
        <p>
          预计解封序号：<strong>第 {review.sequence} 次（事后验证，不具首次独立验证资格）</strong>。
          该测试集此前已被解封（历史序号 {review.testSetHistory.join('、')}）；本次是新主张的一次新解封事件，
          不是对既有裁决的重试，也不会恢复金标资格。取消不会访问封存集。
        </p>
      )}
      {review.mode === 'retry' && (
        <p>
          原解封序号：<strong>第 {review.sequence} 次</strong>（以只追加审计事件为准）。
          这会使用已经留痕的同一冻结模型、同一主张和同一解封序号重试确定性裁决，不创建新问题：
          不创建新主张、不分配新解封序号，这不是新的独立验证。
        </p>
      )}
    </div>
  );
}
