import type { Attempt, AttemptStatus, ExperimentLedgerV1, Study } from '@/types/experiment';
import type { TrainConfig } from '@/types/training';
import { stableProtocolJson } from '@/utils/experimentProtocol';
import { seededBootstrapInterval } from '@/utils/statistics';
import { finalStrictMetric, strictMetricDescriptor, type MetricDirection, type StrictMetricDescriptor } from '@/utils/metricSeries';

/**
 * Study 已消耗 GPU 分钟数的唯一计算来源（模块 06）：
 * experimentRuntime 预算阻断与 Study 面板展示必须共用此函数，不得各自实现。
 * 语义：未开始的 Attempt 不计；运行态（starting/running/paused）以 now 计时；
 * 终止态缺 endedAt 时保守计 0（不以当前时间膨胀历史耗时）。
 */
export function studyUsedGpuMinutes(
  attempts: ReadonlyArray<{ startedAt: number | null; endedAt: number | null; status: AttemptStatus | string }>,
  now: number,
): number {
  return attempts
    .filter(item => item.startedAt !== null)
    .reduce((sum, item) => {
      const startedAt = item.startedAt as number;
      const end = item.endedAt ?? (['starting', 'running', 'paused'].includes(item.status) ? now : startedAt);
      return sum + Math.max(0, end - startedAt) / 60_000;
    }, 0);
}

const DIFF_IGNORED_KEYS = new Set([
  'runId', 'attemptId', 'parentAttemptId', 'restartCount', 'resumeType',
  'studyId', 'experimentId', 'modelId', 'configHash', 'datasetContentHash',
  'splitHash', 'preprocessingHash',
]);

function diffValues(left: unknown, right: unknown, path: string, result: string[]): void {
  if (typeof left === 'undefined' || typeof right === 'undefined') {
    if (left !== right) result.push(path || '$');
    return;
  }
  if (stableProtocolJson(left) === stableProtocolJson(right)) return;
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      diffValues(left[index], right[index], `${path}[${index}]`, result);
    }
    return;
  }
  if (
    left !== null && right !== null
    && typeof left === 'object' && typeof right === 'object'
    && !Array.isArray(left) && !Array.isArray(right)
  ) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].sort()) {
      if (DIFF_IGNORED_KEYS.has(key)) continue;
      diffValues(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        result,
      );
    }
    return;
  }
  result.push(path || '$');
}

export function diffTrainingConfigs(baseline: TrainConfig, candidate: TrainConfig): string[] {
  const result: string[] = [];
  diffValues(baseline, candidate, '', result);
  return result;
}

export function allowedStudyConclusion(study: Study, experimentName?: string, diffPaths: string[] = []): string {
  // 显式 switch：未知 Study kind 失败关闭，不得用默认分支冒充对照消融。
  switch (study.kind) {
    case 'free_exploration':
      return `描述性观察：在“${study.name}”中观察到候选方向的指标变化；不得据此生成排序或机制归因。`;
    case 'candidate_selection':
      return `候选选择：在既定候选集与预算下，${experimentName ?? '尚未指定方案'}由人工选定；声明规则为“${study.selectionRule ?? '手动选择'}”，选择行为已留痕但系统未自动验证规则执行，不得解释为组件因果。`;
    case 'controlled_ablation': {
      const subject = diffPaths.length > 1 ? `改动组合（${diffPaths.join('、')}）` : diffPaths[0] ?? '预注册改动';
      return `对照消融：${subject}在本 Study 协议下带来观察到的变化；不得推广为普适机制。`;
    }
    default:
      return '课题类型无法识别，不能生成结论语言。';
  }
}

export interface AblationPair {
  seed: number;
  baselineAttemptId: string;
  candidateAttemptId: string;
  metricName: string;
  optimizationDirection: MetricDirection;
  baseline: number;
  candidate: number;
  /** 差值恒为候选减基线；优劣解释必须结合 optimizationDirection。 */
  difference: number;
}

export interface PairedAblationEvidence {
  experimentId: string;
  experimentName: string;
  diffPaths: string[];
  /** 严格指标语义来自实际记录；无合法配对时为 null，绝不猜测 accuracy。 */
  metricName: string | null;
  optimizationDirection: MetricDirection | null;
  pairs: AblationPair[];
  meanDifference: number | null;
  interval95: [number, number] | null;
}

/**
 * 同一 Experiment、同一 seed 存在多个 Attempt 时的稳定选择规则：
 * 优先 ordinal 最大 → 再 endedAt 更晚 → 最后按 id 字典序（确定且可复现）。
 */
function pickStableAttempt(candidates: Attempt[]): Attempt | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => (
    right.ordinal - left.ordinal
    || (right.endedAt ?? 0) - (left.endedAt ?? 0)
    || left.id.localeCompare(right.id)
  ))[0];
}

/**
 * 消融证据只配对同 seed、同考卷、同预处理且执行可信的最终验证指标（模块 07 验收补丁）：
 * - 只使用 completed + trusted Attempt；
 * - 只使用严格 validation/epoch 指标（strictMetricDescriptor + finalStrictMetric），
 *   不得用 metrics 数组最后一项冒充最终验证指标，不得猜测 accuracy；
 * - metricName 与 optimizationDirection 必须明确且配对双方一致，数值必须有限；
 * - 同 seed 多 Attempt 用稳定规则选唯一；
 * - 报告与 UI 必须消费同一投影。
 */
export function pairedAblationEvidence(ledger: ExperimentLedgerV1, studyId: string): PairedAblationEvidence[] {
  const study = ledger.studies.find(item => item.id === studyId);
  if (!study || study.kind !== 'controlled_ablation') return [];
  const experiments = ledger.experiments.filter(item => item.studyId === studyId);
  const baseline = experiments[0];
  if (!baseline) return [];
  const eligible = ledger.attempts.filter(attempt => (
    attempt.status === 'completed'
    && attempt.provenance.executionTrust === 'trusted'
    && Number.isInteger(attempt.config.seed)
  ));

  // 每个 Attempt 的严格最终指标（不可用则不参与配对）。
  const strictFinal = new Map<string, { descriptor: StrictMetricDescriptor; value: number }>();
  for (const attempt of eligible) {
    const descriptor = strictMetricDescriptor(attempt);
    if (!descriptor.available) continue;
    const final = finalStrictMetric(attempt, descriptor.descriptor.metricName);
    if (!final || !Number.isFinite(final.value)) continue;
    strictFinal.set(attempt.id, { descriptor: descriptor.descriptor, value: final.value });
  }

  const baselineBySeed = new Map<number, Attempt>();
  for (const attempt of eligible.filter(item => item.experimentId === baseline.id)) {
    const seed = attempt.config.seed as number;
    const current = baselineBySeed.get(seed);
    const winner = pickStableAttempt(current ? [current, attempt] : [attempt]);
    if (winner) baselineBySeed.set(seed, winner);
  }

  return experiments.slice(1).map(experiment => {
    const candidateBySeed = new Map<number, Attempt>();
    for (const attempt of eligible.filter(item => item.experimentId === experiment.id)) {
      const seed = attempt.config.seed as number;
      const current = candidateBySeed.get(seed);
      const winner = pickStableAttempt(current ? [current, attempt] : [attempt]);
      if (winner) candidateBySeed.set(seed, winner);
    }

    const pairs: AblationPair[] = [];
    let metricName: string | null = null;
    let optimizationDirection: MetricDirection | null = null;
    for (const [seed, candidate] of [...candidateBySeed.entries()].sort((left, right) => left[0] - right[0])) {
      const base = baselineBySeed.get(seed);
      if (!base) continue;
      if (
        base.provenance.datasetContentHash !== candidate.provenance.datasetContentHash
        || base.provenance.splitHash !== candidate.provenance.splitHash
        || base.provenance.preprocessingHash !== candidate.provenance.preprocessingHash
      ) continue;
      const baseFinal = strictFinal.get(base.id);
      const candidateFinal = strictFinal.get(candidate.id);
      if (!baseFinal || !candidateFinal) continue;
      const baseDescriptor = baseFinal.descriptor;
      const candidateDescriptor = candidateFinal.descriptor;
      if (
        baseDescriptor.metricName !== candidateDescriptor.metricName
        || baseDescriptor.optimizationDirection !== candidateDescriptor.optimizationDirection
      ) continue;
      // 同一证据条目内指标口径必须唯一；后续 seed 出现不同口径时不得混入。
      if (metricName === null) {
        metricName = baseDescriptor.metricName;
        optimizationDirection = baseDescriptor.optimizationDirection;
      } else if (metricName !== baseDescriptor.metricName || optimizationDirection !== baseDescriptor.optimizationDirection) {
        continue;
      }
      pairs.push({
        seed,
        baselineAttemptId: base.id,
        candidateAttemptId: candidate.id,
        metricName: baseDescriptor.metricName,
        optimizationDirection: baseDescriptor.optimizationDirection,
        baseline: baseFinal.value,
        candidate: candidateFinal.value,
        difference: candidateFinal.value - baseFinal.value,
      });
    }
    const differences = pairs.map(pair => pair.difference);
    const meanDifference = differences.length
      ? differences.reduce((sum, value) => sum + value, 0) / differences.length
      : null;
    const interval95 = differences.length >= 2
      ? seededBootstrapInterval(differences, sample => sample.reduce((sum, value) => sum + value, 0) / sample.length, 0.95, 2000, 42)
      : null;
    return {
      experimentId: experiment.id,
      experimentName: experiment.name,
      diffPaths: experiment.differenceFromBaseline ?? [],
      metricName,
      optimizationDirection,
      pairs,
      meanDifference,
      interval95,
    };
  });
}
