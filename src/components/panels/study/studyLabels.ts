/**
 * Study 总览中文标签映射（模块 06）：
 * - 所有协议枚举一律映射为中文标签 + 状态文字，不向用户直接展示原始枚举；
 * - 未知值统一显示“未知状态”，并按非完成、非可信处理（不升级、不猜测）。
 */
import type {
  AttemptStatus,
  ClaimStatus,
  ClaimVerdict,
  ConclusionTrust,
  ExecutionTrust,
  SplitStrategy,
  StudyKind,
  StudyStatus,
  TrustSource,
} from '@/types/experiment';

export const STUDY_KIND_LABELS: Record<StudyKind, string> = {
  free_exploration: '自由探索',
  candidate_selection: '候选选择',
  controlled_ablation: '对照消融',
};

/** 三种 Study 类型允许的结论语言边界（创建表单展示用途；权威文案仍由 allowedStudyConclusion 生成）。 */
export const STUDY_KIND_EXPLANATIONS: Record<StudyKind, string> = {
  free_exploration: '只能生成描述性观察，不能产生正式排序或因果归因。',
  candidate_selection: '只能说明在候选集合、预算和选择规则下哪个候选被选中。',
  controlled_ablation: '只能在配对 seed 和明确差异协议下说明该改动或改动组合带来的变化。',
};

export function studyKindLabel(value: string | null | undefined): string {
  return (value && value in STUDY_KIND_LABELS ? STUDY_KIND_LABELS[value as StudyKind] : null) ?? '未知类型';
}

export function studyStatusLabel(value: string | null | undefined): string {
  const labels: Record<StudyStatus, string> = { draft: '草稿', active: '进行中', closed: '已关闭' };
  return (value && value in labels ? labels[value as StudyStatus] : null) ?? '未知状态';
}

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  pending: '待启动',
  starting: '启动中',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  interrupted: '已中断',
  failed: '已失败',
  cancelled: '已取消',
};

export function attemptStatusLabel(value: string | null | undefined): string {
  return (value && value in ATTEMPT_STATUS_LABELS ? ATTEMPT_STATUS_LABELS[value as AttemptStatus] : null) ?? '未知状态';
}

/** 未知状态按非完成处理：绝不把不认识的枚举当作 completed。 */
export function isAttemptCompleted(value: string | null | undefined): boolean {
  return value === 'completed';
}

/** 已知枚举判定：未知状态/信任值计入记录异常，失败关闭。 */
export function isKnownAttemptStatus(value: string | null | undefined): boolean {
  return typeof value === 'string' && value in ATTEMPT_STATUS_LABELS;
}

export function isKnownExecutionTrust(value: string | null | undefined): boolean {
  return value === 'trusted' || value === 'interrupted' || value === 'unverified';
}

export function splitStrategyLabel(value: string | null | undefined): string {
  const labels: Record<SplitStrategy, string> = {
    random: '固定 seed 随机',
    group: '按分组隔离',
    temporal: '按时间先后',
    predefined: '官方预定义',
  };
  // 未知切分策略不得直接渲染原始字符串。
  return (value && value in labels ? labels[value as SplitStrategy] : null) ?? '未知切分策略';
}

/** 裁决结果标签：与信任等级正交；未知 verdict 不得伪装成 INCONCLUSIVE。 */
export function verdictLabel(value: unknown): string | null {
  if (value === 'pass') return 'PASS';
  if (value === 'fail') return 'FAIL';
  if (value === 'inconclusive') return 'INCONCLUSIVE';
  return null;
}

/** 运行态（预算计时与归档阻断共用同一组状态）。 */
export function isAttemptActive(value: string | null | undefined): boolean {
  return value === 'starting' || value === 'running' || value === 'paused';
}

export function executionTrustLabel(value: string | null | undefined): string {
  const labels: Record<ExecutionTrust, string> = {
    trusted: '执行可信',
    interrupted: '执行中断',
    unverified: '未验证',
  };
  return (value && value in labels ? labels[value as ExecutionTrust] : null) ?? '未知状态';
}

export function isExecutionTrusted(value: string | null | undefined): boolean {
  return value === 'trusted';
}

export function trustSourceLabel(value: string | null | undefined): string {
  const labels: Record<TrustSource, string> = {
    controlled: '受控运行',
    external: '外部导入',
    legacy: '历史档案',
  };
  return (value && value in labels ? labels[value as TrustSource] : null) ?? '未知状态';
}

export function conclusionTrustLabel(value: string | null | undefined): string {
  const labels: Record<ConclusionTrust, string> = {
    not_evaluated: '未评估',
    exploratory: '探索性',
    iid_only: '仅 IID 区间',
    gold: '金标区间',
  };
  return (value && value in labels ? labels[value as ConclusionTrust] : null) ?? '未知状态';
}

export function claimStatusLabel(value: string | null | undefined): string {
  const labels: Record<ClaimStatus, string> = {
    draft: '草稿',
    frozen: '已冻结',
    adjudicated: '已裁决',
    post_hoc: '事后补录',
  };
  return (value && value in labels ? labels[value as ClaimStatus] : null) ?? '未知状态';
}

/**
 * 持久化数据验证守卫的单一来源在协议层（claimProtocol）；
 * 此处重导出保持既有调用方兼容，标签层不再自持白名单。
 */
export { isKnownClaimStatus, isKnownConclusionTrust } from '@/utils/claimProtocol';

/** 指标标签必须来自真实 metricName；未知指标不得冒充 Accuracy。 */
const METRIC_NAME_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  recall: 'Recall',
  precision: 'Precision',
  false_positive_rate: 'FPR',
  macro_f1: 'Macro-F1',
  mae: 'MAE',
  rmse: 'RMSE',
  r2: 'R²',
};

export function metricNameLabel(metricName: string | undefined, taskType?: string): string {
  if (metricName && metricName in METRIC_NAME_LABELS) return METRIC_NAME_LABELS[metricName];
  if (taskType === 'tabular_regression') return '回归指标';
  if (taskType === 'image_classification') return '分类指标';
  return '指标';
}

export function auditPersistenceLabel(value: string | null | undefined): string {
  if (value === 'healthy') return '健康';
  if (value === 'degraded') return '降级';
  if (value === 'unavailable') return '待桌面端写入';
  return '无法验证';
}

export type { ClaimVerdict };
