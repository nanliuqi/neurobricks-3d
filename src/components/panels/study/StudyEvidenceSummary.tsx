/**
 * 证据摘要（模块 06 验收补丁）：只组织当前 Study 严格归属的真实证据。
 * - 区分“执行可信”与“结论可信”：存在可信 completed Attempt 不等于结论可信；
 * - 结论等级只来自 Claim 证据投影（裁决记录 + 审计完整性 + 协议重算信任），
 *   不再用含糊的“存在独立测试裁决”；
 * - 裁决结果（PASS/FAIL/INCONCLUSIVE）与信任等级是两条正交信息，FAIL 不被羞辱性降级；
 * - 未知状态按非完成、非可信处理并计入记录异常。
 */
import StatusBadge from '@/components/ui/StatusBadge';
import type { Study } from '@/types/experiment';
import {
  claimRecordSummary,
  conclusionGradeText,
  type StudyClaimEvidenceProjection,
  type StudyEvidenceSummary,
} from './studyOverviewViewModel';

interface StudyEvidenceSummarySectionProps {
  study: Study;
  summary: StudyEvidenceSummary;
  claimProjection: StudyClaimEvidenceProjection;
  auditPersistence: 'unavailable' | 'healthy' | 'degraded';
  candidateAttemptOrdinal: number | null;
}

export default function StudyEvidenceSummarySection({
  study,
  summary,
  claimProjection,
  auditPersistence,
  candidateAttemptOrdinal,
}: StudyEvidenceSummarySectionProps) {
  const gradeText = conclusionGradeText(claimProjection);
  // 逐条 Claim 展示裁决结果与自身有效等级，不只展示 Study 最高等级。
  const verdictLines = claimProjection.records
    .filter(record => record.verdict !== null || record.classification !== 'normal')
    .map(record => claimRecordSummary(record));
  const degradedWithRecords = auditPersistence !== 'healthy' && claimProjection.adjudicatedRecords > 0;

  return (
    <section className="study-wb-section" aria-label="证据摘要">
      <h4 className="study-wb-section__title">证据摘要</h4>
      <div className="study-panel__facts study-wb-evidence-facts">
        <span>Experiment {summary.experimentCount}</span>
        <span>Attempt 总数 {summary.attemptCount}</span>
        <span>已完成 {summary.completedCount}</span>
        <span>进行态（启动/运行/暂停）{summary.activeCount}</span>
        <span>失败/取消/中断 {summary.failedCount}</span>
        <span>执行可信的完成 Attempt {summary.trustedCompletedCount}</span>
        <span>外部或未验证 Attempt {summary.unverifiedOrExternalCount}</span>
        <span>有部分曲线但不可比较 {summary.partialCurveOnlyCount}</span>
        {summary.anomalousAttemptRecordCount > 0 && (
          <span>记录异常的 Attempt {summary.anomalousAttemptRecordCount}</span>
        )}
        <span>当前候选 {candidateAttemptOrdinal !== null ? `Attempt #${candidateAttemptOrdinal}` : '未选择'}</span>
        <span>Claim {summary.claimCount}</span>
        <span>
          裁决记录 {claimProjection.adjudicatedRecords} · 正式 verdict {claimProjection.formalVerdictRecords} ·
          {' '}实体审计完整 {claimProjection.auditCompleteRecords}
        </span>
        {claimProjection.structuralAnomalyCount > 0 && (
          <span>记录异常 {claimProjection.structuralAnomalyCount} 条</span>
        )}
        {claimProjection.nonAuthoritativeCount > 0 && (
          <span>合法但不具备独立背书资格 {claimProjection.nonAuthoritativeCount} 条</span>
        )}
        {claimProjection.persistenceBlockedCount > 0 && (
          <span>因当前档案持久化状态无法背书 {claimProjection.persistenceBlockedCount} 条</span>
        )}
      </div>
      <div className="study-wb-evidence-trust">
        <StatusBadge
          tone={summary.trustedCompletedCount > 0 ? 'success' : 'neutral'}
          label={`执行可信：${summary.trustedCompletedCount} 个完成 Attempt`}
        />
        <StatusBadge
          tone={claimProjection.highestEffectiveTrust === 'gold'
            ? 'success'
            : claimProjection.highestEffectiveTrust !== null ? 'info' : 'neutral'}
          label={gradeText}
        />
      </div>
      {verdictLines.length > 0 && (
        <p className="study-wb-note">裁决明细：{verdictLines.join('；')}（裁决结果与信任等级是两条独立信息，等级只归属具体 Claim）</p>
      )}
      {degradedWithRecords && (
        <p className="study-wb-note study-wb-note--warning">
          协议裁决记录存在，但当前无法为档案完整性背书；已有裁决仍可浏览，不得显示为金标或档案完整。
        </p>
      )}
      <p className="study-wb-note">
        执行可信只说明运行过程受控完成；结论可信必须由通过审计完整性校验并协议重算的主张给出，二者不得互相替代。
        {study.kind === 'free_exploration' && '自由探索型 Study 不产生候选与正式排序结论。'}
      </p>
    </section>
  );
}
