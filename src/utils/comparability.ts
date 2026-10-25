import type {
  Attempt,
  ComparisonRelation,
  ExperimentLedgerV1,
} from '@/types/experiment';
import { localGroupingKey } from '@/utils/experimentProtocol';
import { strictMetricDescriptor, type StrictMetricDescriptor } from '@/utils/metricSeries';

export interface ComparisonAssessment {
  relation: ComparisonRelation;
  reasons: string[];
  watermark: '非严格可比' | null;
}

/** 协议规定的非严格对比水印：界面、事件、报告与导出必须使用同一文案。 */
export const COMPARISON_WATERMARK = '非严格可比' as const;

export interface SplitAssignment {
  sampleId: string;
  contentHash: string;
  split: 'train' | 'validation' | 'test';
}

function attemptContext(ledger: ExperimentLedgerV1, attemptId: string) {
  const attempt = ledger.attempts.find(item => item.id === attemptId);
  if (!attempt) return null;
  const experiment = ledger.experiments.find(item => item.id === attempt.experimentId);
  if (!experiment) return null;
  const study = ledger.studies.find(item => item.id === experiment.studyId);
  if (!study) return null;
  return { attempt, experiment, study };
}

function missingMetadata(attempt: Attempt): string[] {
  const missing: string[] = [];
  if (!attempt.provenance.datasetContentHash) missing.push('数据集内容指纹');
  if (!attempt.provenance.splitHash) missing.push('切分指纹');
  if (!attempt.provenance.preprocessingHash) missing.push('预处理指纹');
  if (!attempt.provenance.configHash) missing.push('配置指纹');
  return missing;
}

/**
 * 指标语义单一来源（模块 07 验收补丁）：strictMetricDescriptor。
 * - 没有指标记录、仅有 train/batch、缺 metricName、多义、方向缺失/不一致 → null（失败关闭）；
 * - assessStrictComparability 与 strictComparisonGroupKey 必须消费同一来源，
 *   不允许一个函数判 strict、另一个函数判不可用。
 */
function metricSemantics(attempt: Attempt): StrictMetricDescriptor | null {
  const result = strictMetricDescriptor(attempt);
  return result.available ? result.descriptor : null;
}

/**
 * 严格资格的共享投影（最终证据闭环补丁）：
 * strictComparisonGroupKey 与 assessStrictComparability 必须复用同一资格判定，
 * 避免两处各自拼装条件再次漂移。
 * 资格：completed + trusted + 关键元数据齐全 + 严格指标描述符可用（含有限值）。
 */
interface StrictEligibilityFacts {
  notCompleted: boolean;
  notTrusted: boolean;
  missing: string[];
  metricFailureReason: string | null;
}

function strictEligibilityFacts(attempt: Attempt): StrictEligibilityFacts {
  const descriptor = strictMetricDescriptor(attempt);
  return {
    notCompleted: attempt.status !== 'completed',
    notTrusted: attempt.provenance.executionTrust !== 'trusted',
    missing: missingMetadata(attempt),
    metricFailureReason: descriptor.available ? null : descriptor.reason,
  };
}

function hasStrictEligibility(facts: StrictEligibilityFacts): boolean {
  return !facts.notCompleted && !facts.notTrusted && facts.missing.length === 0 && facts.metricFailureReason === null;
}

/** 默认对比组只收受控完成且关键元数据齐全的 Attempt；缺失字段绝不猜测。 */
export function strictComparisonGroupKey(
  ledger: ExperimentLedgerV1,
  attemptId: string,
): string | null {
  const context = attemptContext(ledger, attemptId);
  if (!context) return null;
  const facts = strictEligibilityFacts(context.attempt);
  // 任一资格失败（含全非有限指标）都不得形成严格组键。
  if (!hasStrictEligibility(facts)) return null;
  const semantics = metricSemantics(context.attempt);
  if (semantics === null) return null;
  return localGroupingKey({
    taskType: context.study.datasetContract.identity.taskType,
    datasetContentHash: context.attempt.provenance.datasetContentHash,
    splitHash: context.attempt.provenance.splitHash,
    preprocessingHash: context.attempt.provenance.preprocessingHash,
    // 严格可比键必须覆盖完整指标口径：同名不同方向不得同组。
    metricName: semantics.metricName,
    optimizationDirection: semantics.optimizationDirection,
    split: semantics.split,
    scope: semantics.scope,
  });
}

export function groupStrictComparableAttempts(
  ledger: ExperimentLedgerV1,
  attemptIds: string[],
): Array<{ key: string | null; attemptIds: string[] }> {
  const groups = new Map<string, { key: string | null; attemptIds: string[] }>();
  for (const attemptId of attemptIds) {
    const key = strictComparisonGroupKey(ledger, attemptId);
    // 不合格结果必须各自孤立，不能因为 key 都是 null 而被误组成默认对比组。
    const bucketKey = key ?? `ineligible:${attemptId}`;
    const group = groups.get(bucketKey) ?? { key, attemptIds: [] };
    group.attemptIds.push(attemptId);
    groups.set(bucketKey, group);
  }
  return [...groups.values()];
}

export function environmentDifferences(left: Attempt, right: Attempt): string[] {
  const differences: string[] = [];
  const fields: Array<[keyof Attempt['provenance']['environment'], string]> = [
    ['torchVersion', 'torch 版本'], ['pythonVersion', 'Python 版本'], ['device', 'device'], ['cudaVersion', 'CUDA 版本'],
  ];
  for (const [field, label] of fields) {
    if (left.provenance.environment[field] !== right.provenance.environment[field]) differences.push(label);
  }
  return differences;
}

export function assessStrictComparability(
  ledger: ExperimentLedgerV1,
  leftAttemptId: string,
  rightAttemptId: string,
): ComparisonAssessment {
  const left = attemptContext(ledger, leftAttemptId);
  const right = attemptContext(ledger, rightAttemptId);
  if (!left || !right) {
    return { relation: 'incomparable', reasons: ['实验引用不完整'], watermark: null };
  }

  const leftMissing = missingMetadata(left.attempt);
  const rightMissing = missingMetadata(right.attempt);
  if (leftMissing.length || rightMissing.length) {
    return {
      relation: 'incomparable',
      reasons: [`元数据缺失：${[...new Set([...leftMissing, ...rightMissing])].join('、')}`],
      watermark: null,
    };
  }

  // 与 groupKey 复用同一资格投影：paused/interrupted/cancelled/failed 即便 trusted、
  // 哈希齐全也不得返回 strict。
  const leftFacts = strictEligibilityFacts(left.attempt);
  const rightFacts = strictEligibilityFacts(right.attempt);

  const reasons: string[] = [];
  if (leftFacts.notCompleted || rightFacts.notCompleted) {
    reasons.push('至少一个结果不是已完成运行（暂停/中断/取消/失败不进入严格完成组）');
  }
  if (left.study.datasetContract.identity.taskType !== right.study.datasetContract.identity.taskType) {
    reasons.push('任务定义不同');
  }
  if (left.attempt.provenance.datasetContentHash !== right.attempt.provenance.datasetContentHash) {
    reasons.push('数据集内容不同');
  }
  if (left.attempt.provenance.splitHash !== right.attempt.provenance.splitHash) {
    reasons.push('验证/测试集切分不同');
  }
  if (left.attempt.provenance.preprocessingHash !== right.attempt.provenance.preprocessingHash) {
    reasons.push('预处理不同');
  }
  if (leftFacts.notTrusted || rightFacts.notTrusted) {
    reasons.push('至少一个结果不是受控管线可信执行');
  }
  if (leftFacts.metricFailureReason !== null || rightFacts.metricFailureReason !== null) {
    const detail = [
      leftFacts.metricFailureReason ?? '',
      rightFacts.metricFailureReason !== leftFacts.metricFailureReason ? rightFacts.metricFailureReason ?? '' : '',
    ].filter(Boolean).join('；');
    reasons.push(`指标元数据不完整（${detail}）`);
  } else {
    const leftSemantics = metricSemantics(left.attempt);
    const rightSemantics = metricSemantics(right.attempt);
    if (leftSemantics && rightSemantics) {
      if (leftSemantics.metricName !== rightSemantics.metricName) {
        reasons.push('指标语义不同');
      } else if (leftSemantics.optimizationDirection !== rightSemantics.optimizationDirection) {
        reasons.push('优化方向不同');
      }
    }
  }

  return reasons.length
    ? { relation: 'incomparable', reasons, watermark: null }
    : { relation: 'strict', reasons: [], watermark: null };
}

export function forceComparison(assessment: ComparisonAssessment): ComparisonAssessment {
  if (assessment.relation === 'strict') return assessment;
  return {
    relation: 'override',
    reasons: assessment.reasons,
    watermark: COMPARISON_WATERMARK,
  };
}

/** 字节级重复只是绊线；返回跨集合冲突，近重复与业务实体泄漏仍由样本单位契约负责。 */
export function findCrossSplitExactDuplicates(assignments: SplitAssignment[]): Array<{
  contentHash: string;
  sampleIds: string[];
  splits: Array<SplitAssignment['split']>;
}> {
  const byHash = new Map<string, SplitAssignment[]>();
  for (const assignment of assignments) {
    const bucket = byHash.get(assignment.contentHash) ?? [];
    bucket.push(assignment);
    byHash.set(assignment.contentHash, bucket);
  }
  return [...byHash.entries()].flatMap(([contentHash, items]) => {
    const splits = [...new Set(items.map(item => item.split))];
    if (splits.length < 2) return [];
    return [{
      contentHash,
      sampleIds: items.map(item => item.sampleId).sort(),
      splits: splits.sort(),
    }];
  });
}
