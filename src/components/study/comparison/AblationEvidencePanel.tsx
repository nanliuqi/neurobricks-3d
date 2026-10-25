/**
 * 配对消融证据（模块 07）：复用既有 pairedAblationEvidence 协议函数，不另造算法。
 * - 展示每一对 seed 的差值与配对数量；
 * - 差值解释带指标方向：maximize 提高为正向，minimize 降低为正向；
 * - 多变量 bundle 只表述为“该改动组合”，不得单独归因某一组件；
 * - 区间只在协议函数已给出时展示，绝不虚构置信区间或 p 值。
 */
import type { PairedAblationEvidence } from '@/utils/studyProtocol';
import { interpretDifference } from '@/utils/comparisonViewModel';
import { metricNameLabel } from '@/components/panels/study/studyLabels';

interface AblationEvidencePanelProps {
  evidence: PairedAblationEvidence[];
  taskType: string;
}

export default function AblationEvidencePanel({ evidence, taskType }: AblationEvidencePanelProps) {
  if (evidence.length === 0) return null;

  return (
    <section className="comparison-view__ablation" aria-label="配对消融证据">
      <strong>配对消融证据（同 seed、同考卷、同预处理、执行可信）</strong>
      {evidence.map(item => {
        // 单变量改动才能使用组件名受限归因；多变量 bundle 只能表述为“该改动组合”。
        const subject = item.diffPaths.length > 1
          ? `改动组合（${item.diffPaths.join('、')}）`
          : item.diffPaths[0] ?? '预注册改动';
        // 方向来自严格证据实际记录的 optimizationDirection，不再按指标名猜测。
        const direction = item.optimizationDirection;
        return (
          <div key={item.experimentId} className="comparison-view__ablation-item">
            <span>
              {item.experimentName} · {subject} · 指标 {item.metricName !== null ? metricNameLabel(item.metricName, taskType) : '指标元数据缺失'} · 配对 {item.pairs.length} 对
            </span>
            {item.pairs.length === 0 || direction === null ? (
              <small>尚无满足配对资格的 seed 交集（严格 validation/epoch 指标 + 同考卷 + 执行可信）；不得生成差异表述。</small>
            ) : (
              <table className="comparison-view__table">
                <thead>
                  <tr>
                    <th scope="col">seed</th>
                    <th scope="col">基线</th>
                    <th scope="col">改动组</th>
                    <th scope="col">差值（改动-基线）</th>
                    <th scope="col">方向解释</th>
                  </tr>
                </thead>
                <tbody>
                  {item.pairs.map(pair => (
                    <tr key={pair.seed}>
                      <td>{pair.seed}</td>
                      <td>{Number.isFinite(pair.baseline) ? pair.baseline.toFixed(6) : '不可用'}</td>
                      <td>{Number.isFinite(pair.candidate) ? pair.candidate.toFixed(6) : '不可用'}</td>
                      <td>{Number.isFinite(pair.difference) ? pair.difference.toFixed(6) : '不可用'}</td>
                      <td>{interpretDifference(direction, pair.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {item.meanDifference !== null && (
              <small>
                平均差值 {item.meanDifference.toFixed(6)}
                {item.interval95
                  ? `；95% 配对 bootstrap 区间 [${item.interval95[0].toFixed(6)}, ${item.interval95[1].toFixed(6)}]（既有协议函数，seed 固定）`
                  : '；配对数不足，未给出区间（不虚构置信区间或 p 值）'}
                {item.pairs.length < 2 && '；n=1：方差证据不足。'}
              </small>
            )}
          </div>
        );
      })}
    </section>
  );
}
