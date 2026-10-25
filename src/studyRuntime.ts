import { comparisonKeyForDatasetContract, snapshotDatasetContract } from '@/experimentRuntime';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useGPUStore } from '@/stores/useGPUStore';
import { TRUST_PROTOCOL_VERSION, type Study, type StudyKind } from '@/types/experiment';
import { TRAIN_CONFIG_STORAGE_KEY, type TrainConfig } from '@/types/training';
import { selectedTrainingDevice } from '@/utils/trainingDevice';

export interface CreateStudyInput {
  name: string;
  question: string;
  kind: StudyKind;
  selectionRule?: string;
  maxExperiments?: number | null;
  maxGpuMinutes?: number | null;
}

function createId(): string {
  return `study-${globalThis.crypto.randomUUID()}`;
}

function currentTrainConfig(): TrainConfig {
  const datasetState = useDatasetStore.getState();
  const gpuState = useGPUStore.getState();
  const dataset = datasetState.datasetInfo;
  if (!dataset) throw new Error('请先选择数据集');
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(localStorage.getItem(TRAIN_CONFIG_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
  } catch {
    saved = {};
  }
  const layers = useLayerStore.getState().layers
    .slice()
    .sort((left, right) => left.order - right.order)
    .map(layer => ({ type: layer.type, params: { ...layer.params } }));
  const input = layers.find(layer => layer.type === 'Input');
  const inputShape = input
    && typeof input.params.inChannels === 'number'
    && typeof input.params.inputHeight === 'number'
    && typeof input.params.inputWidth === 'number'
    ? [input.params.inChannels, input.params.inputHeight, input.params.inputWidth]
    : undefined;
  return {
    epochs: typeof saved.epochs === 'number' ? saved.epochs : 5,
    learningRate: typeof saved.learningRate === 'number' ? saved.learningRate : 0.001,
    batchSize: typeof saved.batchSize === 'number' ? saved.batchSize : 32,
    dataset: dataset.type,
    device: selectedTrainingDevice(gpuState.devices, gpuState.selectedDevice, gpuState.runtimeInfo),
    layers,
    optimizer: saved.optimizer === 'sgd' || saved.optimizer === 'adamw' ? saved.optimizer : 'adam',
    lrScheduler: saved.lrScheduler === 'multistep' || saved.lrScheduler === 'cosine' ? saved.lrScheduler : 'none',
    seed: typeof saved.seed === 'number' ? saved.seed : 42,
    valSplit: typeof saved.valSplit === 'number' ? saved.valSplit : 0.2,
    weightDecay: typeof saved.weightDecay === 'number' ? saved.weightDecay : 0,
    dataPath: datasetState.datasetPath ?? undefined,
    trainRatio: datasetState.trainRatio,
    inputShape,
    splitStrategy: datasetState.splitStrategy,
    groupField: datasetState.groupField ?? undefined,
    timeField: datasetState.timeField ?? undefined,
  };
}

export async function createStudyFromCurrentContext(input: CreateStudyInput): Promise<Study> {
  const name = input.name.trim();
  const question = input.question.trim();
  if (!name || !question) throw new Error('Study 名称和问题不能为空');
  if (input.maxExperiments !== null && input.maxExperiments !== undefined) {
    if (!Number.isInteger(input.maxExperiments) || input.maxExperiments < 1 || input.maxExperiments > 100) {
      throw new Error('实验预算必须是 1 到 100 的整数');
    }
  }
  if (input.maxGpuMinutes !== null && input.maxGpuMinutes !== undefined) {
    if (!Number.isFinite(input.maxGpuMinutes) || input.maxGpuMinutes <= 0 || input.maxGpuMinutes > 100_000) {
      throw new Error('GPU 时间预算必须大于 0 且不超过 100000 分钟');
    }
  }
  const now = Date.now();
  const datasetContract = await snapshotDatasetContract(currentTrainConfig());
  const study: Study = {
    id: createId(),
    protocolVersion: TRUST_PROTOCOL_VERSION,
    name,
    kind: input.kind,
    status: 'draft',
    question,
    datasetContract,
    comparisonKey: comparisonKeyForDatasetContract(datasetContract),
    selectionRule: input.kind === 'free_exploration' ? null : input.selectionRule?.trim() || '手动选择（行为留痕）',
    budget: {
      maxExperiments: input.maxExperiments ?? null,
      maxGpuMinutes: input.maxGpuMinutes ?? null,
    },
    selectedExperimentId: null,
    selectedAttemptId: null,
    createdAt: now,
    updatedAt: now,
    lockedAt: null,
  };
  useExperimentStore.getState().registerStudy(study);
  useExperimentStore.getState().setActiveStudy(study.id);
  useExperimentStore.getState().appendEvent('study', study.id, 'study_created', {
    kind: study.kind,
    comparisonKey: study.comparisonKey,
  }, now);
  return study;
}

/**
 * “删除课题”在可信实验系统中采用归档语义：从活动列表隐藏，但保留 Study 的全部
 * Experiment / Attempt / Claim 与只追加事件。正在运行或暂停的课题必须先结束运行。
 */
export function archiveStudy(studyId: string): Study {
  const state = useExperimentStore.getState();
  const study = state.ledger.studies.find(item => item.id === studyId);
  if (!study) throw new Error('Study 不存在');
  if (study.archivedAt) return study;

  const experimentIds = new Set(state.ledger.experiments
    .filter(item => item.studyId === studyId)
    .map(item => item.id));
  const hasActiveAttempt = state.ledger.attempts.some(item => (
    experimentIds.has(item.experimentId)
    && ['starting', 'running', 'paused'].includes(item.status)
  ));
  if (hasActiveAttempt) throw new Error('该课题仍有运行中或暂停的 Attempt，请先停止训练再删除');

  const now = Date.now();
  const archived: Study = {
    ...study,
    status: 'closed',
    archivedAt: now,
    updatedAt: now,
  };
  state.registerStudy(archived);
  if (state.activeStudyId === studyId) state.setActiveStudy(null);
  state.appendEvent('study', studyId, 'study_archived', {
    retainedExperiments: experimentIds.size,
    retainedAttempts: state.ledger.attempts.filter(item => experimentIds.has(item.experimentId)).length,
    retainedClaims: state.ledger.claims.filter(item => item.studyId === studyId).length,
  }, now);
  return archived;
}

function assertCandidateSelectionMutable(studyId: string): void {
  const claims = useExperimentStore.getState().ledger.claims.filter(claim => claim.studyId === studyId);
  if (claims.length > 0) {
    throw new Error('该候选已被评估主张引用，不能撤回或更换；如需验证其他权重，请新建 Study');
  }
}

/** 手动候选选择必须钉在一次已完成可信 Attempt 上，且首次选择与后续更换分别留痕。 */
export function selectStudyCandidate(studyId: string, attemptId: string): Study {
  const state = useExperimentStore.getState();
  const study = state.ledger.studies.find(item => item.id === studyId);
  if (!study) throw new Error('Study 不存在');
  if (study.kind !== 'candidate_selection') throw new Error('只有候选选择型 Study 可以标记入选方案');
  if (study.archivedAt) throw new Error('已归档 Study 不能修改候选');
  if (study.selectedAttemptId === attemptId) return study;
  assertCandidateSelectionMutable(studyId);
  const attempt = state.ledger.attempts.find(item => item.id === attemptId);
  const experiment = attempt && state.ledger.experiments.find(item => item.id === attempt.experimentId);
  if (!attempt || !experiment || experiment.studyId !== studyId) throw new Error('候选 Attempt 不属于当前 Study');
  if (attempt.status !== 'completed' || attempt.provenance.executionTrust !== 'trusted') {
    throw new Error('只有完整完成的执行可信 Attempt 可以入选');
  }
  const now = Date.now();
  const selected: Study = {
    ...study,
    selectedExperimentId: experiment.id,
    selectedAttemptId: attempt.id,
    updatedAt: now,
  };
  state.registerStudy(selected);
  state.appendEvent('study', study.id, study.selectedAttemptId ? 'candidate_replaced' : 'candidate_selected', {
    experimentId: experiment.id,
    attemptId: attempt.id,
    previousExperimentId: study.selectedExperimentId ?? null,
    previousAttemptId: study.selectedAttemptId ?? null,
    selectionMechanism: 'manual',
    declaredRule: study.selectionRule,
  }, now);
  return selected;
}

/**
 * 候选只在尚未建立主张时可撤回。撤回不删除 Experiment/Attempt，也不抹掉之前的
 * 选择事件；它只清空当前投影，并追加一条反向事件。
 */
export function revokeStudyCandidate(studyId: string): Study {
  const state = useExperimentStore.getState();
  const study = state.ledger.studies.find(item => item.id === studyId);
  if (!study) throw new Error('Study 不存在');
  if (study.kind !== 'candidate_selection') throw new Error('只有候选选择型 Study 存在候选回退');
  if (study.archivedAt) throw new Error('已归档 Study 不能修改候选');
  if (!study.selectedAttemptId || !study.selectedExperimentId) throw new Error('当前 Study 尚未选择候选');
  assertCandidateSelectionMutable(studyId);

  const now = Date.now();
  const revoked: Study = {
    ...study,
    selectedExperimentId: null,
    selectedAttemptId: null,
    updatedAt: now,
  };
  state.registerStudy(revoked);
  state.appendEvent('study', study.id, 'candidate_selection_revoked', {
    previousExperimentId: study.selectedExperimentId,
    previousAttemptId: study.selectedAttemptId,
    selectionMechanism: 'manual',
    declaredRule: study.selectionRule,
  }, now);
  return revoked;
}
