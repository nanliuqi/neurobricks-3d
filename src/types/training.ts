import type { LayerType, LayerParams } from './layer';

/**
 * 优化器类型
 */
export type OptimizerType = 'sgd' | 'adam' | 'adamw';

/**
 * 训练配置接口
 * 定义神经网络训练的超参数和网络结构
 */
export interface TrainConfig {
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
    /** 层类型 */
    type: LayerType;
    /** 层参数 */
    params: LayerParams;
  }>;
  /** 优化器类型 */
  optimizer?: OptimizerType;
  /** 权重衰减（L2 正则化） */
  weightDecay?: number;
}

/**
 * 训练指标
 * 记录每个训练步骤的性能指标
 */
export interface TrainMetric {
  /** 当前 epoch 编号 */
  epoch: number;
  /** 当前 step 编号 */
  step: number;
  /** 损失值 */
  loss: number;
  /** 准确率 */
  accuracy: number;
  /** 时间戳（毫秒） */
  timestamp: number;
}

/**
 * 进度消息
 * 用于 Tauri 事件通信，传递实时训练进度
 */
export interface ProgressMessage {
  /** 消息类型标识 */
  type: 'progress';
  /** 当前 epoch 编号 */
  epoch: number;
  /** 当前 step 编号 */
  step: number;
  /** 损失值 */
  loss: number;
  /** 准确率 */
  accuracy: number;
}

/**
 * Epoch 结束消息
 * 在每个 epoch 完成后发送，包含汇总统计
 */
export interface EpochEndMessage {
  /** 消息类型标识 */
  type: 'epoch_end';
  /** 完成的 epoch 编号 */
  epoch: number;
  /** 训练集损失 */
  trainLoss: number;
  /** 验证集准确率 */
  valAccuracy: number;
}

/**
 * 训练完成消息
 * 在所有 epoch 完成后发送
 */
export interface DoneMessage {
  /** 消息类型标识 */
  type: 'done';
  /** 最终准确率 */
  finalAccuracy: number;
}

/**
 * 错误消息
 * 训练过程中发生错误时发送
 */
export interface ErrorMessage {
  /** 消息类型标识 */
  type: 'error';
  /** 错误描述 */
  message: string;
}

/**
 * 日志消息
 * 用于传递训练过程中的日志信息
 */
export interface LogMessage {
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
export type TrainStatus = 'idle' | 'training' | 'paused' | 'done' | 'error';

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
  /** 训练完成时间戳 */
  timestamp: number;
  /** 网络结构摘要（如 "Conv2D → ReLU → Linear"） */
  networkSummary: string;
  /** 总参数量 */
  totalParams: number;
  /** 最终准确率 */
  finalAccuracy: number;
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
}
