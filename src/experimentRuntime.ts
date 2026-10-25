import { useDatasetStore } from '@/stores/useDatasetStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import {
  TRUST_PROTOCOL_VERSION,
  type Attempt,
  type AttemptStatus,
  type DatasetContract,
  type RuntimeEnvironment,
} from '@/types/experiment';
import type {
  TrainConfig,
  TrainMetric,
  TrainingArtifacts,
  TrainingCompletionProvenance,
  TrainingExecutionMode,
} from '@/types/training';
import {
  localGroupingKey,
  lockStudyForFirstAttempt,
  sha256ProtocolValue,
} from '@/utils/experimentProtocol';
import { diffTrainingConfigs, studyUsedGpuMinutes } from '@/utils/studyProtocol';
import { deriveCsvFeatureFieldsFromColumns } from '@/utils/datasetContract';

function createId(prefix: string): string {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function configFingerprintInput(config: TrainConfig): Record<string, unknown> {
  const {
    runId: _runId,
    attemptId: _attemptId,
    parentAttemptId: _parentAttemptId,
    restartCount: _restartCount,
    resumeType: _resumeType,
    studyId: _studyId,
    experimentId: _experimentId,
    modelId: _modelId,
    configHash: _configHash,
    ...reproducibleConfig
  } = config;
  return {
    ...reproducibleConfig,
    // 场景 UUID 只用于错误定位，不是模型语义；重建同构积木不能凭 ID 变成新方案。
    layers: reproducibleConfig.layers.map(layer => ({ type: layer.type, params: layer.params })),
  };
}

function experimentDesignFingerprintInput(config: TrainConfig): Record<string, unknown> {
  const reproducible = configFingerprintInput(config);
  const { seed: _seed, device: _device, ...design } = reproducible;
  return design;
}

function assertPairedAblationSeed(baselineExperimentId: string, seed: number | null | undefined): void {
  if (!Number.isInteger(seed)) throw new Error('对照消融必须固定整数 seed，才能建立配对证据');
  const hasTrustedPair = useExperimentStore.getState().ledger.attempts.some(attempt => (
    attempt.experimentId === baselineExperimentId
    && attempt.status === 'completed'
    && attempt.provenance.executionTrust === 'trusted'
    && attempt.config.seed === seed
  ));
  if (!hasTrustedPair) {
    throw new Error(`消融候选 seed=${seed} 尚无同 seed 的可信基线 Attempt；请先完成基线配对运行`);
  }
}

export async function snapshotDatasetContract(config: TrainConfig): Promise<DatasetContract> {
  const datasetState = useDatasetStore.getState();
  const info = datasetState.datasetInfo;
  const datasetName = info?.name ?? config.dataset;
  const isBuiltin = config.dataset === 'mnist' || config.dataset === 'cifar10';
  const splitStrategy = isBuiltin
    ? 'predefined'
    : config.splitStrategy ?? datasetState.splitStrategy ?? 'random';
  const groupField = config.groupField ?? datasetState.groupField ?? undefined;
  const timeField = config.timeField ?? datasetState.timeField ?? undefined;
  const targetField = config.targetField ?? datasetState.targetField ?? undefined;
  // config.featureFields 缺失时的回退推导：必须与 Preflight / 数据集工作台共用
  // datasetContract 单一来源；只排除当前策略实际激活的元数据字段，
  // 不得错误排除未激活的 group/time 字段。
  const featureFields = config.featureFields
    ?? (config.dataset === 'csv' && info?.columns && targetField
      ? deriveCsvFeatureFieldsFromColumns(info.columns, {
        splitStrategy: splitStrategy === 'group' || splitStrategy === 'temporal'
          ? splitStrategy
          : 'random',
        groupField: groupField ?? null,
        timeField: timeField ?? null,
        targetField,
      })
      : undefined);
  const contentHash = info?.contentHash
    ?? (isBuiltin ? `builtin:${config.dataset}:torchvision-v1` : null);
  const testRatio = config.dataset === 'mnist'
    ? 10_000 / 70_000
    : config.dataset === 'cifar10'
      ? 10_000 / 60_000
      : 1 - (config.trainRatio ?? 0.8);
  const preprocessingHash = config.preprocessingHash
    ?? await sha256ProtocolValue({
      dataset: config.dataset,
      inputShape: config.inputShape ?? null,
      targetField: targetField ?? null,
      featureFields: featureFields ?? null,
      normalization: config.dataset === 'mnist'
        ? { mean: [0.1307], std: [0.3081] }
        : config.dataset === 'cifar10'
          ? { mean: [0.4914, 0.4822, 0.4465], std: [0.2470, 0.2435, 0.2616] }
          : config.dataset === 'csv'
            ? 'standard-scaler-fit-on-train-only-v1'
            : 'runtime-defined',
    });
  const splitHash = config.splitHash
    ?? (contentHash
      ? await sha256ProtocolValue({
        contentHash,
        strategy: splitStrategy,
        seed: config.seed ?? 42,
        validationRatio: config.valSplit ?? 0,
        testRatio,
        groupField,
        timeField,
        targetField,
        featureFields,
      })
      : null);

  return {
    identity: {
      id: info?.datasetId ?? createId('dataset'),
      name: datasetName,
      taskType: config.dataset === 'csv' ? 'tabular_regression' : 'image_classification',
      contentHash,
      fingerprintAlgorithm: isBuiltin ? 'builtin-version-v1' : contentHash ? 'sha256-v1' : 'missing',
      sampleCount: info?.sampleCount ?? 0,
      classCount: info?.classCount,
      classNames: info?.classNames ? [...info.classNames] : undefined,
      importedAt: info?.importedAt ?? Date.now(),
      targetField,
      featureFields: featureFields ? [...featureFields] : undefined,
    },
    split: {
      strategy: splitStrategy,
      seed: config.seed ?? 42,
      validationRatio: config.valSplit ?? 0,
      testRatio,
      groupField,
      timeField,
      sampleUnit: info?.sampleUnit ?? (config.dataset === 'csv' ? 'row' : 'image'),
      independence: info?.sampleIndependence ?? 'iid_assumed',
      userDeclaration: info?.sampleUnitDeclaration,
      machineChecks: info?.machineChecks ?? [],
      splitHash,
    },
    preprocessing: {
      configHash: preprocessingHash,
      summary: `dataset=${config.dataset}; input=${config.inputShape?.join('x') ?? 'runtime'}${targetField ? `; target=${targetField}; features=${featureFields?.join('|') ?? ''}` : ''}`,
    },
  };
}

export function comparisonKeyForDatasetContract(datasetContract: DatasetContract): string | null {
  if (
    !datasetContract.identity.contentHash
    || !datasetContract.split.splitHash
    || !datasetContract.preprocessing.configHash
  ) return null;
  return localGroupingKey({
    taskType: datasetContract.identity.taskType,
    datasetContentHash: datasetContract.identity.contentHash,
    // Study 是多个 seed 分层的容器；严格对比仍使用 Attempt 的实际 splitHash。
    // 这里冻结切分规则而非单个 seed，才能在同一 Study 内形成配对多 seed 证据。
    splitProtocol: {
      strategy: datasetContract.split.strategy,
      validationRatio: datasetContract.split.validationRatio,
      testRatio: datasetContract.split.testRatio,
      groupField: datasetContract.split.groupField ?? null,
      timeField: datasetContract.split.timeField ?? null,
      sampleUnit: datasetContract.split.sampleUnit,
      targetField: datasetContract.identity.targetField ?? null,
      featureFields: datasetContract.identity.featureFields ?? null,
    },
    preprocessingHash: datasetContract.preprocessing.configHash,
    metricSemantics: datasetContract.identity.taskType === 'tabular_regression'
      ? ['mae', 'rmse', 'r2']
      : ['accuracy', 'recall', 'precision', 'macro_f1'],
  });
}

export async function prepareTrainingAttempt(
  initialConfig: TrainConfig & { runId: string },
  mode: TrainingExecutionMode,
): Promise<TrainConfig & { runId: string; attemptId: string; experimentId: string; studyId: string }> {
  const now = Date.now();
  const effectiveConfig: TrainConfig & { runId: string } = {
    ...initialConfig,
    splitStrategy: initialConfig.dataset === 'mnist' || initialConfig.dataset === 'cifar10'
      ? 'predefined'
      : initialConfig.splitStrategy,
  };
  if (effectiveConfig.resumeType && effectiveConfig.resumeType !== 'fresh') {
    throw new Error('当前版本尚未见证完整状态续训或仅权重恢复；只能以 fresh 新建 Attempt');
  }
  const datasetContract = await snapshotDatasetContract(effectiveConfig);
  const comparisonKey = comparisonKeyForDatasetContract(datasetContract);

  const ledgerState = useExperimentStore.getState();
  const activeStudyId = effectiveConfig.studyId ?? ledgerState.activeStudyId ?? undefined;
  let study = activeStudyId
    ? ledgerState.ledger.studies.find(item => item.id === activeStudyId)
    : ledgerState.ledger.studies.find(item => (
      item.status === 'draft'
      && !item.archivedAt
      && item.kind === 'free_exploration'
      && item.comparisonKey === comparisonKey
    ));
  if (!study) {
    study = {
      id: createId('study'),
      protocolVersion: TRUST_PROTOCOL_VERSION,
      name: `自由探索 · ${datasetContract.identity.name}`,
      kind: 'free_exploration',
      status: 'draft',
      question: '快速训练产生的描述性观察',
      datasetContract,
      comparisonKey,
      selectionRule: null,
      budget: { maxExperiments: null, maxGpuMinutes: null },
      selectedExperimentId: null,
      selectedAttemptId: null,
      createdAt: now,
      updatedAt: now,
      lockedAt: null,
    };
    useExperimentStore.getState().registerStudy(study);
  } else if (study.archivedAt) {
    throw new Error('该 Study 已归档，请选择活动课题或新建 Study');
  } else if (study.comparisonKey !== comparisonKey) {
    throw new Error('当前数据、切分或预处理与活动 Study 不一致；请切回匹配配置或新建 Study');
  }

  if (study.budget.maxGpuMinutes !== null) {
    const experimentIds = new Set(ledgerState.ledger.experiments
      .filter(item => item.studyId === study!.id)
      .map(item => item.id));
    // GPU 分钟计算共用 studyProtocol.studyUsedGpuMinutes，UI 展示不得另实现一套。
    const usedMinutes = studyUsedGpuMinutes(
      ledgerState.ledger.attempts.filter(item => experimentIds.has(item.experimentId)),
      now,
    );
    if (usedMinutes >= study.budget.maxGpuMinutes) {
      throw new Error(`Study 已消耗 ${usedMinutes.toFixed(1)} GPU 分钟，达到 ${study.budget.maxGpuMinutes} 分钟预算上限`);
    }
  }

  const configHash = effectiveConfig.configHash ?? await sha256ProtocolValue(configFingerprintInput(effectiveConfig));
  const designHash = await sha256ProtocolValue(experimentDesignFingerprintInput(effectiveConfig));
  let experiment = effectiveConfig.experimentId
    ? useExperimentStore.getState().ledger.experiments.find(item => item.id === effectiveConfig.experimentId)
    : useExperimentStore.getState().ledger.experiments.find(item => (
      item.studyId === study!.id && item.configHash === designHash
    ));
  if (!experiment) {
    const studyExperiments = useExperimentStore.getState().ledger.experiments
      .filter(item => item.studyId === study!.id);
    if (
      study.budget.maxExperiments !== null
      && studyExperiments.length >= study.budget.maxExperiments
    ) {
      throw new Error(`Study 已达到最多 ${study.budget.maxExperiments} 个实验的预算上限`);
    }
    const baseline = study.kind === 'controlled_ablation' ? studyExperiments[0] : undefined;
    if (baseline) assertPairedAblationSeed(baseline.id, effectiveConfig.seed);
    experiment = {
      id: createId('experiment'),
      protocolVersion: TRUST_PROTOCOL_VERSION,
      studyId: study.id,
      name: effectiveConfig.layers.map(layer => layer.type).slice(0, 5).join(' → ') || '未命名方案',
      config: { ...effectiveConfig, configHash },
      configHash: designHash,
      baselineExperimentId: baseline?.id,
      differenceFromBaseline: baseline ? diffTrainingConfigs(baseline.config, effectiveConfig) : [],
      createdAt: now,
    };
    useExperimentStore.getState().registerExperiment(experiment);
  }
  if (study.kind === 'controlled_ablation') {
    if (!Number.isInteger(effectiveConfig.seed)) throw new Error('对照消融必须固定整数 seed');
    const baseline = useExperimentStore.getState().ledger.experiments.find(item => item.studyId === study!.id);
    if (baseline && experiment.id !== baseline.id) assertPairedAblationSeed(baseline.id, effectiveConfig.seed);
  }

  const attemptId = effectiveConfig.attemptId ?? createId('attempt');
  const siblingAttempts = useExperimentStore.getState().ledger.attempts
    .filter(item => item.experimentId === experiment!.id);
  const runtimeEnvironment: RuntimeEnvironment = {
    applicationVersion: '0.1.0',
    torchVersion: null,
    pythonVersion: null,
    device: effectiveConfig.device,
    cudaVersion: null,
  };
  const attemptConfig: TrainConfig & { runId: string; attemptId: string; experimentId: string; studyId: string } = {
    ...effectiveConfig,
    attemptId,
    experimentId: experiment.id,
    studyId: study.id,
    datasetContentHash: datasetContract.identity.contentHash ?? undefined,
    splitPolicyHash: datasetContract.split.splitHash ?? undefined,
    preprocessingPolicyHash: datasetContract.preprocessing.configHash ?? undefined,
    // v1 兼容字段仍保留，但新档案必须读取上面的 policy 字段判断语义。
    splitHash: datasetContract.split.splitHash ?? undefined,
    preprocessingHash: datasetContract.preprocessing.configHash ?? undefined,
    configHash,
  };
  const attempt: Attempt = {
    id: attemptId,
    protocolVersion: TRUST_PROTOCOL_VERSION,
    experimentId: experiment.id,
    runId: effectiveConfig.runId,
    modelId: effectiveConfig.modelId ?? null,
    config: attemptConfig,
    ordinal: siblingAttempts.length + 1,
    parentAttemptId: effectiveConfig.parentAttemptId ?? null,
    restartCount: effectiveConfig.restartCount ?? 0,
    resumeType: effectiveConfig.resumeType ?? 'fresh',
    status: 'pending',
    startedAt: null,
    endedAt: null,
    provenance: {
      source: mode === 'native' ? 'controlled' : 'external',
      executionTrust: 'unverified',
      environment: runtimeEnvironment,
      datasetContentHash: datasetContract.identity.contentHash,
      splitPolicyHash: datasetContract.split.splitHash,
      splitAssignmentHash: null,
      splitHash: datasetContract.split.splitHash,
      testSetHash: null,
      machineChecks: [],
      testSampleCount: null,
      splitSampleCounts: null,
      testLabelCounts: null,
      testTargetSummary: null,
      preprocessingHash: datasetContract.preprocessing.configHash,
      preprocessingPolicyHash: datasetContract.preprocessing.configHash,
      fittedPreprocessingHash: null,
      preprocessingParameters: { declared: datasetContract.preprocessing.summary },
      configHash,
      modelWeightsHash: null,
      witnessedByPipeline: mode === 'native',
      executionWitnessed: mode === 'native',
      protocolConsistent: false,
      artifactsVerified: false,
      reproducibilityVerified: false,
      overallTrust: 'unverified',
    },
    metrics: [],
    artifacts: null,
    executionMode: mode,
  };
  useExperimentStore.getState().registerAttempt(attempt);
  useExperimentStore.getState().registerStudy(lockStudyForFirstAttempt(study, now));
  useExperimentStore.getState().transitionAttemptStatus(attemptId, 'starting', now);
  useExperimentStore.getState().appendEvent('attempt', attemptId, 'attempt_started', {
    runId: effectiveConfig.runId,
    studyId: study.id,
    experimentId: experiment.id,
    modelId: attempt.modelId,
    configHash: attempt.provenance.configHash,
    datasetContentHash: attempt.provenance.datasetContentHash,
    splitPolicyHash: attempt.provenance.splitPolicyHash,
    preprocessingPolicyHash: attempt.provenance.preprocessingPolicyHash,
    seed: attempt.config.seed ?? null,
    requestedDevice: attempt.config.device,
    resumeType: attempt.resumeType,
    parentAttemptId: attempt.parentAttemptId,
    restartCount: attempt.restartCount,
  }, now);

  return attemptConfig;
}

export function transitionRuntimeAttempt(attemptId: string | undefined, status: AttemptStatus): void {
  if (!attemptId) return;
  useExperimentStore.getState().transitionAttemptStatus(attemptId, status, Date.now());
  useExperimentStore.getState().appendEvent('attempt', attemptId, `attempt_${status}`);
}

/** 暂停时把当前部分轨迹固化到 Attempt 快照；它仍不具备候选/严格对比资格。 */
export function checkpointRuntimeAttemptMetrics(
  attemptId: string | undefined,
  metrics: TrainMetric[],
): void {
  if (!attemptId) return;
  useExperimentStore.getState().checkpointAttemptMetrics(attemptId, metrics);
}

function appendMetricChunks(
  attemptId: string,
  eventType: 'attempt_metrics_recorded' | 'attempt_partial_metrics_recorded',
  metrics: TrainMetric[],
): void {
  const chunks = Array.from({ length: Math.ceil(metrics.length / 250) }, (_value, index) => (
    metrics.slice(index * 250, (index + 1) * 250)
  ));
  chunks.forEach((chunk, chunkIndex) => {
    useExperimentStore.getState().appendEvent('attempt', attemptId, eventType, {
      chunkIndex,
      totalChunks: chunks.length,
      metrics: chunk,
    });
  });
}

export function finishRuntimeAttempt(
  attemptId: string | undefined,
  metrics: TrainMetric[],
  artifacts: TrainingArtifacts,
  completion: TrainingCompletionProvenance,
): void {
  if (!attemptId) return;
  const pendingAttempt = useExperimentStore.getState().ledger.attempts.find(item => item.id === attemptId);
  if (!pendingAttempt) return;
  const splitAssignmentHash = completion.splitAssignmentHash ?? completion.splitHash ?? null;
  const fittedPreprocessingHash = completion.fittedPreprocessingHash ?? completion.preprocessingHash ?? null;
  const protocolConsistent = Boolean(
    completion.attemptId === attemptId
    && completion.datasetContentHash
    && completion.datasetContentHash === pendingAttempt.config.datasetContentHash
    && completion.splitPolicyHash
    && completion.splitPolicyHash === pendingAttempt.config.splitPolicyHash
    && completion.preprocessingPolicyHash
    && completion.preprocessingPolicyHash === pendingAttempt.config.preprocessingPolicyHash
    && splitAssignmentHash
    && fittedPreprocessingHash
    && completion.modelWeightsHash
  );
  const artifactsVerified = completion.artifactsVerified === true
    && artifacts.weights && artifacts.fullModel && artifacts.numpy && artifacts.perModel;
  const executionWitnessed = pendingAttempt.provenance.source === 'controlled'
    && pendingAttempt.provenance.witnessedByPipeline;
  useExperimentStore.getState().transitionAttemptStatus(attemptId, 'completed', Date.now(), {
    metrics: [...metrics],
    artifacts: { ...artifacts },
    provenance: {
      modelWeightsHash: completion.modelWeightsHash,
      datasetContentHash: completion.datasetContentHash ?? undefined,
      splitPolicyHash: completion.splitPolicyHash ?? pendingAttempt.provenance.splitPolicyHash ?? null,
      splitAssignmentHash,
      splitHash: splitAssignmentHash,
      testSetHash: completion.testSetHash ?? null,
      testSampleCount: completion.testSampleCount ?? null,
      splitSampleCounts: completion.splitSampleCounts ?? null,
      testLabelCounts: completion.testLabelCounts ?? null,
      testTargetSummary: completion.testTargetSummary ?? null,
      preprocessingPolicyHash: completion.preprocessingPolicyHash ?? pendingAttempt.provenance.preprocessingPolicyHash ?? null,
      fittedPreprocessingHash,
      preprocessingHash: fittedPreprocessingHash,
      preprocessingParameters: completion.preprocessingParameters ?? null,
      machineChecks: completion.machineChecks ?? [],
      executionWitnessed,
      protocolConsistent,
      artifactsVerified,
      reproducibilityVerified: false,
      overallTrust: executionWitnessed && protocolConsistent && artifactsVerified
        ? 'controlled_only'
        : 'unverified',
      environment: {
        applicationVersion: completion.environment.applicationVersion ?? '0.1.0',
        torchVersion: completion.environment.torchVersion,
        pythonVersion: completion.environment.pythonVersion,
        device: completion.environment.device,
        cudaVersion: completion.environment.cudaVersion,
      },
    },
  });
  const attempt = useExperimentStore.getState().ledger.attempts.find(item => item.id === attemptId);
  if (completion.machineChecks) {
    useDatasetStore.getState().updateMachineChecks(completion.machineChecks);
  }
  appendMetricChunks(attemptId, 'attempt_metrics_recorded', metrics);
  useExperimentStore.getState().appendEvent('attempt', attemptId, 'attempt_completed', {
    executionTrust: attempt?.provenance.executionTrust ?? 'unverified',
    modelWeightsHash: completion.modelWeightsHash,
    datasetContentHash: completion.datasetContentHash ?? null,
    splitPolicyHash: completion.splitPolicyHash ?? null,
    splitAssignmentHash,
    testSetHash: completion.testSetHash ?? null,
    preprocessingPolicyHash: completion.preprocessingPolicyHash ?? null,
    fittedPreprocessingHash,
    trustAxes: {
      executionWitnessed,
      protocolConsistent,
      artifactsVerified,
      reproducibilityVerified: false,
    },
    testSampleCount: completion.testSampleCount ?? null,
    splitSampleCounts: completion.splitSampleCounts ?? null,
    testLabelCounts: completion.testLabelCounts ?? null,
    testTargetSummary: completion.testTargetSummary ?? null,
    machineChecks: completion.machineChecks ?? [],
    environment: completion.environment,
    artifacts,
    metricCount: metrics.length,
  });
}

export function terminateRuntimeAttempt(
  attemptId: string | undefined,
  status: Extract<AttemptStatus, 'interrupted' | 'failed' | 'cancelled'>,
  metrics: TrainMetric[],
  reason: string,
): void {
  if (!attemptId) return;
  useExperimentStore.getState().transitionAttemptStatus(attemptId, status, Date.now(), {
    metrics: [...metrics],
    interruptionReason: reason,
  });
  appendMetricChunks(attemptId, 'attempt_partial_metrics_recorded', metrics);
  useExperimentStore.getState().appendEvent('attempt', attemptId, `attempt_${status}`, { reason });
}
