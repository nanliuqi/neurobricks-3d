/**
 * 数据与划分契约摘要（模块 06）：只展示 Study 快照中真实保存的内容。
 * - 缺失字段显示“未记录/未声明/无法验证”，不猜测；未知切分策略不渲染原始字符串；
 * - 哈希默认截断，完整值只通过 Tooltip 提供；
 * - 严格可比资格保守判定（不仅看 comparisonKey）；严格可比与金标是两个概念；
 * - 泄漏检查失败单独醒目显示，不被资格文案掩盖；
 * - 不重新计算或修改数据集指纹。
 */
import Alert from '@/components/ui/Alert';
import Tooltip from '@/components/ui/Tooltip';
import type { Study } from '@/types/experiment';
import { buildContractRows, strictlyComparable } from './studyOverviewViewModel';

interface StudyContractSummaryProps {
  study: Study;
}

export default function StudyContractSummary({ study }: StudyContractSummaryProps) {
  const rows = buildContractRows(study);
  const comparable = strictlyComparable(study);
  const leakageFailed = study.datasetContract.split.machineChecks.some(check => check.status === 'failed');

  return (
    <section className="study-wb-section" aria-label="数据与划分契约">
      <h4 className="study-wb-section__title">数据与划分契约（创建时快照）</h4>
      <dl className="study-wb-contract">
        {rows.map(row => (
          <div key={row.label} className="study-wb-contract__row">
            <dt>{row.label}</dt>
            <dd>
              {row.fullValue ? (
                <Tooltip content={`完整值：${row.fullValue}`}>
                  <code className="study-wb-hash">{row.value}</code>
                </Tooltip>
              ) : row.value}
            </dd>
          </div>
        ))}
        <div className="study-wb-contract__row">
          <dt>严格可比资格</dt>
          <dd>
            {comparable
              ? '具备（身份、切分与预处理哈希齐全）'
              : '无法验证（必要字段缺失，不代表同一数据身份）'}
          </dd>
        </div>
      </dl>
      {/* 泄漏检查失败单独醒目显示，不被“具备资格”掩盖；与金标资格无关 */}
      {leakageFailed && (
        <Alert tone="warning" title="泄漏检查存在未通过项">
          该 Study 的切分快照记录了未通过的泄漏检查；即使具备严格可比资格，也应先处理泄漏风险再采信结论。
        </Alert>
      )}
    </section>
  );
}
