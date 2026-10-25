import type {
  TrainConfig,
  TrainMetric,
  TrainingArtifacts,
  TrainingExecutionMode,
} from './training';

/**
 * 可信实验协议版本。任何不认识的版本都必须失败关闭，不能猜测迁移后授予可信标记。
 */
export const TRUST_PROTOCOL_VERSION = 1 as const;

export type TrustProtocolVersion = typeof TRUST_PROTOCOL_VERSION;
export type ExperimentTaskType = 'image_classification' | 'tabular_regression';
export type StudyKind = 'free_exploration' | 'candidate_selection' | 'controlled_ablation';
export type StudyStatus = 'draft' | 'active' | 'closed';
export type TrustSource = 'controlled' | 'external' | 'legacy';
export type ExecutionTrust = 'trusted' | 'interrupted' | 'unverified';
export type ConclusionTrust = 'not_evaluated' | 'exploratory' | 'iid_only' | 'gold';
export type AttemptStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'paused'
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'cancelled';
export type ResumeType = 'fresh' | 'full_state' | 'weights_only';
export type ClaimStatus = 'draft' | 'frozen' | 'adjudicated' | 'post_hoc';
export type ClaimVerdict = 'pass' | 'fail' | 'inconclusive';
export type ComparisonRelation = 'strict' | 'override' | 'incomparable';
export type SplitStrategy = 'random' | 'group' | 'temporal' | 'predefined';
export type SampleIndependence = 'iid_assumed' | 'user_declared' | 'machine_verified';

export interface MachineCheck {
  check: 'cross_split_exact_duplicate' | 'group_disjoint' | 'temporal_order';
  status: 'passed' | 'failed' | 'not_run';
  details?: string;
}

export interface DatasetIdentity {
  id: string;
  name: string;
  taskType: ExperimentTaskType;
  /** 文件内容与相对路径共同形成的 SHA-256；内置数据集使用带版本的固定身份。 */
  contentHash: string | null;
  fingerprintAlgorithm: 'sha256-v1' | 'builtin-version-v1' | 'missing';
  sampleCount: number;
  classCount?: number;
  classNames?: string[];
  importedAt: number;
  /** 表格任务问题定义；旧档案可缺失并因此保持未验证。 */
  targetField?: string;
  featureFields?: string[];
}

export interface SplitContract {
  strategy: SplitStrategy;
  seed: number | null;
  validationRatio: number;
  testRatio: number;
  groupField?: string;
  timeField?: string;
  sampleUnit: string | null;
  independence: SampleIndependence;
  userDeclaration?: string;
  machineChecks: MachineCheck[];
  /** 切分后各集合成员身份的稳定摘要；缺失时不能获得严格可比资格。 */
  splitHash: string | null;
}

export interface PreprocessingContract {
  /** 稳定序列化后的预处理配置摘要；自由文本不能作为严格可比依据。 */
  configHash: string | null;
  summary: string;
}

export interface DatasetContract {
  identity: DatasetIdentity;
  split: SplitContract;
  preprocessing: PreprocessingContract;
}

export interface StudyBudget {
  maxExperiments: number | null;
  maxGpuMinutes: number | null;
}

export interface Study {
  id: string;
  protocolVersion: TrustProtocolVersion;
  name: string;
  kind: StudyKind;
  status: StudyStatus;
  question: string;
  datasetContract: DatasetContract;
  comparisonKey: string | null;
  selectionRule: string | null;
  budget: StudyBudget;
  /** 候选选择是一次留痕行为；Experiment 表示方案，Attempt 钉死最终权重。 */
  selectedExperimentId?: string | null;
  selectedAttemptId?: string | null;
  createdAt: number;
  updatedAt: number;
  /** 首个 attempt 启动后写入；此后 kind 与数据契约不可原地改写。 */
  lockedAt: number | null;
  /** 用户从活动列表删除后的归档时间；证据链仍保留，不能物理抹除可信历史。 */
  archivedAt?: number | null;
}

export interface Experiment {
  id: string;
  protocolVersion: TrustProtocolVersion;
  studyId: string;
  name: string;
  config: TrainConfig;
  configHash: string;
  baselineExperimentId?: string;
  /** 由机器对稳定配置快照生成；bundle 必须完整展示，不能只命名其中一个组件。 */
  differenceFromBaseline?: string[];
  createdAt: number;
}

export interface RuntimeEnvironment {
  applicationVersion: string;
  torchVersion: string | null;
  pythonVersion: string | null;
  device: string;
  cudaVersion: string | null;
}

export interface AttemptProvenance {
  source: TrustSource;
  executionTrust: ExecutionTrust;
  environment: RuntimeEnvironment;
  datasetContentHash: string | null;
  splitPolicyHash?: string | null;
  splitAssignmentHash?: string | null;
  splitHash: string | null;
  testSetHash: string | null;
  machineChecks: MachineCheck[];
  testSampleCount: number | null;
  splitSampleCounts?: { train: number; validation: number; test: number } | null;
  testLabelCounts: Record<string, number> | null;
  testTargetSummary: { count: number; mean: number; variance: number; min: number; max: number } | null;
  preprocessingHash: string | null;
  preprocessingPolicyHash?: string | null;
  fittedPreprocessingHash?: string | null;
  preprocessingParameters: Record<string, unknown> | null;
  configHash: string;
  modelWeightsHash: string | null;
  witnessedByPipeline: boolean;
  executionWitnessed?: boolean;
  protocolConsistent?: boolean;
  artifactsVerified?: boolean;
  reproducibilityVerified?: boolean;
  overallTrust?: 'unverified' | 'controlled_only' | 'reproduced';
}

export interface Attempt {
  id: string;
  protocolVersion: TrustProtocolVersion;
  experimentId: string;
  runId: string;
  /** 本次 attempt 实际写入的独立权重文件身份；重启会生成新 modelId，不能从 Experiment 反推。 */
  modelId: string | null;
  /** 本次执行的完整配置快照；seed/device 等 Attempt 级变量不能从 Experiment 反推。 */
  config: TrainConfig;
  ordinal: number;
  parentAttemptId: string | null;
  restartCount: number;
  resumeType: ResumeType;
  status: AttemptStatus;
  startedAt: number | null;
  endedAt: number | null;
  provenance: AttemptProvenance;
  metrics: TrainMetric[];
  artifacts: TrainingArtifacts | null;
  executionMode: TrainingExecutionMode;
  interruptionReason?: string;
}

export type MetricName =
  | 'accuracy'
  | 'recall'
  | 'precision'
  | 'false_positive_rate'
  | 'macro_f1'
  | 'mae'
  | 'rmse'
  | 'r2';

export type IntervalMethod = 'wilson' | 'clopper_pearson' | 'seeded_bootstrap';

export interface ClaimPredicate {
  id: string;
  role: 'primary' | 'guardrail';
  metric: MetricName;
  operator: 'gte' | 'lte';
  threshold: number;
  targetClass?: string;
  aggregation?: 'binary' | 'macro' | 'micro' | 'weighted';
  decisionThreshold?: number;
  confidenceLevel: number;
  intervalMethod: IntervalMethod;
  minimumEffectiveSampleSize: number;
  bootstrapSamples?: number;
  bootstrapSeed?: number;
}

export interface PredicateResult {
  predicateId: string;
  pointEstimate: number;
  lowerBound: number;
  upperBound: number;
  effectiveSampleSize: number;
  /** 多子句主张经过 Bonferroni 调整后的实际区间置信水平。 */
  confidenceLevel: number;
  verdict: ClaimVerdict;
}

export interface ClassificationDiagnostics {
  classIndices: number[];
  classLabels: string[];
  /** 稀疏混淆矩阵，避免类别多时制造平方级事件载荷。 */
  entries: Array<{ actual: number; predicted: number; count: number }>;
  perClassRecall: Array<{ classIndex: number; label: string; support: number; recall: number | null }>;
}

export interface ClaimEvaluationPayload {
  claimId: string;
  frozenHash: string;
  taskType: ExperimentTaskType;
  modelWeightsHash: string;
  testSetHash: string;
  preprocessingHash: string;
  /** 分类任务在解封前冻结的完整类别数；macro-F1 不得按观察结果事后缩小类别全集。 */
  classCount?: number;
  targets: number[];
  predictions: number[];
  /** 二分类/目标类阈值使用；多分类 Top-1 可缺失。 */
  scores?: number[];
}

export interface EvaluationClaim {
  id: string;
  protocolVersion: TrustProtocolVersion;
  studyId: string;
  attemptId: string;
  modelWeightsHash: string;
  testDatasetHash: string;
  preprocessingHash: string;
  status: ClaimStatus;
  /** 草稿每次保存递增；完整版本内容同时写入只追加事件。 */
  revision: number;
  predicates: ClaimPredicate[];
  frozenHash: string | null;
  frozenAt: number | null;
  unsealSequence: number | null;
  adjudicatedAt: number | null;
  verdict: ClaimVerdict | null;
  predicateResults: PredicateResult[];
  classificationDiagnostics: ClassificationDiagnostics | null;
  conclusionTrust: ConclusionTrust;
  createdAt: number;
  updatedAt: number;
}

export type LedgerEntityType = 'dataset' | 'study' | 'experiment' | 'attempt' | 'claim';

export interface LedgerEvent {
  eventId: string;
  protocolVersion: TrustProtocolVersion;
  sequence: number;
  occurredAt: number;
  entityType: LedgerEntityType;
  entityId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface ExperimentLedgerV1 {
  protocolVersion: TrustProtocolVersion;
  /** 每个本地状态实例独享的只追加审计流身份，避免与旧安装/重置状态串号。 */
  ledgerId: string;
  studies: Study[];
  experiments: Experiment[];
  attempts: Attempt[];
  claims: EvaluationClaim[];
  events: LedgerEvent[];
}
