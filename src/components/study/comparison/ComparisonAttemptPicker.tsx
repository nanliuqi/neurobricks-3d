/**
 * 运行选择（模块 07）：
 * - 严格完成组（completed + trusted）可勾选；
 * - 不可信完成结果单独列出且禁用（不进入严格完成组，也不可被 override 拉入曲线）；
 * - 未完成 Attempt 进入“诊断性部分曲线”区，显示真实中文状态与已有范围；
 * - 超过 4 条上限给出可见提示，不静默忽略。
 */
import type { Attempt, Experiment, ExperimentLedgerV1 } from '@/types/experiment';
import { attemptStatusLabel, executionTrustLabel } from '@/components/panels/study/studyLabels';
import { extractDiagnosticSeries } from '@/utils/metricSeries';
import { MAX_COMPARISON_CURVES } from '@/utils/comparisonViewModel';

interface ComparisonAttemptPickerProps {
  ledger: ExperimentLedgerV1;
  experiments: Experiment[];
  eligibleAttempts: Attempt[];
  /** completed 但非 trusted：可见但禁用。 */
  untrustedCompleted: Attempt[];
  partialAttempts: Attempt[];
  groups: Array<{ key: string | null; attemptIds: string[] }>;
  selectedIds: string[];
  overflowNotice: string | null;
  onToggle: (attemptId: string) => void;
}

export default function ComparisonAttemptPicker({
  ledger,
  experiments,
  eligibleAttempts,
  untrustedCompleted,
  partialAttempts,
  groups,
  selectedIds,
  overflowNotice,
  onToggle,
}: ComparisonAttemptPickerProps) {
  const nameOf = (attempt: Attempt) => experiments.find(experiment => experiment.id === attempt.experimentId)?.name ?? attempt.experimentId;

  return (
    <div className="comparison-view__picker">
      <div className="comparison-view__groups">
        {groups.map((group, groupIndex) => (
          <div key={group.key ?? `isolated-${group.attemptIds.join('-')}`}>
            <span>{group.key ? `严格可比组 ${groupIndex + 1}` : '孤立结果（元数据缺失、指标不完整或未验证）'}</span>
            {group.attemptIds.map(attemptId => {
              const attempt = eligibleAttempts.find(item => item.id === attemptId);
              if (!attempt) return null;
              return (
                <label key={attemptId}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(attemptId)}
                    onChange={() => onToggle(attemptId)}
                  />
                  {nameOf(attempt)} · #{attempt.ordinal} · seed {attempt.config.seed ?? '未固定'} · {executionTrustLabel(attempt.provenance.executionTrust)}
                </label>
              );
            })}
          </div>
        ))}
      </div>

      {untrustedCompleted.length > 0 && (
        <div className="comparison-view__untrusted">
          <span>已完成但执行不可信（不得进入严格对比）：</span>
          {untrustedCompleted.map(attempt => (
            <label key={attempt.id} title="受控管线之外的完成结果，不能作为严格对比证据">
              <input type="checkbox" disabled checked={false} onChange={() => {}} />
              {nameOf(attempt)} · #{attempt.ordinal} · {executionTrustLabel(attempt.provenance.executionTrust)}
            </label>
          ))}
        </div>
      )}

      {overflowNotice && (
        <p className="comparison-view__notice" role="status">{overflowNotice}</p>
      )}
      <p className="comparison-view__hint">最多同时对比 {MAX_COMPARISON_CURVES} 条曲线；不同训练轮数不阻止比较，图表按各自实际覆盖范围诚实展示。</p>

      {partialAttempts.length > 0 && (
        <div className="comparison-view__partial" aria-label="未完成 Attempt 诊断性部分曲线">
          <strong>诊断性部分曲线（未完成运行）</strong>
          <small>仅用于故障排查与恢复判断；不进入严格完成组、不参与候选排名、不生成最终性能结论，也不因曲线看起来完整而视为已完成。</small>
          {partialAttempts.map(attempt => {
            const points = extractDiagnosticSeries(attempt);
            const values = points.map(point => point.value);
            const min = values.length ? Math.min(...values) : 0;
            const max = values.length ? Math.max(...values) : 1;
            const span = Math.max(max - min, 1e-9);
            const path = points.map((point, index) => {
              const x = 8 + (index / Math.max(points.length - 1, 1)) * 204;
              const y = 8 + (1 - (point.value - min) / span) * 48;
              return `${x.toFixed(2)},${y.toFixed(2)}`;
            }).join(' ');
            return (
              <div key={attempt.id} className="comparison-view__partial-row">
                <span>
                  {nameOf(attempt)} · Attempt #{attempt.ordinal} · {attemptStatusLabel(attempt.status)}
                  {points.length > 0 && ` · 已有 ${points.length} 个记录点（epoch ${points[0].epoch}～${points[points.length - 1].epoch}）`}
                </span>
                {points.length > 1 && (
                  <svg viewBox="0 0 220 64" role="img" aria-label={`Attempt ${attempt.ordinal} 诊断性部分曲线（非严格）`}>
                    <polyline points={path} fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 3" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
      {eligibleAttempts.length === 0 && partialAttempts.length === 0 && (
        <p className="comparison-view__hint">当前 Study 尚无带指标记录的 Attempt；开始训练后此处会出现可对比证据。</p>
      )}
      {/* ledger 引用保留给分组语义说明（分组键来自权威 comparability 函数）。 */}
      <span className="comparison-view__sr-only">{`严格分组基于 ${ledger.ledgerId.slice(0, 8)} 档案`}</span>
    </div>
  );
}
