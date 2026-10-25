/**
 * 可信实验工作流的公共类型。
 * 工作流导航是现有业务状态的只读投影：本文件只定义投影的输入（事实）
 * 与输出（阶段视图/下一步建议），不承载任何业务规则。
 */
import type { ClaimStatus, ClaimVerdict, StudyKind } from '@/types/experiment';
import type { TrainStatus } from '@/types/training';
import type { RightPanelId } from '@/types/workspace';

/** 固定六个阶段；ID 集中定义，禁止字符串散落。 */
export const WORKFLOW_STAGE_IDS = ['data', 'model', 'train', 'compare', 'claim', 'export'] as const;
export type WorkflowStageId = (typeof WORKFLOW_STAGE_IDS)[number];

/** 有限状态集合（与界面中文标签一一对应，界面不得直接显示枚举）。 */
export type WorkflowStageStatus = 'not_started' | 'ready' | 'in_progress' | 'attention' | 'completed';

export const WORKFLOW_STAGE_NAMES: Record<WorkflowStageId, string> = {
  data: '数据',
  model: '模型',
  train: '训练',
  compare: '对比',
  claim: '主张',
  export: '导出',
};

export const WORKFLOW_STATUS_LABELS: Record<WorkflowStageStatus, string> = {
  not_started: '未开始',
  ready: '可继续',
  in_progress: '进行中',
  attention: '需处理',
  completed: '已完成',
};

/** 每个阶段的导航目标（模块 02 的面板类型，不新建第二套面板状态）。 */
export const WORKFLOW_STAGE_TARGETS: Record<WorkflowStageId, RightPanelId> = {
  data: 'dataset',
  model: 'param',
  train: 'trainMonitor',
  compare: 'study',
  claim: 'study',
  export: 'export',
};

/** 当前活动 Study 的投影摘要（只含判断所需字段）。 */
export interface WorkflowStudyFacts {
  kind: StudyKind;
  /** 候选已由现有业务逻辑（留痕选择）确认。 */
  candidateSelected: boolean;
  attemptCount: number;
  trustedAttemptCount: number;
}

/** 活动 Study 最近一条评估主张的投影摘要。 */
export interface WorkflowClaimFacts {
  status: ClaimStatus;
  /**
   * 裁决三值或 null。注意：持久化数据可能绕过 TS 类型（未知字符串），
   * 投影必须对非正式值 fail closed，不得映射成任何正式裁决。
   */
  verdict: ClaimVerdict | null;
}

/** 投影输入：全部来自现有 store/runtime 的事实摘要，不含组件或 action。
 * 证据作用域规则：当前证据只能来自当前活动 Study 下的实体；
 * 历史存在（其他 Study/无活动 Study）只能用于提示，不得证明当前流程。 */
export interface WorkflowFacts {
  hasDataset: boolean;
  /** 数据集存在但需要处理（如 Excel 不可训练、CSV 目标列未确认）。 */
  datasetAttention: boolean;
  hasLayers: boolean;
  structureValid: boolean;
  trainStatus: TrainStatus;
  /** 当前活动 Study（其下的 attemptCount/trustedAttemptCount 均已按 Study 作用域计算）。 */
  activeStudy: WorkflowStudyFacts | null;
  /** 当前活动 Study 最近一条 Claim（已按 studyId 过滤）。 */
  latestClaim: WorkflowClaimFacts | null;
  /** 审计持久化处于 degraded（只追加链异常）。 */
  auditDegraded: boolean;
  /** 历史存在：不属于当前活动 Study 的可信完成 Attempt（无活动 Study 时为账本内任意此类记录）。
   * 只能用于提示选择/建立课题，不得证明当前训练已完成。 */
  hasHistoricalTrustedAttempt: boolean;
  /** 当前证据：当前活动 Study 存在关联导出记录（事件实体与 Study/Attempt 归属匹配）。
   * 只证明发生过导出，不证明当前版本已重新导出。 */
  currentStudyExportRecorded: boolean;
  /** 历史存在：存在无法归属当前活动 Study 的导出记录。 */
  hasHistoricalExportRecord: boolean;
}

export interface WorkflowStageProjection {
  id: WorkflowStageId;
  name: string;
  status: WorkflowStageStatus;
  /** 由真实状态支持的中文状态说明。 */
  statusLabel: string;
  note?: string;
  target: RightPanelId;
  recommended: boolean;
  /** 可访问名称：阶段名称 + 当前状态。 */
  accessibleName: string;
}

export interface WorkflowNextAction {
  /** 包含当前事实、建议动作与将要打开的区域。 */
  message: string;
  target: RightPanelId;
  buttonLabel: string;
  stageId: WorkflowStageId;
}

export interface WorkflowProjectionResult {
  stages: WorkflowStageProjection[];
  nextAction: WorkflowNextAction;
}
