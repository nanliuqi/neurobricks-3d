import { describe, expect, it } from 'vitest';
import { projectWorkflow } from '@/utils/workflowProjection';
import type { WorkflowFacts, WorkflowStageId, WorkflowStageStatus, WorkflowStudyFacts } from '@/types/workflow';

/** 事实构造器：默认空项目，其余状态按用例覆盖。 */
function makeFacts(overrides: Partial<WorkflowFacts> = {}): WorkflowFacts {
  return {
    hasDataset: false,
    datasetAttention: false,
    hasLayers: false,
    structureValid: false,
    trainStatus: 'idle',
    activeStudy: null,
    latestClaim: null,
    auditDegraded: false,
    hasHistoricalTrustedAttempt: false,
    currentStudyExportRecorded: false,
    hasHistoricalExportRecord: false,
    ...overrides,
  };
}

function study(overrides: Partial<WorkflowStudyFacts> = {}): WorkflowStudyFacts {
  return {
    kind: 'candidate_selection',
    candidateSelected: false,
    attemptCount: 0,
    trustedAttemptCount: 0,
    ...overrides,
  };
}

function stageOf(result: ReturnType<typeof projectWorkflow>, id: WorkflowStageId) {
  const item = result.stages.find(stage => stage.id === id);
  if (!item) throw new Error(`missing stage: ${id}`);
  return item;
}

function expectStage(result: ReturnType<typeof projectWorkflow>, id: WorkflowStageId, status: WorkflowStageStatus) {
  expect(stageOf(result, id).status).toBe(status);
}

describe('projectWorkflow：基础流程', () => {
  it('1. 空项目：数据/模型未开始，下一步为数据', () => {
    const result = projectWorkflow(makeFacts());
    expectStage(result, 'data', 'not_started');
    expectStage(result, 'model', 'not_started');
    expect(result.nextAction.stageId).toBe('data');
    expect(result.nextAction.target).toBe('dataset');
  });

  it('2. 数据已导入、无模型：数据已就绪，下一步为模型', () => {
    const result = projectWorkflow(makeFacts({ hasDataset: true }));
    expectStage(result, 'data', 'completed');
    expect(stageOf(result, 'data').statusLabel).toBe('数据已载入');
    expectStage(result, 'model', 'not_started');
    expect(result.nextAction.stageId).toBe('model');
  });

  it('3. 有模型但结构错误：模型需处理，下一步导航参数面板', () => {
    const result = projectWorkflow(makeFacts({ hasDataset: true, hasLayers: true, structureValid: false }));
    expectStage(result, 'model', 'attention');
    expect(result.nextAction.target).toBe('param');
    expect(result.nextAction.message).toContain('校验未通过');
  });

  it('4. 数据与模型都就绪、无训练：训练可继续，下一步为训练', () => {
    const result = projectWorkflow(makeFacts({ hasDataset: true, hasLayers: true, structureValid: true }));
    expectStage(result, 'train', 'ready');
    expect(result.nextAction.stageId).toBe('train');
    expect(result.nextAction.target).toBe('trainMonitor');
  });

  it('5. 训练 running：训练进行中，下一步为训练监控', () => {
    const result = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true, trainStatus: 'training',
    }));
    expectStage(result, 'train', 'in_progress');
    expect(stageOf(result, 'train').statusLabel).toBe('训练进行中');
    expect(result.nextAction.target).toBe('trainMonitor');
  });

  it('6. 训练 paused：明确显示暂停，不得显示完成', () => {
    const result = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true, trainStatus: 'paused',
    }));
    expect(stageOf(result, 'train').statusLabel).toBe('训练已暂停');
    expect(stageOf(result, 'train').status).not.toBe('completed');
    expect(result.nextAction.message).toContain('暂停');
  });

  it('7. 训练 cancelled：不得显示完成', () => {
    const result = projectWorkflow(makeFacts({ trainStatus: 'cancelled' }));
    expect(stageOf(result, 'train').status).not.toBe('completed');
    expect(stageOf(result, 'train').note).toContain('已取消');
  });

  it('8. 训练 failed：显示需处理', () => {
    expectStage(projectWorkflow(makeFacts({ trainStatus: 'error' })), 'train', 'attention');
    expectStage(projectWorkflow(makeFacts({ trainStatus: 'crashed' })), 'train', 'attention');
  });

  it('9. 进程完成但结果未采信：不得显示已有完成运行', () => {
    const result = projectWorkflow(makeFacts({ trainStatus: 'done' }));
    expect(stageOf(result, 'train').status).not.toBe('completed');
    expect(stageOf(result, 'train').note).toContain('未被采信');
  });

  it('10. 当前活动 Study 有可信完成 Attempt：训练阶段显示已有完成运行', () => {
    const result = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true,
      activeStudy: study({ attemptCount: 1, trustedAttemptCount: 1 }),
    }));
    expectStage(result, 'train', 'completed');
    expect(stageOf(result, 'train').statusLabel).toBe('已有完成运行');
  });
});

describe('projectWorkflow：证据作用域（跨 Study 不串用）', () => {
  it('A. 历史可信运行存在但活动 Study 无可信运行：当前训练不完成、不推荐导出', () => {
    const result = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true,
      hasHistoricalTrustedAttempt: true,
      activeStudy: study({ attemptCount: 0, trustedAttemptCount: 0 }),
    }));
    expect(stageOf(result, 'train').status).not.toBe('completed');
    expect(result.nextAction.target).toBe('trainMonitor');
    expect(result.nextAction.message).toContain('尚无可信完成运行');
    expect(result.nextAction.target).not.toBe('export');
  });

  it('A2. 切回有可信运行的 Study 后才显示已有完成运行（同一投影规则随事实切换）', () => {
    const studyB = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true,
      hasHistoricalTrustedAttempt: true,
      activeStudy: study({ attemptCount: 0, trustedAttemptCount: 0 }),
    }));
    const studyA = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true,
      activeStudy: study({ attemptCount: 1, trustedAttemptCount: 1 }),
    }));
    expect(stageOf(studyB, 'train').status).not.toBe('completed');
    expectStage(studyA, 'train', 'completed');
  });

  it('B. 无活动 Study、有历史可信 Attempt：不冒充当前证据，引导建立课题', () => {
    const result = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true,
      hasHistoricalTrustedAttempt: true,
    }));
    // 训练不得显示当前已有完成运行
    expect(stageOf(result, 'train').status).not.toBe('completed');
    expect(stageOf(result, 'train').note).toContain('历史可信运行');
    // 对比阶段提示历史运行并引导选择/建立课题
    expect(stageOf(result, 'compare').statusLabel).toBe('存在历史运行，可选择或建立课题');
    // 下一步进入课题面板，且不得直接推荐导出
    expect(result.nextAction.target).toBe('study');
    expect(result.nextAction.message).toContain('没有活动课题');
    expect(result.nextAction.target).not.toBe('export');
  });

  it('D. 只有历史导出记录、当前 Study 无导出：不得显示导出完成', () => {
    const result = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true,
      hasHistoricalExportRecord: true,
      activeStudy: study({ attemptCount: 1, trustedAttemptCount: 1 }),
    }));
    expect(stageOf(result, 'export').status).not.toBe('completed');
  });

  it('D2. 无活动 Study、有历史导出事件：当前导出阶段不得 completed，引导课题面板', () => {
    const result = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true,
      hasHistoricalExportRecord: true,
    }));
    expect(stageOf(result, 'export').status).not.toBe('completed');
    expect(stageOf(result, 'export').note).toContain('与当前课题无关');
    expect(result.nextAction.target).toBe('study');
    expect(result.nextAction.target).not.toBe('export');
  });

  it('E. 当前 Study 已有导出记录：显示“已有导出记录”而非无条件的“已导出”', () => {
    const result = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true,
      activeStudy: study({ attemptCount: 1, trustedAttemptCount: 1 }),
      currentStudyExportRecorded: true,
    }));
    expectStage(result, 'export', 'completed');
    expect(stageOf(result, 'export').statusLabel).toBe('已有导出记录');
    expect(stageOf(result, 'export').statusLabel).not.toBe('已导出');
  });
});

describe('projectWorkflow：Study 语义', () => {
  it('11. 没有活动 Study、无历史证据：显示尚未建立课题', () => {
    const result = projectWorkflow(makeFacts({ hasDataset: true, hasLayers: true, structureValid: true }));
    expectStage(result, 'compare', 'not_started');
    expect(stageOf(result, 'compare').statusLabel).toBe('尚未建立课题');
  });

  it('12. 自由探索存在结果：显示探索记录，不得显示候选已确定', () => {
    const result = projectWorkflow(makeFacts({
      activeStudy: study({ kind: 'free_exploration', attemptCount: 2, trustedAttemptCount: 2 }),
    }));
    const compare = stageOf(result, 'compare');
    expect(compare.statusLabel).toBe('已有探索记录');
    expect(compare.status).not.toBe('completed');
    expect(compare.note).toContain('不构成候选结论');
  });

  it('13. 候选选择 Study 有多个可信结果但未选候选：显示可比较', () => {
    const result = projectWorkflow(makeFacts({
      hasDataset: true, hasLayers: true, structureValid: true,
      activeStudy: study({ attemptCount: 3, trustedAttemptCount: 2 }),
    }));
    expect(stageOf(result, 'compare').statusLabel).toBe('可进行候选比较');
    expect(result.nextAction.message).toContain('候选');
  });

  it('14. 候选已确认：显示候选已确定', () => {
    const result = projectWorkflow(makeFacts({
      activeStudy: study({ candidateSelected: true, attemptCount: 3, trustedAttemptCount: 2 }),
    }));
    expectStage(result, 'compare', 'completed');
    expect(stageOf(result, 'compare').statusLabel).toBe('候选已确定');
  });

  it('15. 对照消融仅有两个未配对运行：不得宣称消融完成或改动有效', () => {
    const result = projectWorkflow(makeFacts({
      activeStudy: study({ kind: 'controlled_ablation', attemptCount: 2, trustedAttemptCount: 2 }),
    }));
    const compare = stageOf(result, 'compare');
    expect(compare.status).not.toBe('completed');
    expect(compare.statusLabel).not.toContain('完成');
    expect(compare.statusLabel).not.toContain('有效');
  });

  it('16. 切换活动 Study：投影随事实立即切换，不残留', () => {
    const studyA = projectWorkflow(makeFacts({
      activeStudy: study({ candidateSelected: true, attemptCount: 1, trustedAttemptCount: 1 }),
    }));
    const studyB = projectWorkflow(makeFacts({
      activeStudy: study({ kind: 'free_exploration', attemptCount: 1, trustedAttemptCount: 1 }),
    }));
    expect(stageOf(studyA, 'compare').statusLabel).toBe('候选已确定');
    expect(stageOf(studyB, 'compare').statusLabel).toBe('已有探索记录');
  });
});

describe('projectWorkflow：Claim 语义', () => {
  const withCandidate = {
    hasDataset: true,
    hasLayers: true,
    structureValid: true,
    activeStudy: study({ candidateSelected: true, attemptCount: 1, trustedAttemptCount: 1 }),
  } satisfies Partial<WorkflowFacts>;

  it('17. 无 Claim：主张可创建', () => {
    const result = projectWorkflow(makeFacts(withCandidate));
    expect(stageOf(result, 'claim').statusLabel).toBe('可创建评估主张');
    expect(result.nextAction.message).toContain('评估主张');
  });

  it('18. draft：进行中，不得标记完成', () => {
    const result = projectWorkflow(makeFacts({ ...withCandidate, latestClaim: { status: 'draft', verdict: null } }));
    expectStage(result, 'claim', 'in_progress');
    expect(stageOf(result, 'claim').status).not.toBe('completed');
  });

  it('19. frozen：已冻结/待裁决，不得显示裁决完成', () => {
    const result = projectWorkflow(makeFacts({ ...withCandidate, latestClaim: { status: 'frozen', verdict: null } }));
    expect(stageOf(result, 'claim').status).not.toBe('completed');
    expect(stageOf(result, 'claim').statusLabel).toContain('待裁决');
  });

  it('20-22. PASS/FAIL/INCONCLUSIVE 都表示裁决已完成，保留三值语义', () => {
    const pass = projectWorkflow(makeFacts({ ...withCandidate, latestClaim: { status: 'adjudicated', verdict: 'pass' } }));
    const fail = projectWorkflow(makeFacts({ ...withCandidate, latestClaim: { status: 'adjudicated', verdict: 'fail' } }));
    const inconclusive = projectWorkflow(makeFacts({ ...withCandidate, latestClaim: { status: 'adjudicated', verdict: 'inconclusive' } }));

    expectStage(pass, 'claim', 'completed');
    expectStage(fail, 'claim', 'completed');
    expectStage(inconclusive, 'claim', 'completed');

    expect(stageOf(pass, 'claim').statusLabel).toContain('PASS');
    expect(stageOf(fail, 'claim').statusLabel).toContain('FAIL');
    expect(stageOf(inconclusive, 'claim').statusLabel).toContain('证据不足');
    expect(stageOf(fail, 'claim').statusLabel).not.toContain('错误');
    expect(stageOf(inconclusive, 'claim').statusLabel).not.toContain('失败');

    // 裁决完成且未导出时建议导出
    expect(pass.nextAction.target).toBe('export');
  });

  it('G. adjudicated + verdict=null：attention、不伪装 INCONCLUSIVE、不推荐导出', () => {
    const result = projectWorkflow(makeFacts({ ...withCandidate, latestClaim: { status: 'adjudicated', verdict: null } }));
    const claim = stageOf(result, 'claim');
    expect(claim.status).toBe('attention');
    expect(claim.statusLabel).toBe('裁决记录不完整');
    expect(claim.statusLabel).not.toContain('INCONCLUSIVE');
    expect(claim.status).not.toBe('completed');
    expect(result.nextAction.target).toBe('study');
    expect(result.nextAction.target).not.toBe('export');
    // 导出阶段本身仅由当前课题的可信 Attempt 支撑为“可导出”（实验包导出与主张状态独立），
    // 但不得因损坏的裁决记录进入 completed；“不推荐导出”由 nextAction 保证。
    expect(stageOf(result, 'export').status).not.toBe('completed');
  });

  it('21. 持久化出现未知 verdict 字符串：fail closed，不得映射为正式裁决', () => {
    const result = projectWorkflow(makeFacts({
      ...withCandidate,
      // 持久化数据可能绕过 TS 类型：显式构造未知字符串
      latestClaim: { status: 'adjudicated', verdict: 'legacy-ok' as unknown as 'pass' },
    }));
    const claim = stageOf(result, 'claim');
    expect(claim.status).toBe('attention');
    expect(claim.statusLabel).toBe('裁决记录异常');
    expect(claim.statusLabel).not.toContain('INCONCLUSIVE');
    expect(claim.statusLabel).not.toContain('PASS');
    expect(result.nextAction.target).not.toBe('export');
  });

  it('23. 审计异常：attention，且下一步导航课题区域', () => {
    const result = projectWorkflow(makeFacts({ ...withCandidate, auditDegraded: true }));
    expectStage(result, 'claim', 'attention');
    expect(result.nextAction.target).toBe('study');
    expect(result.nextAction.message).toContain('审计');
    expect(result.nextAction.message).not.toContain('导出');
    expect(result.nextAction.message).not.toContain('解封');
  });

  it('24. 事后主张：不得升级为可信结论', () => {
    const result = projectWorkflow(makeFacts({ ...withCandidate, latestClaim: { status: 'post_hoc', verdict: 'pass' } }));
    expect(stageOf(result, 'claim').status).toBe('attention');
    expect(stageOf(result, 'claim').statusLabel).not.toContain('裁决已完成');
  });
});

describe('projectWorkflow：导航映射与无副作用', () => {
  it('28-33. 各阶段导航目标正确', () => {
    const result = projectWorkflow(makeFacts());
    const targets = Object.fromEntries(result.stages.map(item => [item.id, item.target]));
    expect(targets).toEqual({
      data: 'dataset',
      model: 'param',
      train: 'trainMonitor',
      compare: 'study',
      claim: 'study',
      export: 'export',
    });
  });

  it('38. 同时只有一个推荐阶段（唯一 aria-current 基础）', () => {
    const scenarios: WorkflowFacts[] = [
      makeFacts(),
      makeFacts({ hasDataset: true, hasLayers: true, structureValid: true }),
      makeFacts({ trainStatus: 'training' }),
      makeFacts({
        hasDataset: true, hasLayers: true, structureValid: true,
        activeStudy: study({ attemptCount: 1, trustedAttemptCount: 1 }),
      }),
      makeFacts({ auditDegraded: true }),
      makeFacts({ hasHistoricalTrustedAttempt: true }),
    ];
    for (const facts of scenarios) {
      const result = projectWorkflow(facts);
      const recommended = result.stages.filter(item => item.recommended);
      expect(recommended.length).toBe(1);
      expect(recommended[0].id).toBe(result.nextAction.stageId);
    }
  });

  it('39. 所有阶段可访问名称包含阶段名称与状态', () => {
    const result = projectWorkflow(makeFacts({ trainStatus: 'training' }));
    for (const item of result.stages) {
      expect(item.accessibleName).toContain(item.name);
      expect(item.accessibleName).toContain(item.statusLabel);
    }
    expect(stageOf(result, 'train').accessibleName).toBe('训练，训练进行中');
  });

  it('40/状态不只靠颜色：每个阶段都带文字状态标签', () => {
    const result = projectWorkflow(makeFacts());
    for (const item of result.stages) {
      expect(item.statusLabel.length).toBeGreaterThan(0);
    }
  });

  it('纯函数确定性：相同输入产出相同结果', () => {
    const facts = makeFacts({ hasDataset: true, trainStatus: 'paused' });
    expect(projectWorkflow(facts)).toEqual(projectWorkflow(facts));
  });

  it('下一步文案包含事实、动作与区域，且不包含业务执行语义', () => {
    const result = projectWorkflow(makeFacts({ hasDataset: true, hasLayers: true, structureValid: false }));
    expect(result.nextAction.message).toContain('参数面板');
    expect(result.nextAction.buttonLabel.length).toBeGreaterThan(0);
    for (const forbidden of ['将自动', '已为您启动', '已为您冻结', '已为您解封', '已为您导出']) {
      expect(result.nextAction.message).not.toContain(forbidden);
    }
  });
});
