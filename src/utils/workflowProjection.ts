/**
 * 工作流投影：纯函数。无 React、无 DOM、无副作用、不读写存储。
 * 输入为现有业务状态的事实摘要（WorkflowFacts），输出六个阶段的视图与下一步建议。
 *
 * 保守原则（不得违反）：
 * - 证据作用域：当前训练完成/导出记录只能由当前活动 Study 下的实体证明；
 *   历史存在（其他 Study / 无活动 Study）只用于提示，不冒充当前证据；
 * - 训练完成 ≠ 形成可信结论；已有候选 ≠ 已独立验证；冻结 ≠ 已裁决；
 * - 仅 PASS/FAIL/INCONCLUSIVE 三个正式值表示裁决已完成；
 *   verdict 为 null 或未知值时必须 fail closed，不得伪装成任何正式裁决；
 * - 状态未知时显示“未开始/需处理”，绝不伪造“已完成”。
 */
import {
  WORKFLOW_STAGE_IDS,
  WORKFLOW_STAGE_NAMES,
  WORKFLOW_STAGE_TARGETS,
  WORKFLOW_STATUS_LABELS,
  type WorkflowClaimFacts,
  type WorkflowFacts,
  type WorkflowNextAction,
  type WorkflowProjectionResult,
  type WorkflowStageId,
  type WorkflowStageProjection,
  type WorkflowStageStatus,
} from '@/types/workflow';
import type { ClaimVerdict } from '@/types/experiment';
import { isAuthoritativeVerdict } from '@/utils/claimProtocol';

/**
 * 正式 verdict 守卫的单一来源在协议层（claimProtocol）；
 * 此处重导出保持既有调用方兼容，不再维护第二套白名单。
 */
export { isAuthoritativeVerdict };
export type { ClaimVerdict };

/** 当前活动 Study 是否存在可信完成 Attempt（当前证据，非全局）。 */
function currentStudyHasTrustedAttempt(facts: WorkflowFacts): boolean {
  return facts.activeStudy !== null && facts.activeStudy.trustedAttemptCount > 0;
}

function stage(
  id: WorkflowStageId,
  status: WorkflowStageStatus,
  statusLabel: string,
  note?: string,
): WorkflowStageProjection {
  const name = WORKFLOW_STAGE_NAMES[id];
  return {
    id,
    name,
    status,
    statusLabel,
    note,
    target: WORKFLOW_STAGE_TARGETS[id],
    recommended: false,
    accessibleName: `${name}，${statusLabel}`,
  };
}

function projectDataStage(facts: WorkflowFacts): WorkflowStageProjection {
  if (!facts.hasDataset) return stage('data', 'not_started', '未开始');
  if (facts.datasetAttention) {
    return stage('data', 'attention', '数据需要处理', '请进入数据集面板查看。');
  }
  return stage('data', 'completed', '数据已载入');
}

function projectModelStage(facts: WorkflowFacts): WorkflowStageProjection {
  if (!facts.hasLayers) return stage('model', 'not_started', '未开始');
  if (!facts.structureValid) {
    return stage('model', 'attention', '结构需要处理', '请进入参数面板查看。');
  }
  return stage('model', 'completed', '结构校验通过');
}

function projectTrainStage(facts: WorkflowFacts): WorkflowStageProjection {
  const { trainStatus } = facts;
  if (trainStatus === 'starting' || trainStatus === 'training') return stage('train', 'in_progress', '训练进行中');
  if (trainStatus === 'paused') return stage('train', 'in_progress', '训练已暂停');
  if (trainStatus === 'stopping') return stage('train', 'in_progress', '正在停止');
  if (trainStatus === 'error' || trainStatus === 'crashed') {
    return stage('train', 'attention', '训练失败', '请前往训练监控查看原因。');
  }
  // “已有完成运行”只能由当前活动 Study 下的可信 Attempt 证明；
  // 其他 Study 的历史可信运行不得归属到当前训练阶段。
  if (currentStudyHasTrustedAttempt(facts)) return stage('train', 'completed', '已有完成运行');
  if (trainStatus === 'cancelled') {
    return stage('train', 'ready', '可开始训练', '上一次运行已取消，不计为完成。');
  }
  if (trainStatus === 'done') {
    // 进程报告完成但结果未被采信（如浏览器模拟运行）不得显示完成。
    return stage('train', 'ready', '可开始训练', '已有运行未被采信为可信完成。');
  }
  if (facts.hasDataset && !facts.datasetAttention && facts.hasLayers && facts.structureValid) {
    // 无活动 Study 但存在历史可信运行：如实提示，但不声称当前流程已完成。
    if (!facts.activeStudy && facts.hasHistoricalTrustedAttempt) {
      return stage('train', 'ready', '可开始训练', '存在历史可信运行，尚未归属当前课题。');
    }
    return stage('train', 'ready', '可开始训练');
  }
  return stage('train', 'not_started', '未开始');
}

function projectCompareStage(facts: WorkflowFacts): WorkflowStageProjection {
  const study = facts.activeStudy;
  if (!study) {
    // 历史可信运行只能提示“可选择或建立课题”，不得暗示为当前数据/模型的结果。
    return facts.hasHistoricalTrustedAttempt
      ? stage('compare', 'ready', '存在历史运行，可选择或建立课题')
      : stage('compare', 'not_started', '尚未建立课题');
  }
  if (study.kind === 'free_exploration') {
    // 自由探索不产生候选结论；只报告记录存在，不生成排序或因果语言。
    if (study.attemptCount > 0) {
      return stage('compare', 'in_progress', '已有探索记录', '仅描述性观察，不构成候选结论。');
    }
    return stage('compare', 'ready', '可运行探索');
  }
  if (study.candidateSelected) return stage('compare', 'completed', '候选已确定');
  if (study.kind === 'candidate_selection') {
    if (study.trustedAttemptCount > 0) return stage('compare', 'ready', '可进行候选比较');
    if (study.attemptCount > 0) return stage('compare', 'in_progress', '等待可信运行');
    return stage('compare', 'ready', '可运行候选方案');
  }
  // 对照消融：配对证据的统计核验属于课题面板；导航条不宣称配对完成或改动有效。
  if (study.attemptCount > 0) return stage('compare', 'in_progress', '配对核验请查看课题面板');
  return stage('compare', 'ready', '可运行配对实验');
}

/** 已裁决 Claim 的显式穷举：仅三个正式值算裁决完成；
 * null（记录不完整）与未知值（持久化异常）均 fail closed 为 attention。 */
function projectAdjudicatedClaim(claim: WorkflowClaimFacts): WorkflowStageProjection {
  switch (claim.verdict) {
    case 'pass':
      return stage('claim', 'completed', '裁决已完成（PASS）');
    case 'fail':
      return stage('claim', 'completed', '裁决已完成（FAIL）');
    case 'inconclusive':
      return stage('claim', 'completed', '裁决已完成（INCONCLUSIVE：证据不足）');
    case null:
      return stage('claim', 'attention', '裁决记录不完整', '请进入课题面板检查。');
    default:
      // 持久化数据可能绕过 TS 类型（未知 verdict 字符串）：按记录异常处理，
      // 绝不默认为 INCONCLUSIVE 或其他正式裁决。
      return stage('claim', 'attention', '裁决记录异常', '请进入课题面板检查。');
  }
}

function projectClaimStage(facts: WorkflowFacts): WorkflowStageProjection {
  if (facts.auditDegraded) {
    return stage('claim', 'attention', '审计异常', '请先进入课题面板查看并处理。');
  }
  if (!facts.activeStudy) return stage('claim', 'not_started', '未开始');
  const claim = facts.latestClaim;
  if (!claim) {
    return facts.activeStudy.candidateSelected
      ? stage('claim', 'ready', '可创建评估主张')
      : stage('claim', 'not_started', '未开始');
  }
  if (claim.status === 'draft') return stage('claim', 'in_progress', '主张草稿进行中');
  if (claim.status === 'post_hoc') {
    return stage('claim', 'attention', '事后主张', '不具备独立验证资格。');
  }
  if (claim.status === 'frozen') return stage('claim', 'in_progress', '已冻结，待裁决');
  return projectAdjudicatedClaim(claim);
}

function projectExportStage(facts: WorkflowFacts): WorkflowStageProjection {
  // 只有归属当前活动 Study 的导出完成事件才算；“已有导出记录”只证明发生过导出，
  // 不证明当前版本已重新导出（当前协议无快照身份可证）。
  if (facts.currentStudyExportRecorded) return stage('export', 'completed', '已有导出记录');
  const claimReady = facts.latestClaim?.status === 'adjudicated'
    && isAuthoritativeVerdict(facts.latestClaim.verdict);
  if (currentStudyHasTrustedAttempt(facts) || claimReady) {
    return stage('export', 'ready', '可导出');
  }
  if (facts.hasHistoricalExportRecord) {
    return stage('export', 'not_started', '未开始', '存在历史导出记录，与当前课题无关。');
  }
  return stage('export', 'not_started', '未开始', '完成可信训练后可整理交付物。');
}

/** 下一步建议：按优先级取第一条成立的事实分支；按钮只导航、不执行业务动作。 */
function projectNextAction(facts: WorkflowFacts): WorkflowNextAction {
  if (facts.auditDegraded) {
    return {
      message: '检测到审计链异常。建议进入课题面板查看审计状态。',
      target: 'study',
      buttonLabel: '前往课题面板',
      stageId: 'claim',
    };
  }
  if (!facts.hasDataset) {
    return {
      message: '尚未导入数据集。建议在数据集面板导入或选择数据。',
      target: 'dataset',
      buttonLabel: '前往数据集面板',
      stageId: 'data',
    };
  }
  if (facts.datasetAttention) {
    return {
      message: '数据需要处理。建议进入数据集面板查看。',
      target: 'dataset',
      buttonLabel: '前往数据集面板',
      stageId: 'data',
    };
  }
  if (!facts.hasLayers) {
    return {
      message: '尚未搭建模型。请在 3D 场景添加网络层，并可在参数面板查看层参数。',
      target: 'param',
      buttonLabel: '前往参数面板',
      stageId: 'model',
    };
  }
  if (!facts.structureValid) {
    return {
      message: '模型结构校验未通过。建议进入参数面板检查错误。',
      target: 'param',
      buttonLabel: '前往参数面板',
      stageId: 'model',
    };
  }
  if (facts.trainStatus === 'starting' || facts.trainStatus === 'training' || facts.trainStatus === 'stopping') {
    return {
      message: '训练正在进行。建议前往训练监控查看进度。',
      target: 'trainMonitor',
      buttonLabel: '前往训练监控',
      stageId: 'train',
    };
  }
  if (facts.trainStatus === 'paused') {
    return {
      message: '训练已暂停。建议前往训练监控查看并决定是否继续。',
      target: 'trainMonitor',
      buttonLabel: '前往训练监控',
      stageId: 'train',
    };
  }
  if (facts.trainStatus === 'error' || facts.trainStatus === 'crashed') {
    return {
      message: '训练运行失败。建议前往训练监控查看原因。',
      target: 'trainMonitor',
      buttonLabel: '前往训练监控',
      stageId: 'train',
    };
  }
  const study = facts.activeStudy;
  const claim = facts.latestClaim;
  // 已裁决但裁决值不完整/未知：记录异常优先于导出建议，不得推荐导出。
  if (claim?.status === 'adjudicated' && !isAuthoritativeVerdict(claim.verdict)) {
    return {
      message: '裁决记录不完整。建议进入课题面板检查。',
      target: 'study',
      buttonLabel: '前往课题面板',
      stageId: 'claim',
    };
  }
  if (claim?.status === 'adjudicated' && !facts.currentStudyExportRecorded) {
    return {
      message: '裁决已完成。建议前往导出面板整理交付物。',
      target: 'export',
      buttonLabel: '前往导出面板',
      stageId: 'export',
    };
  }
  if (claim?.status === 'frozen') {
    return {
      message: '主张已冻结、待裁决。建议进入课题面板查看下一步。',
      target: 'study',
      buttonLabel: '前往课题面板',
      stageId: 'claim',
    };
  }
  if (claim?.status === 'draft') {
    return {
      message: '评估主张草稿进行中。建议进入课题面板继续完善主张。',
      target: 'study',
      buttonLabel: '前往课题面板',
      stageId: 'claim',
    };
  }
  if (claim?.status === 'post_hoc') {
    return {
      message: '存在事后主张，不具备独立验证资格。建议进入课题面板查看。',
      target: 'study',
      buttonLabel: '前往课题面板',
      stageId: 'claim',
    };
  }
  if (!study) {
    // 无活动 Study：历史可信运行/导出记录只能引导选择或建立课题，
    // 不得冒充当前数据/模型的完成证据，也不得直接推荐导出。
    if (facts.hasHistoricalTrustedAttempt || facts.hasHistoricalExportRecord) {
      return {
        message: '检测到历史可信运行或导出记录，但当前没有活动课题。建议进入课题面板选择或建立课题后继续。',
        target: 'study',
        buttonLabel: '前往课题面板',
        stageId: 'compare',
      };
    }
    return {
      message: '数据与模型已就绪，可开始训练。建议前往训练监控区域。',
      target: 'trainMonitor',
      buttonLabel: '前往训练监控',
      stageId: 'train',
    };
  }
  // 当前课题尚无可信完成运行：不推荐比较/主张/导出，引导运行实验或检查训练条件。
  if (study.trustedAttemptCount === 0) {
    return {
      message: '当前课题尚无可信完成运行。可开始训练或检查训练条件，建议前往训练监控。',
      target: 'trainMonitor',
      buttonLabel: '前往训练监控',
      stageId: 'train',
    };
  }
  if (study.kind === 'candidate_selection' && !study.candidateSelected) {
    return {
      message: '存在可比较的可信运行。建议进入课题面板比较并确定候选。',
      target: 'study',
      buttonLabel: '前往课题面板',
      stageId: 'compare',
    };
  }
  if (study.candidateSelected && !claim) {
    return {
      message: '候选已确定。建议在课题面板创建评估主张。',
      target: 'study',
      buttonLabel: '前往课题面板',
      stageId: 'claim',
    };
  }
  if (!facts.currentStudyExportRecorded) {
    return {
      message: '当前课题已有可信运行，可整理交付物。建议前往导出面板。',
      target: 'export',
      buttonLabel: '前往导出面板',
      stageId: 'export',
    };
  }
  // 无法可靠判断时不伪造下一步。
  return {
    message: '当前课题的关键步骤已完成或留痕。可前往课题面板查看记录。',
    target: 'study',
    buttonLabel: '前往课题面板',
    stageId: 'compare',
  };
}

/** 纯投影入口：确定性输出，可表驱动测试。 */
export function projectWorkflow(facts: WorkflowFacts): WorkflowProjectionResult {
  const stages = [
    projectDataStage(facts),
    projectModelStage(facts),
    projectTrainStage(facts),
    projectCompareStage(facts),
    projectClaimStage(facts),
    projectExportStage(facts),
  ];
  const nextAction = projectNextAction(facts);
  for (const item of stages) {
    if (item.id === nextAction.stageId) item.recommended = true;
  }
  // 保持阶段顺序与集中定义的 ID 一致
  const order = WORKFLOW_STAGE_IDS;
  stages.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
  return { stages, nextAction };
}

/** 状态标签工具：供组件在需要时取用通用状态中文。 */
export function workflowStatusLabel(status: WorkflowStageStatus): string {
  return WORKFLOW_STATUS_LABELS[status];
}
