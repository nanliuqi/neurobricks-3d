import type { TrainConfig, TrainMetric } from './training';

/**
 * SSH 认证类型枚举
 */
export type SSHAuthType = 'password' | 'private_key';

/**
 * SSH 服务器配置接口
 * 用于存储和管理远程服务器的连接信息
 */
export interface SSHConfig {
  /** 唯一标识符 */
  id: string;
  /** 服务器名称（用户自定义） */
  name: string;
  /** 主机地址（IP 或域名） */
  host: string;
  /** SSH 端口号，默认 22 */
  port: number;
  /** 用户名 */
  username: string;
  /** 认证类型 */
  authType: SSHAuthType;
  /** 密码（仅当 authType='password' 时使用） */
  password?: string;
  /** 私钥路径（仅当 authType='private_key' 时使用） */
  privateKeyPath?: string;
  /** 私钥密码短语（可选） */
  passphrase?: string;
  /** 远程工作目录，默认 '/tmp/neurobricks' */
  remoteWorkDir: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 最后更新时间戳（毫秒） */
  updatedAt: number;
  /** 最后连接时间戳（毫秒） */
  lastConnectedAt?: number;
}

/**
 * 云端任务状态枚举
 * 表示训练任务在远程服务器上的执行状态
 */
export type CloudTaskStatus =
  | 'pending'
  | 'uploading'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped';

/**
 * 云端结果文件接口
 * 描述训练完成后生成的模型文件和日志
 */
export interface CloudResultFile {
  /** 文件名 */
  name: string;
  /** 远程服务器上的文件路径 */
  remotePath: string;
  /** 本地下载后的文件路径（下载后填充） */
  localPath?: string;
  /** 文件大小（字节） */
  size: number;
  /** 是否已下载到本地 */
  downloaded: boolean;
}

/**
 * 云端训练任务接口
 * 表示在远程服务器上执行的神经网络训练任务
 */
export interface CloudTask {
  /** 任务唯一标识符 */
  id: string;
  /** 关联的服务器 ID */
  serverId: string;
  /** 服务器名称（冗余存储，便于显示） */
  serverName: string;
  /** 任务状态 */
  status: CloudTaskStatus;
  /** 训练配置 */
  trainConfig: TrainConfig;
  /** 远程脚本路径 */
  remoteScriptPath: string;
  /** 远程日志文件路径 */
  remoteLogPath: string;
  /** 训练指标历史 */
  metrics: TrainMetric[];
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 开始执行时间戳（毫秒） */
  startedAt?: number;
  /** 完成时间戳（毫秒） */
  completedAt?: number;
  /** 错误消息（失败时填充） */
  errorMessage?: string;
  /** 结果文件列表 */
  resultFiles?: CloudResultFile[];
}
