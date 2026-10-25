import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowProjection } from '@/hooks/useWorkflowProjection';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import type { Attempt, AttemptStatus, EvaluationClaim, ClaimStatus, ClaimVerdict, ExecutionTrust, Experiment, Study, StudyKind } from '@/types/experiment';
import type { TrainConfig } from '@/types/training';

const CONFIG: TrainConfig = {
  epochs: 1,
  learningRate: 0.001,
  batchSize: 32,
  dataset: 'mnist',
  device: 'cpu',
  layers: [
    { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
    { type: 'Flatten', params: {} },
    { type: 'Linear', params: { inFeatures: 784, outFeatures: 10 } },
  ],
};

function makeStudy(id: string, kind: StudyKind): Study {
  return {
    id,
    protocolVersion: 1,
    name: `课题-${id}`,
    kind,
    status: 'active',
    question: '测试问题',
    datasetContract: {
      identity: {
        id: 'd1',
        name: 'MNIST',
        taskType: 'image_classification',
        contentHash: 'sha256:d',
        fingerprintAlgorithm: 'sha256-v1',
        sampleCount: 100,
        importedAt: 1,
      },
      split: {
        strategy: 'random',
        seed: 1,
        validationRatio: 0.2,
        testRatio: 0.2,
        sampleUnit: 'image',
        independence: 'iid_assumed',
        machineChecks: [],
        splitHash: 'sha256:s',
      },
      preprocessing: { configHash: 'sha256:p', summary: '固定预处理' },
    },
    comparisonKey: null,
    selectionRule: '手动选择',
    budget: { maxExperiments: null, maxGpuMinutes: null },
    createdAt: 1,
    updatedAt: 1,
    lockedAt: null,
  };
}

function makeExperiment(id: string, studyId: string): Experiment {
  return {
    id,
    protocolVersion: 1,
    studyId,
    name: `实验-${id}`,
    config: CONFIG,
    configHash: `sha256:c-${id}`,
    createdAt: 1,
  };
}

function makeAttempt(id: string, experimentId: string, status: AttemptStatus, executionTrust: ExecutionTrust): Attempt {
  return {
    id,
    protocolVersion: 1,
    experimentId,
    runId: `run-${id}`,
    modelId: null,
    config: CONFIG,
    ordinal: 0,
    parentAttemptId: null,
    restartCount: 0,
    resumeType: 'fresh',
    status,
    startedAt: 1,
    endedAt: 2,
    provenance: {
      source: 'controlled',
      executionTrust,
      environment: { applicationVersion: '0.1.0', torchVersion: '2', pythonVersion: '3', device: 'cpu', cudaVersion: null },
      datasetContentHash: 'sha256:d',
      splitHash: 'sha256:s',
      testSetHash: null,
      machineChecks: [],
      testSampleCount: null,
      testLabelCounts: null,
      testTargetSummary: null,
      preprocessingHash: 'sha256:p',
      configHash: 'sha256:c',
      modelWeightsHash: null,
      witnessedByPipeline: true,
    },
    metrics: [],
    artifacts: null,
    executionMode: 'native',
  };
}

function makeClaim(id: string, studyId: string, attemptId: string, status: ClaimStatus, verdict: ClaimVerdict | null): EvaluationClaim {
  return {
    id,
    protocolVersion: 1,
    studyId,
    attemptId,
    modelWeightsHash: 'sha256:w',
    testDatasetHash: 'sha256:t',
    preprocessingHash: 'sha256:p',
    status,
    revision: 1,
    predicates: [],
    frozenHash: status === 'draft' ? null : 'sha256:f',
    frozenAt: null,
    unsealSequence: null,
    adjudicatedAt: status === 'adjudicated' ? 2 : null,
    verdict,
    predicateResults: [],
    classificationDiagnostics: null,
    conclusionTrust: 'not_evaluated',
    createdAt: 1,
    updatedAt: 1,
  };
}

function stageStatus(projection: ReturnType<typeof useWorkflowProjection>, id: string) {
  return projection.stages.find(stage => stage.id === id)?.status;
}

describe('useWorkflowProjection：只读投影钩子', () => {
  beforeEach(() => {
    localStorage.clear();
    useExperimentStore.getState().resetLedgerForTests();
    useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
    useLayerStore.setState({ ...useLayerStore.getInitialState() });
    useTrainingStore.setState({
      status: 'idle',
      isTraining: false,
      isPaused: false,
      error: null,
      errorKind: null,
    });
  });

  it('空项目：数据未开始，建议前往数据集面板', () => {
    const { result } = renderHook(() => useWorkflowProjection());
    expect(stageStatus(result.current, 'data')).toBe('not_started');
    expect(result.current.nextAction.target).toBe('dataset');
  });

  it('导入图片分类数据：数据阶段变为已载入', () => {
    act(() => {
      useDatasetStore.getState().setDataset({ name: 'MNIST', type: 'mnist', sampleCount: 70000, classCount: 10 });
    });
    const { result } = renderHook(() => useWorkflowProjection());
    expect(stageStatus(result.current, 'data')).toBe('completed');
  });

  it('导入 CSV：目标列未确认时需处理，确认后已载入', () => {
    act(() => {
      useDatasetStore.getState().setDataset({ name: '回归数据', type: 'csv', sampleCount: 100, classCount: 1, columns: ['a', 'y'] });
    });
    const first = renderHook(() => useWorkflowProjection());
    expect(stageStatus(first.result.current, 'data')).toBe('attention');

    act(() => {
      useDatasetStore.getState().setTargetField('y');
    });
    expect(stageStatus(first.result.current, 'data')).toBe('completed');
  });

  it('模型：无层未开始；有层且校验通过才显示结构校验通过', () => {
    const { result } = renderHook(() => useWorkflowProjection());
    expect(stageStatus(result.current, 'model')).toBe('not_started');

    act(() => {
      useLayerStore.getState().addClassicModel(CONFIG.layers);
    });
    expect(stageStatus(result.current, 'model')).toBe('completed');

    act(() => {
      useLayerStore.setState({
        validationResult: {
          isValid: false,
          errors: [{
            layerId: 'x',
            layerType: 'Linear',
            errorType: 'param_conflict',
            message: '形状不匹配',
            suggestion: '修改参数',
            expectedInputShape: [10],
            actualInputShape: [128],
          }],
          warnings: [],
        },
        hasShapeError: true,
      });
    });
    expect(stageStatus(result.current, 'model')).toBe('attention');
  });

  it('训练状态矩阵：running/paused/error/cancelled/done 的保守语义', () => {
    const { result } = renderHook(() => useWorkflowProjection());

    act(() => useTrainingStore.setState({ status: 'training', isTraining: true }));
    expect(stageStatus(result.current, 'train')).toBe('in_progress');
    expect(result.current.stages.find(item => item.id === 'train')?.statusLabel).toBe('训练进行中');

    act(() => useTrainingStore.setState({ status: 'paused', isPaused: true }));
    expect(result.current.stages.find(item => item.id === 'train')?.statusLabel).toBe('训练已暂停');
    expect(stageStatus(result.current, 'train')).not.toBe('completed');

    act(() => useTrainingStore.setState({ status: 'error', isTraining: false, isPaused: false }));
    expect(stageStatus(result.current, 'train')).toBe('attention');

    act(() => useTrainingStore.setState({ status: 'cancelled' }));
    expect(stageStatus(result.current, 'train')).not.toBe('completed');

    // 进程报告完成但账本无采信结果：不得显示已有完成运行
    act(() => useTrainingStore.setState({ status: 'done' }));
    expect(stageStatus(result.current, 'train')).not.toBe('completed');
  });

  it('可信完成 Attempt（当前活动 Study 作用域）：显示已有完成运行；未采信运行不算', () => {
    const store = useExperimentStore.getState();
    act(() => {
      store.registerStudy(makeStudy('study-1', 'candidate_selection'));
      store.registerExperiment(makeExperiment('exp-1', 'study-1'));
      store.registerAttempt(makeAttempt('attempt-untrusted', 'exp-1', 'completed', 'unverified'));
      store.setActiveStudy('study-1');
    });
    const { result } = renderHook(() => useWorkflowProjection());
    expect(stageStatus(result.current, 'train')).not.toBe('completed');

    act(() => {
      useExperimentStore.getState().registerAttempt(makeAttempt('attempt-trusted', 'exp-1', 'completed', 'trusted'));
    });
    expect(stageStatus(result.current, 'train')).toBe('completed');
  });

  it('跨 Study 证据不串用：Study A 有可信完成，活动 Study B 无；切回 A 才显示完成', () => {
    const store = useExperimentStore.getState();
    act(() => {
      store.registerStudy(makeStudy('study-A', 'candidate_selection'));
      store.registerStudy(makeStudy('study-B', 'candidate_selection'));
      store.registerExperiment(makeExperiment('exp-A', 'study-A'));
      store.registerExperiment(makeExperiment('exp-B', 'study-B'));
      store.registerAttempt(makeAttempt('attempt-A', 'exp-A', 'completed', 'trusted'));
      store.setActiveStudy('study-B');
    });
    const { result } = renderHook(() => useWorkflowProjection());

    // 活动 Study B 无证据：训练不完成，也不得推荐导出/对比完成
    expect(stageStatus(result.current, 'train')).not.toBe('completed');
    expect(result.current.nextAction.target).not.toBe('export');

    // 切回 Study A：同一证据立即归属当前流程，无残留也无延迟
    act(() => useExperimentStore.getState().setActiveStudy('study-A'));
    expect(stageStatus(result.current, 'train')).toBe('completed');

    // 再切回 B：立即失去完成状态（无旧状态残留）
    act(() => useExperimentStore.getState().setActiveStudy('study-B'));
    expect(stageStatus(result.current, 'train')).not.toBe('completed');
  });

  it('无活动 Study、有历史可信 Attempt：当前训练不完成，下一步引导课题面板', () => {
    const store = useExperimentStore.getState();
    act(() => {
      // 数据/模型前置就绪，避免建议被更高优先级的数据/模型规则截断
      useDatasetStore.getState().setDataset({ name: 'MNIST', type: 'mnist', sampleCount: 70000, classCount: 10 });
      useLayerStore.getState().addClassicModel(CONFIG.layers);
      store.registerStudy(makeStudy('study-1', 'candidate_selection'));
      store.registerExperiment(makeExperiment('exp-1', 'study-1'));
      store.registerAttempt(makeAttempt('attempt-1', 'exp-1', 'completed', 'trusted'));
      // 显式不设置活动 Study（或清空）
      store.setActiveStudy(null);
    });
    const { result } = renderHook(() => useWorkflowProjection());
    expect(stageStatus(result.current, 'train')).not.toBe('completed');
    expect(stageStatus(result.current, 'export')).not.toBe('completed');
    expect(result.current.nextAction.target).toBe('study');
    expect(result.current.nextAction.message).toContain('没有活动课题');
  });

  it('当前 Study 只有 cancelled/interrupted/paused/failed Attempt：不得算完成', () => {
    const statuses: AttemptStatus[] = ['cancelled', 'interrupted', 'paused', 'failed'];
    for (const status of statuses) {
      act(() => {
        useExperimentStore.getState().resetLedgerForTests();
        const store = useExperimentStore.getState();
        store.registerStudy(makeStudy('study-1', 'candidate_selection'));
        store.registerExperiment(makeExperiment('exp-1', 'study-1'));
        store.registerAttempt(makeAttempt(`attempt-${status}`, 'exp-1', status, 'trusted'));
        store.setActiveStudy('study-1');
      });
      const { result, unmount } = renderHook(() => useWorkflowProjection());
      expect(stageStatus(result.current, 'train')).not.toBe('completed');
      unmount();
    }
  });

  it('切换活动 Study：对比/主张状态立即切换，不残留旧 Study', () => {
    const store = useExperimentStore.getState();
    act(() => {
      store.registerStudy(makeStudy('study-cand', 'candidate_selection'));
      store.registerStudy(makeStudy('study-free', 'free_exploration'));
      store.registerExperiment(makeExperiment('exp-cand', 'study-cand'));
      store.registerExperiment(makeExperiment('exp-free', 'study-free'));
      store.registerAttempt(makeAttempt('attempt-cand', 'exp-cand', 'completed', 'trusted'));
      store.registerAttempt(makeAttempt('attempt-free', 'exp-free', 'completed', 'trusted'));
      // 候选选择 Study 已确定候选；自由探索 Study 无候选概念
      store.updateStudy('study-cand', { selectedExperimentId: 'exp-cand', selectedAttemptId: 'attempt-cand' });
    });

    const { result } = renderHook(() => useWorkflowProjection());

    act(() => useExperimentStore.getState().setActiveStudy('study-cand'));
    expect(result.current.stages.find(item => item.id === 'compare')?.statusLabel).toBe('候选已确定');

    act(() => useExperimentStore.getState().setActiveStudy('study-free'));
    expect(result.current.stages.find(item => item.id === 'compare')?.statusLabel).toBe('已有探索记录');
    expect(result.current.stages.find(item => item.id === 'compare')?.status).not.toBe('completed');
  });

  it('Claim 生命周期：draft → frozen → adjudicated，且只有活动 Study 的 Claim 被投影', () => {
    const store = useExperimentStore.getState();
    act(() => {
      // 数据与模型前置就绪（真实系统里有可信 Attempt 必然已有模型），
      // 避免下一步建议被更高优先级的规则截断
      useDatasetStore.getState().setDataset({ name: 'MNIST', type: 'mnist', sampleCount: 70000, classCount: 10 });
      useLayerStore.getState().addClassicModel(CONFIG.layers);
      store.registerStudy(makeStudy('study-1', 'candidate_selection'));
      store.registerExperiment(makeExperiment('exp-1', 'study-1'));
      store.registerAttempt(makeAttempt('attempt-1', 'exp-1', 'completed', 'trusted'));
      store.updateStudy('study-1', { selectedExperimentId: 'exp-1', selectedAttemptId: 'attempt-1' });
      store.setActiveStudy('study-1');
    });

    const { result } = renderHook(() => useWorkflowProjection());
    expect(stageStatus(result.current, 'claim')).toBe('ready');
    expect(result.current.nextAction.message).toContain('评估主张');

    act(() => useExperimentStore.getState().registerClaim(makeClaim('claim-1', 'study-1', 'attempt-1', 'draft', null)));
    expect(stageStatus(result.current, 'claim')).toBe('in_progress');
    expect(stageStatus(result.current, 'claim')).not.toBe('completed');

    act(() => useExperimentStore.getState().replaceClaim(makeClaim('claim-1', 'study-1', 'attempt-1', 'frozen', null)));
    expect(stageStatus(result.current, 'claim')).not.toBe('completed');
    expect(result.current.stages.find(item => item.id === 'claim')?.statusLabel).toContain('待裁决');

    for (const verdict of ['pass', 'fail', 'inconclusive'] as const) {
      act(() => useExperimentStore.getState().replaceClaim(makeClaim('claim-1', 'study-1', 'attempt-1', 'adjudicated', verdict)));
      expect(stageStatus(result.current, 'claim')).toBe('completed');
    }
    expect(result.current.nextAction.target).toBe('export');
  });

  it('adjudicated + verdict=null：裁决记录不完整，不伪装 INCONCLUSIVE，不推荐导出', () => {
    const store = useExperimentStore.getState();
    act(() => {
      useDatasetStore.getState().setDataset({ name: 'MNIST', type: 'mnist', sampleCount: 70000, classCount: 10 });
      useLayerStore.getState().addClassicModel(CONFIG.layers);
      store.registerStudy(makeStudy('study-1', 'candidate_selection'));
      store.registerExperiment(makeExperiment('exp-1', 'study-1'));
      store.registerAttempt(makeAttempt('attempt-1', 'exp-1', 'completed', 'trusted'));
      store.updateStudy('study-1', { selectedExperimentId: 'exp-1', selectedAttemptId: 'attempt-1' });
      store.setActiveStudy('study-1');
      store.registerClaim(makeClaim('claim-1', 'study-1', 'attempt-1', 'adjudicated', null));
    });
    const { result } = renderHook(() => useWorkflowProjection());
    const claimStage = result.current.stages.find(item => item.id === 'claim');
    expect(claimStage?.status).toBe('attention');
    expect(claimStage?.statusLabel).toBe('裁决记录不完整');
    expect(claimStage?.statusLabel).not.toContain('INCONCLUSIVE');
    expect(result.current.nextAction.target).toBe('study');
    expect(result.current.nextAction.target).not.toBe('export');
  });

  it('持久化未知 verdict 字符串：fail closed，不映射为正式裁决', () => {
    const store = useExperimentStore.getState();
    act(() => {
      store.registerStudy(makeStudy('study-1', 'candidate_selection'));
      store.registerExperiment(makeExperiment('exp-1', 'study-1'));
      store.registerAttempt(makeAttempt('attempt-1', 'exp-1', 'completed', 'trusted'));
      store.setActiveStudy('study-1');
      // 持久化数据可能绕过 TS 类型：构造未知 verdict
      const broken = makeClaim('claim-1', 'study-1', 'attempt-1', 'adjudicated', 'legacy-ok' as unknown as ClaimVerdict);
      store.registerClaim(broken);
    });
    const { result } = renderHook(() => useWorkflowProjection());
    const claimStage = result.current.stages.find(item => item.id === 'claim');
    expect(claimStage?.status).toBe('attention');
    expect(claimStage?.statusLabel).toBe('裁决记录异常');
    expect(claimStage?.statusLabel).not.toContain('INCONCLUSIVE');
  });

  it('Claim 属于 Study A，活动 Study B：B 不读取 A 的 Claim', () => {
    const store = useExperimentStore.getState();
    act(() => {
      useDatasetStore.getState().setDataset({ name: 'MNIST', type: 'mnist', sampleCount: 70000, classCount: 10 });
      useLayerStore.getState().addClassicModel(CONFIG.layers);
      store.registerStudy(makeStudy('study-A', 'candidate_selection'));
      store.registerStudy(makeStudy('study-B', 'candidate_selection'));
      store.registerExperiment(makeExperiment('exp-A', 'study-A'));
      store.registerExperiment(makeExperiment('exp-B', 'study-B'));
      store.registerAttempt(makeAttempt('attempt-A', 'exp-A', 'completed', 'trusted'));
      store.registerAttempt(makeAttempt('attempt-B', 'exp-B', 'completed', 'trusted'));
      store.updateStudy('study-A', { selectedExperimentId: 'exp-A', selectedAttemptId: 'attempt-A' });
      store.registerClaim(makeClaim('claim-A', 'study-A', 'attempt-A', 'adjudicated', 'pass'));
      store.setActiveStudy('study-B');
    });
    const { result } = renderHook(() => useWorkflowProjection());

    // B 无 Claim：不得显示 A 的裁决完成，也不得因 A 的裁决推荐导出文案
    const claimStage = result.current.stages.find(item => item.id === 'claim');
    expect(claimStage?.statusLabel).not.toContain('裁决已完成');
    expect(result.current.nextAction.message).not.toContain('裁决已完成');

    // 切回 A：A 的裁决立即生效并推荐导出（不残留 B 的视角）
    act(() => useExperimentStore.getState().setActiveStudy('study-A'));
    expect(result.current.stages.find(item => item.id === 'claim')?.statusLabel).toContain('PASS');
    expect(result.current.nextAction.target).toBe('export');
  });

  it('审计异常：主张阶段为需处理，下一步导航课题区域且不推荐解封/导出', () => {
    act(() => {
      useExperimentStore.setState({ auditPersistence: 'degraded', auditError: '磁盘 JSONL 与快照不一致' });
    });
    const { result } = renderHook(() => useWorkflowProjection());
    expect(stageStatus(result.current, 'claim')).toBe('attention');
    expect(result.current.nextAction.target).toBe('study');
    expect(result.current.nextAction.message).not.toContain('解封');
    expect(result.current.nextAction.message).not.toContain('导出');
  });

  it('导出作用域：只有归属当前活动 Study 的事件才算；其他实体一律不得冒充', () => {
    const store = useExperimentStore.getState();
    act(() => {
      store.registerStudy(makeStudy('study-A', 'candidate_selection'));
      store.registerStudy(makeStudy('study-B', 'candidate_selection'));
      store.registerExperiment(makeExperiment('exp-A', 'study-A'));
      store.registerExperiment(makeExperiment('exp-B', 'study-B'));
      store.registerAttempt(makeAttempt('attempt-A', 'exp-A', 'completed', 'trusted'));
      store.registerAttempt(makeAttempt('attempt-B', 'exp-B', 'completed', 'trusted'));
      store.setActiveStudy('study-B');
    });
    const { result } = renderHook(() => useWorkflowProjection());

    // Study A 的报告导出不得计入 Study B
    act(() => useExperimentStore.getState().appendEvent('study', 'study-A', 'study_report_export_completed', {}));
    expect(stageStatus(result.current, 'export')).not.toBe('completed');

    // Study A 下 Attempt 的实验包导出不得计入 Study B
    act(() => useExperimentStore.getState().appendEvent('attempt', 'attempt-A', 'experiment_package_export_completed', {}));
    expect(stageStatus(result.current, 'export')).not.toBe('completed');

    // legacy-export 无法关联，不得证明当前 Study 已导出
    act(() => useExperimentStore.getState().appendEvent('attempt', 'legacy-export', 'experiment_package_export_completed', {}));
    expect(stageStatus(result.current, 'export')).not.toBe('completed');

    // 同 id 但错误 entityType：不得采信（协议里报告导出必须挂在 study 实体）
    act(() => useExperimentStore.getState().appendEvent('experiment', 'study-B', 'study_report_export_completed', {}));
    expect(stageStatus(result.current, 'export')).not.toBe('completed');

    // 当前 Study 自己的报告导出：才算“已有导出记录”
    act(() => useExperimentStore.getState().appendEvent('study', 'study-B', 'study_report_export_completed', {}));
    expect(stageStatus(result.current, 'export')).toBe('completed');
    expect(result.current.stages.find(item => item.id === 'export')?.statusLabel).toBe('已有导出记录');
  });

  it('导出作用域：当前 Study 下 Attempt 的实验包导出算当前证据；切换 Study 立即重算', () => {
    const store = useExperimentStore.getState();
    act(() => {
      store.registerStudy(makeStudy('study-A', 'candidate_selection'));
      store.registerStudy(makeStudy('study-B', 'candidate_selection'));
      store.registerExperiment(makeExperiment('exp-A', 'study-A'));
      store.registerExperiment(makeExperiment('exp-B', 'study-B'));
      store.registerAttempt(makeAttempt('attempt-A', 'exp-A', 'completed', 'trusted'));
      store.setActiveStudy('study-A');
    });
    const { result } = renderHook(() => useWorkflowProjection());

    act(() => useExperimentStore.getState().appendEvent('attempt', 'attempt-A', 'experiment_package_export_completed', {}));
    expect(stageStatus(result.current, 'export')).toBe('completed');

    // 切换到无导出事件的 Study B：导出状态立即失去，无残留
    act(() => useExperimentStore.getState().setActiveStudy('study-B'));
    expect(stageStatus(result.current, 'export')).not.toBe('completed');
  });

  it('钩子不写 localStorage（工作流状态不持久化）', () => {
    renderHook(() => useWorkflowProjection());
    expect(localStorage.getItem('neurobricks_workflow')).toBeNull();
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? '';
      expect(key).not.toContain('workflow');
    }
  });
});
