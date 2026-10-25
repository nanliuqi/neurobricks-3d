import type { LayerType, LayerParams } from './layer';

/** QuickTrain 与实验导出共享的持久化键，避免两处字符串漂移导致导出读取默认值。 */
export const TRAIN_CONFIG_STORAGE_KEY = 'neurobricks_train_config';

/**
 * 优化器类型
 */
export type OptimizerType = 'sgd' | 'adam' | 'adamw';

/**
 * 学习率调度器类型：none（不调度）/ multistep（阶梯衰减）/ cosine（余弦退火）
 */
export type LrSchedulerType = 'none' | 'multistep' | 'cosine';

/** 训练实际执行方式。simulation 仅用于纯浏览器演示，不能生成可推理模型。 */
export type TrainingExecutionMode = 'native' | 'simulation';
export type TrainingMetricName = 'accuracy' | 'mae';

/** 可展示给用户并用于决定恢复策略的错误分类。 */
export type TrainingErrorKind = 'preflight' | 'startup' | 'runtime' | 'crashed' | 'hung' | 'control';

/** 一次真实训练实际落盘成功的产物；UI 只能据此开放推理/导出。 */
export interface TrainingArtifacts {
  weights: boolean;
  fullModel: boolean;
  numpy: boolean;
  perModel: boolean;
}

/**
 * 训练配置接口
 * 定义神经网络训练的超参数和网络结构
 */
export interface TrainConfig {
  /** train 为受控训练；evaluate_claim 只读取封存测试集并输出原始预测。 */
  mode?: 'train' | 'evaluate_claim';
  evaluationClaim?: {
    claimId: string;
    frozenHash: string;
    modelWeightsHash: string;
    testSetHash: string;
    taskType: 'image_classification' | 'tabular_regression';
    classCount?: number;
  };
  /** 单次训练运行标识；用于拒绝过期进程事件污染当前训练。 */
  runId?: string;
  /** 可信实验中的业务执行标识；进程重启必须换新 attemptId。 */
  attemptId?: string;
  /** 从头重跑或恢复时指向上一 attempt，保留执行谱系。 */
  parentAttemptId?: string;
  restartCount?: number;
  resumeType?: 'fresh' | 'full_state' | 'weights_only';
  studyId?: string;
  experimentId?: string;
  datasetContentHash?: string;
  /** 冻结的切分规则身份；不等同于本次 seed 产生的样本分配。 */
  splitPolicyHash?: string;
  /** 冻结的预处理规则身份；不包含训练集拟合出的 mean/std。 */
  preprocessingPolicyHash?: string;
  /** eval-only 兼容字段：受控训练完成后实际样本分配哈希。 */
  splitHash?: string;
  /** eval-only 兼容字段：受控训练完成后拟合预处理哈希。 */
  preprocessingHash?: string;
  configHash?: string;
  splitStrategy?: 'random' | 'group' | 'temporal' | 'predefined';
  groupField?: string;
  timeField?: string;
  /** CSV 监督目标列；必须由用户显式确认。 */
  targetField?: string;
  /** 按冻结顺序送入 MLP 的 CSV 特征列。 */
  featureFields?: string[];
  /** 训练轮数（epochs） */
  epochs: number;
  /** 学习率 */
  learningRate: number;
  /** 批次大小 */
  batchSize: number;
  /** 数据集标识或路径 */
  dataset: string;
  /** 计算设备（如 'cpu', 'cuda:0', 'mps'） */
  device: string;
  /** 网络层配置列表 */
  layers: Array<{
    /** 场景层身份；错误报告用它精确定位积木。 */
    id?: string;
    /** 层类型 */
    type: LayerType;
    /** 层参数 */
    params: LayerParams;
  }>;
  /** 优化器类型 */
  optimizer?: OptimizerType;
  /** SGD 动量（仅 optimizer=sgd 时生效，后端默认 0.9） */
  momentum?: number;
  /** 学习率调度器（后端默认 none） */
  lrScheduler?: LrSchedulerType;
  /** 随机种子：固定后同配置同结果（后端默认 42；null 表示不固定） */
  seed?: number | null;
  /** 验证集比例（0~0.5；受控训练要求 > 0，测试集仅允许 eval-only 解封） */
  valSplit?: number;
  /** 权重衰减（L2 正则化） */
  weightDecay?: number;
  /** 自定义数据集路径（local_image/csv 时使用） */
  dataPath?: string;
  /** 训练集比例（0.5~0.9） */
  trainRatio?: number;
  /** Input 层形状 [C, H, W]：Python 端 local_image 数据集据此 Resize / 灰度化，使数据与模型输入一致 */
  inputShape?: number[];
  /** 模型唯一标识：Python 端据此另存权重到 ~/.neurobricks/models/<modelId>.pth，支持多模型卡片化推理 */
  modelId?: string;
}

/**
 * 训练指标
 * 记录每个训练步骤的性能指标
 */
export interface TrainMetric {
  /** Attempt 内唯一记录 ID；旧档案可缺失。 */
  recordId?: string;
  /** 当前 epoch 编号 */
  epoch: number;
  /** 当前 step 编号 */
  step: number;
  globalStep?: number;
  split?: 'train' | 'validation' | 'test';
  scope?: 'batch' | 'epoch' | 'evaluation';
  /** 损失值 */
  loss: number;
  lossName?: 'cross_entropy' | 'mse';
  lossValue?: number;
  /** 准确率 */
  accuracy: number;
  /** 明确数字语义。旧 sidecar 缺失时按 accuracy 解释。 */
  metricName?: TrainingMetricName;
  metricValue?: number;
  optimizationDirection?: 'maximize' | 'minimize';
  sampleCount?: number;
  /** 时间戳（毫秒） */
  timestamp: number;
}

/**
 * 进度消息
 * 用于 Tauri 事件通信，传递实时训练进度
 */
export interface ProgressMessage {
  runId: string;
  /** 消息类型标识 */
  type: 'progress';
  /** 当前 epoch 编号 */
  epoch: number;
  /** 当前 step 编号 */
  step: number;
  /** 损失值 */
  loss: number;
  /** 准确率 */
  accuracy?: number;
  metricName?: 'accuracy' | 'mae';
  metricValue?: number;
  split?: 'train';
  scope?: 'batch';
}

/**
 * Epoch 结束消息
 * 在每个 epoch 完成后发送，包含汇总统计
 */
export interface EpochEndMessage {
  runId: string;
  /** 消息类型标识 */
  type: 'epoch_end';
  /** 完成的 epoch 编号 */
  epoch: number;
  /** 训练集损失 */
  trainLoss: number;
  /** 验证集准确率 */
  valAccuracy?: number;
  valMetricName?: 'accuracy' | 'mae';
  valMetric?: number;
  metricName?: 'accuracy' | 'mae';
  metricValue?: number;
  split?: 'validation';
  scope?: 'epoch';
}

/**
 * 训练完成消息
 * 在所有 epoch 完成后发送
 */
export interface DoneMessage {
  runId: string;
  /** 消息类型标识 */
  type: 'done';
  /** 最终准确率 */
  finalAccuracy?: number;
  finalMetricName?: 'accuracy' | 'mae';
  finalMetric?: number;
  /** 各格式是否确实保存成功。旧 sidecar 可能缺失，运行时做兼容处理。 */
  artifacts?: TrainingArtifacts;
  provenance?: TrainingCompletionProvenance;
}

export interface TrainingCompletionProvenance {
  attemptId: string | null;
  modelWeightsHash: string | null;
  datasetContentHash?: string | null;
  splitPolicyHash?: string | null;
  splitAssignmentHash?: string | null;
  preprocessingPolicyHash?: string | null;
  fittedPreprocessingHash?: string | null;
  /** Rust 宿主重新读取并核验 size/hash 后写入；sidecar 自报不具备此权限。 */
  artifactsVerified?: boolean;
  splitHash?: string | null;
  preprocessingHash?: string | null;
  preprocessingParameters?: Record<string, unknown> | null;
  testSetHash?: string | null;
  testSampleCount?: number | null;
  splitSampleCounts?: { train: number; validation: number; test: number } | null;
  testLabelCounts?: Record<string, number> | null;
  testTargetSummary?: { count: number; mean: number; variance: number; min: number; max: number } | null;
  machineChecks?: Array<{
    check: 'cross_split_exact_duplicate' | 'group_disjoint' | 'temporal_order';
    status: 'passed' | 'failed' | 'not_run';
    details?: string;
  }>;
  environment: {
    applicationVersion?: string;
    torchVersion: string;
    pythonVersion: string;
    device: string;
    cudaVersion: string | null;
  };
}

/**
 * 错误消息
 * 训练过程中发生错误时发送
 */
export interface ErrorMessage {
  runId: string;
  /** 消息类型标识 */
  type: 'error';
  /** 错误描述 */
  message: string;
  status?: 'failed';
  errorCode?: string;
  details?: Record<string, unknown>;
}

/**
 * 日志消息
 * 用于传递训练过程中的日志信息
 */
export interface LogMessage {
  runId: string;
  /** 消息类型标识 */
  type: 'log';
  /** 日志级别 */
  level: 'info' | 'warn' | 'error';
  /** 日志内容 */
  message: string;
}

/**
 * Sidecar 消息联合类型
 * Python 后端通过 stdout 发送的所有消息类型
 */
export type SidecarMessage =
  | ProgressMessage
  | EpochEndMessage
  | DoneMessage
  | ErrorMessage
  | LogMessage;

/**
 * 训练状态枚举
 * 表示训练任务的当前状态
 */
export type TrainStatus =
  | 'idle'
  | 'starting'
  | 'training'
  | 'paused'
  | 'stopping'
  | 'done'
  | 'cancelled'
  | 'error'
  | 'crashed';

/**
 * 日志条目
 * 前端存储的训练日志记录
 */
export interface LogEntry {
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 日志级别 */
  level: 'info' | 'warn' | 'error';
  /** 日志内容 */
  message: string;
}

/**
 * 训练历史记录
 * 保存每次训练的完整快照，用于对比不同网络结构的效果
 */
export interface TrainRecord {
  /** 唯一标识 */
  id: string;
  attemptId?: string;
  parentAttemptId?: string;
  restartCount?: number;
  resumeType?: 'fresh' | 'full_state' | 'weights_only';
  executionTrust?: 'trusted' | 'interrupted' | 'unverified';
  /** 训练完成时间戳 */
  timestamp: number;
  /** 网络结构摘要（如 "Conv2D → ReLU → Linear"） */
  networkSummary: string;
  /** 总参数量 */
  totalParams: number;
  /** 最终准确率 */
  finalAccuracy: number;
  /** finalAccuracy 是旧字段名；真实展示语义由此字段决定。 */
  finalMetricName?: TrainingMetricName;
  /** 最终损失值 */
  finalLoss: number;
  /** 训练轮数 */
  epochs: number;
  /** 训练时长（毫秒） */
  duration: number;
  /** 数据集名称 */
  dataset: string;
  /** 完整训练曲线数据 */
  metrics: TrainMetric[];
  /** 模型唯一标识（对应权重文件 ~/.neurobricks/models/<modelId>.pth），用于卡片化推理 */
  modelId?: string;
  /** 训练时的网络层配置快照（推理时据此重建模型） */
  layers?: Array<{ type: LayerType; params: LayerParams }>;
  /** 训练时的输入形状 [C, H, W] */
  inputShape?: number[];
  /** 该记录来自真实 sidecar 还是浏览器演示。旧记录缺失时按 native 展示。 */
  executionMode?: TrainingExecutionMode;
  /** 训练完成时实际可用的落盘产物。 */
  artifacts?: TrainingArtifacts;
}
