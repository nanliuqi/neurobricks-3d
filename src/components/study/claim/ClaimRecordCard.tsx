/**
 * Claim 记录卡（模块 08）：完整回答“裁决回答了哪条预注册主张、为什么是这个信任等级”。
 * - verdict/状态标签失败关闭：未知 status → 主张状态异常并禁止全部信任动作；
 *   未知 verdict → 裁决记录异常，不冒充 INCONCLUSIVE 或未裁决；不展示原始未知字符串；
 * - 有效信任一律来自 projectEffectiveClaimTrust 投影，绝不直接读存档 conclusionTrust 背书；
 * - PASS/FAIL/INCONCLUSIVE 使用相同信息层级（同色调徽章 + 文字 + 图标），不做羞辱配色；
 * - 结果表完整展示：角色/指标/验收方向/阈值/点估计/区间/n/实际置信水平/区间方法/子句裁决 + AND 总裁决；
 * - 非有限数值渲染“不可用”，绝不输出 NaN/Infinity；
 * - 混淆矩阵 React key 使用 classIndex（类别重名不冲突），>12 类诚实降级；
 * - post_hoc：显示“事后主张，不具备独立验证资格”，不显示金标、无冻结/首次解封入口。
 */
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import Tooltip from '@/components/ui/Tooltip';
import type { Attempt, EvaluationClaim, Study } from '@/types/experiment';
import type { EffectiveClaimTrustProjection } from '@/utils/claimProtocol';
import { claimLabelSet, hasDuplicatePredicateResults, matrixCountText, resultRows, truncateHash } from '@/utils/claimComposerViewModel';

export function trustLabel(value: string): string {
  if (value === 'gold') return '金标结论';
  if (value === 'iid_only') return '仅在 IID/声明前提下成立';
  if (value === 'exploratory') return '探索性结论';
  return '尚未形成结论信任';
}

export function unsealLabel(sequence: number | null): string {
  if (sequence === null) return '尚未解封';
  return sequence === 1
    ? '第 1 次解封（首次独立验证）'
    : `第 ${sequence} 次解封（事后验证，不具金标资格）`;
}

/** 信任等级的协议解释；末行必须与统一投影一致，投影降级时绝不单独声称“满足金标条件”。 */
export function trustReason(study: Study, attempt: Attempt | null | undefined, claim: EvaluationClaim, projection: EffectiveClaimTrustProjection): string {
  if (claim.status !== 'adjudicated') return '主张尚未完成裁决。';
  if (!attempt) return '找不到主张绑定的 Attempt。';
  if (claim.unsealSequence !== 1) return `该测试集已是第 ${claim.unsealSequence ?? '?'} 次解封；金标只属于第一次预注册裁决。`;
  if (attempt.provenance.executionTrust !== 'trusted') return '绑定 Attempt 未达到受控管线执行可信。';
  const split = study.datasetContract.split;
  if (split.strategy === 'group' || split.strategy === 'temporal') return '当前区间尚未采用 cluster/block bootstrap，只能按 IID 前提解释。';
  const expectedUnit = study.datasetContract.identity.taskType === 'tabular_regression' ? 'row' : 'image';
  if (split.sampleUnit !== expectedUnit) return `样本单位为“${split.sampleUnit ?? '未声明'}”，尚未满足原子 ${expectedUnit} 单位的金标条件。`;
  if (split.independence === 'iid_assumed' || (split.independence === 'user_declared' && !split.userDeclaration?.trim())) {
    return '独立性只有默认 IID 假设，缺少机器验证或明确用户声明。';
  }
  if (attempt.provenance.machineChecks.length === 0) return '本次 Attempt 没有落盘任何泄漏机器检查结果。';
  const failedCheck = attempt.provenance.machineChecks.find(check => check.status !== 'passed');
  if (failedCheck) return `机器检查 ${failedCheck.check} 状态为 ${failedCheck.status}。`;
  // 结构条件全部满足时，结论以统一投影为准：投影降级（审计不完整/档案阻断/未知枚举等）
  // 时不得声称满足金标条件。
  return projection.effectiveTrust === 'gold'
    ? '首次解封、执行可信、独立性契约与机器检查均满足金标条件。'
    : '结构条件满足，但统一信任投影给出更低等级；以下方降级原因为准，不声称满足金标条件。';
}

const DEMOTION_REASON_LABELS: Record<string, string> = {
  claim_not_in_study: 'Claim 不属于当前 Study',
  attempt_missing: '找不到主张绑定的 Attempt',
  attempt_mismatch: 'Claim 与 Attempt 绑定不一致',
  unknown_claim_status: 'Claim 状态无法识别',
  missing_verdict: '缺少裁决结果',
  unknown_verdict: '裁决结果无法识别',
  unknown_conclusion_trust: '存档结论信任字段异常',
  audit_incomplete: '只追加审计链不完整',
  audit_persistence_not_healthy: '当前档案持久化状态无法背书',
  attempt_not_eligible: '绑定 Attempt 不是已知的完成且受控可信状态，不授予结论信任',
  trust_mismatch: '存档与协议重算等级不一致（已取更低等级）',
};

export function demotionReasonText(projection: EffectiveClaimTrustProjection): string | null {
  if (projection.eligible && !projection.trustMismatch) return null;
  const labels = projection.reasons
    .map(reason => DEMOTION_REASON_LABELS[reason])
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels.join('；') : null;
}

interface ClaimRecordCardProps {
  claim: EvaluationClaim;
  study: Study;
  attempt: Attempt | null;
  projection: EffectiveClaimTrustProjection;
  unsealState: { label: string; disabled: boolean; reason: string | null };
  busy: boolean;
  onEvaluate: (claimId: string) => void;
  onEditDraft: (claimId: string) => void;
}

export default function ClaimRecordCard({
  claim,
  study,
  attempt,
  projection,
  unsealState,
  busy,
  onEvaluate,
  onEditDraft,
}: ClaimRecordCardProps) {
  const labels = claimLabelSet(claim);
  const rows = resultRows(claim);
  const demotion = demotionReasonText(projection);
  const duplicateResults = hasDuplicatePredicateResults(claim);
  // 未知状态/未知 verdict：禁止全部信任动作（失败关闭）。
  const actionsLocked = labels.statusAbnormal || labels.verdictAbnormal;
  const isPostHoc = claim.status === 'post_hoc';
  const diagnostics = claim.classificationDiagnostics;
  // 类别标签与索引长度不一致 → 诚实降级，不猜标签。
  const matrixLabelsConsistent = diagnostics !== null
    && Array.isArray(diagnostics.classLabels)
    && diagnostics.classLabels.length === diagnostics.classIndices.length;
  const matrixLabel = (index: number, classIndex: number): string => (
    matrixLabelsConsistent && diagnostics ? diagnostics.classLabels[index] ?? `类别 ${classIndex}` : `类别 ${classIndex}`
  );

  return (
    <article className="claim-composer__claim">
      <div className="claim-composer__claim-head">
        {/* 三种裁决同一信息层级：文字 + 图标承载语义，不靠颜色分优劣 */}
        <StatusBadge tone="info" label={labels.verdictText} />
        <span>
          {trustLabel(projection.effectiveTrust)} · {labels.statusLabel} · v{claim.revision ?? 'legacy'}
        </span>
        {labels.statusAbnormal && <StatusBadge tone="danger" label="主张状态异常（全部信任动作已关闭）" />}
        {labels.verdictAbnormal && <StatusBadge tone="danger" label="裁决记录异常（不冒充任何正式裁决）" />}
      </div>

      <small className="claim-composer__trust">
        解封序号：{unsealLabel(claim.unsealSequence)} · {trustReason(study, attempt, claim, projection)}
        {demotion ? ` · 降级原因：${demotion}` : ''}
      </small>

      {isPostHoc && (
        <small className="claim-composer__post-hoc">
          事后主张，不具备独立验证资格；本记录仅诚实留档，不显示金标，也不提供冻结或首次解封入口。
        </small>
      )}

      <small>
        绑定身份：Attempt <code>{claim.attemptId}</code> · 权重 <Tooltip content={<code>{claim.modelWeightsHash}</code>}><code>{truncateHash(claim.modelWeightsHash)}</code></Tooltip>
        {claim.status !== 'draft' && (
          <> · frozenHash <Tooltip content={<code>{claim.frozenHash ?? '缺失'}</code>}><code>{truncateHash(claim.frozenHash)}</code></Tooltip></>
        )}
      </small>

      <small>{claim.predicates.map(predicate => `${predicate.role === 'primary' ? '主指标' : predicate.role === 'guardrail' ? '护栏' : '角色异常'} ${predicate.metric} ${predicate.operator === 'gte' ? '≥' : '≤'} ${predicate.threshold}`).join(' AND ')}</small>

      {duplicateResults && (
        <small className="claim-composer__post-hoc">
          结果记录异常：predicateResults 出现重复 predicateId，不静默覆盖；下表保留全部记录以供核对。
        </small>
      )}

      {rows.length > 0 && (
        <table className="claim-composer__results">
          <caption>子句裁决（全部子句 AND 后形成总裁决 {labels.verdictText}）</caption>
          <thead>
            <tr>
              <th scope="col">角色</th>
              <th scope="col">指标</th>
              <th scope="col">验收</th>
              <th scope="col">点估计</th>
              <th scope="col">区间</th>
              <th scope="col">n_eff</th>
              <th scope="col">实际置信度</th>
              <th scope="col">方法</th>
              <th scope="col">子句裁决</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row.predicateId}-${rowIndex}`}>
                <td>{row.role}</td>
                <td>{row.metric}</td>
                <td>{row.acceptance}</td>
                <td>{row.pointEstimate}</td>
                <td>{row.interval}</td>
                <td>{row.effectiveSampleSize}</td>
                <td>{row.actualConfidence}</td>
                <td>{row.intervalMethod}</td>
                <td>{row.clauseVerdict}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {diagnostics && (
        <div className="claim-composer__matrix">
          <strong>混淆矩阵（行=真实，列=预测）</strong>
          {!matrixLabelsConsistent && (
            <small>类别标签与索引长度不一致，已诚实降级为索引展示；不猜测标签。</small>
          )}
          {diagnostics.classIndices.length <= 12 ? (
            <table>
              <thead>
                <tr>
                  <th>真实＼预测</th>
                  {/* key 使用 classIndex+位置：classIndices 重复时也不产生 duplicate key */}
                  {diagnostics.classIndices.map((classIndex, columnIndex) => (
                    <th key={`${classIndex}-${columnIndex}`}>{matrixLabel(columnIndex, classIndex)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diagnostics.classIndices.map((actual, rowIndex) => (
                  <tr key={`${actual}-${rowIndex}`}>
                    <th>{matrixLabel(rowIndex, actual)}</th>
                    {diagnostics.classIndices.map((predicted, columnIndex) => (
                      <td key={`${predicted}-${columnIndex}`}>
                        {matrixCountText(diagnostics.entries.find(entry => entry.actual === actual && entry.predicted === predicted)?.count ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <small>类别超过 12，界面省略方阵；完整稀疏计数保留在 Study manifest。</small>}
          {diagnostics.perClassRecall.map(item => (
            <small key={item.classIndex}>
              {item.label}：support={matrixCountText(item.support)} · recall={item.recall !== null && Number.isFinite(item.recall) ? item.recall.toFixed(4) : '不可计算'}
            </small>
          ))}
        </div>
      )}

      {claim.verdict === 'inconclusive' && (
        <small>行动建议：当前证据无法区分达标与未达标，优先补充对应有效样本，不要继续从同一测试集挑指标。</small>
      )}

      {!actionsLocked && claim.status === 'frozen' && !isPostHoc && (
        <>
          <Button size="small" variant="warning" disabled={unsealState.disabled} onClick={() => onEvaluate(claim.id)}>
            {unsealState.label}
          </Button>
          {unsealState.reason && (
            <small className="claim-composer__post-hoc">解封关闭原因：{unsealState.reason}。封存集未访问。</small>
          )}
        </>
      )}
      {!actionsLocked && claim.status === 'draft' && (
        <Button size="small" disabled={busy} onClick={() => onEditDraft(claim.id)}>
          编辑草稿
        </Button>
      )}
    </article>
  );
}
