import type { TrainConfig } from './training';

/**
 * 层类型联合字面量
 * 定义神经网络中所有可用的层类型
 */
export type LayerType =
  | 'Input'
  | 'Conv2D'
  | 'MaxPool2D'
  | 'AvgPool2D'
  | 'Linear'
  | 'ReLU'
  | 'Sigmoid'
  | 'Tanh'
  | 'BatchNorm2d'
  | 'LayerNorm'
  | 'Dropout'
  | 'Flatten';

/**
 * 层参数接口
 * 包含所有层类型的参数字段，均为可选
 * 使用正式字段名（如 outChannels），并支持别名 fallback（filters→outChannels）
 */
export interface LayerParams {
  // Conv2D 专用参数
  /** 输入通道数（正式字段） */
  inChannels?: number;
  /** 输出通道数/滤波器数量（正式字段） */
  outChannels?: number;
  /** 卷积核大小（正式字段） */
  kernelSize?: number;
  /** 步长，默认 1（正式字段） */
  stride?: number;
  /** 填充，默认 0（正式字段） */
  padding?: number;

  // Linear 专用参数
  /** 输入特征数（正式字段） */
  inFeatures?: number;
  /** 输出特征数（正式字段） */
  outFeatures?: number;

  // MaxPool2D 专用参数
  /** 池化核大小（正式字段） */
  poolKernelSize?: number;
  /** 池化步长（正式字段） */
  poolStride?: number;

  // Input 专用参数
  /** 输入高度（Input 层使用） */
  inputHeight?: number;
  /** 输入宽度（Input 层使用） */
  inputWidth?: number;

  // Dropout 专用参数
  /** 丢弃率，默认 0.5（正式字段） */
  dropRate?: number;

  // BatchNorm2d 专用参数
  /** 特征数（正式字段） */
  numFeatures?: number;

  /** 层归一化的归一化形状（正式字段） */
  normalizedShape?: number;

  // 别名字段（用于兼容旧代码或用户输入）
  /** filters 是 outChannels 的别名 */
  filters?: number;
  /** units 是 outFeatures 的别名 */
  units?: number;
  /** outputSize 是 outFeatures 的别名 */
  outputSize?: number;
  /** poolSize 是 poolKernelSize 的别名 */
  poolSize?: number;
  /** p 是 dropRate 的别名 */
  p?: number;
  /** inputSize 是 inFeatures 的别名 */
  inputSize?: number;
}

/**
 * 张量形状类型别名
 * 格式为 [C, H, W]（通道优先，不含 batch 维度）或 [N]（全连接层一维）
 */
export type TensorShape = number[];

/**
 * 3D 场景中的层积木
 * 表示用户在 3D 空间中拖拽放置的神经网络层组件
 */
export interface Layer3D {
  /** 唯一标识符 */
  id: string;
  /** 层类型 */
  type: LayerType;
  /** 层参数 */
  params: LayerParams;
  /** 层级顺序（从下到上递增） */
  order: number;
  /** 3D 位置坐标 [x, y, z] */
  position: [number, number, number];
  /** 输出形状，null 表示未计算 */
  outputShape: TensorShape | null;
  /** 参数量 */
  paramCount: number;
  /** 校验错误信息，null 表示无错误 */
  validationError: string | null;
  /** 梯度健康度指标（可选，用于训练监控） */
  gradientHealth?: number;
  /** 梯度均值（可选，用于训练监控） */
  gradientMean?: number;
}

/**
 * 层类别枚举
 * 用于对层类型进行分类和分组显示
 */
export type LayerCategory = 'conv' | 'pool' | 'linear' | 'activation' | 'norm' | 'utility';

/**
 * 层类型元信息
 * 描述每种层的显示信息和默认参数
 */
export interface LayerMeta {
  /** 层类型 */
  type: LayerType;
  /** 显示标签（中文名称） */
  label: string;
  /** 图标标识（可用于 UI 显示） */
  icon: string;
  /** 详细描述 */
  description: string;
  /** 默认参数配置 */
  defaultParams: LayerParams;
  /** 主题颜色（十六进制色值） */
  color: string;
  /** 所属类别 */
  category: LayerCategory;
}

/**
 * 布局模式
 * vertical: 垂直堆叠模式，所有层在 X=0, Z=0 的直线上排列
 * free: 自由布局模式，允许层在 3D 空间中任意放置
 */
export type LayoutMode = 'vertical' | 'free';

/**
 * 网络塔配置
 * 表示一个完整的神经网络结构及其元信息
 */
export interface TowerConfig3D {
  /** 唯一标识符 */
  id: string;
  /** 网络名称 */
  name: string;
  /** 层列表 */
  layers: Layer3D[];
  /** 布局模式 */
  layoutMode: LayoutMode;
  /** 总参数量 */
  totalParams: number;
  /** 是否有形状错误 */
  hasShapeError: boolean;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
}

/**
 * 保存文件格式
 * 用于序列化和反序列化项目文件
 */
export interface ProjectFile {
  /** 文件格式版本 */
  version: string;
  /** 网络塔配置 */
  tower: TowerConfig3D;
  /** 训练配置（可选） */
  trainingConfig?: TrainConfig;
}

/**
 * 形状错误类型枚举
 */
export type ShapeErrorType =
  | 'shape_mismatch'
  | 'missing_flatten'
  | 'invalid_dimension'
  | 'param_conflict';

/**
 * 形状校验错误详情
 */
export interface ShapeValidationError {
  /** 出错的层 ID */
  layerId: string;
  /** 出错的层类型 */
  layerType: LayerType;
  /** 错误类型 */
  errorType: ShapeErrorType;
  /** 错误消息 */
  message: string;
  /** 修复建议 */
  suggestion: string;
  /** 期望的输入形状 */
  expectedInputShape: TensorShape | null;
  /** 实际的输入形状 */
  actualInputShape: TensorShape | null;
}

/**
 * 网络结构校验结果
 */
export interface ValidationResult {
  /** 是否通过校验 */
  isValid: boolean;
  /** 错误列表 */
  errors: ShapeValidationError[];
  /** 警告消息列表 */
  warnings: string[];
}

/**
 * 层元信息列表
 * 包含 7 种层的完整元信息，用于 UI 显示和默认参数初始化
 */
export const LAYER_META_LIST: LayerMeta[] = [
  {
    type: 'Input',
    label: '输入层',
    icon: 'input',
    description: '网络输入层，定义数据形状',
    defaultParams: {
      inChannels: 1,
    },
    color: '#9E9E9E',
    category: 'utility',
  },
  {
    type: 'Conv2D',
    label: '卷积层',
    icon: 'conv',
    description: '2D 卷积操作，提取空间特征',
    defaultParams: {
      inChannels: 1,
      outChannels: 32,
      kernelSize: 3,
      stride: 1,
      padding: 0,
    },
    color: '#4FC3F7',
    category: 'conv',
  },
  {
    type: 'MaxPool2D',
    label: '最大池化层',
    icon: 'pool',
    description: '最大池化操作，降低空间维度',
    defaultParams: {
      poolKernelSize: 2,
      poolStride: 2,
    },
    color: '#81C784',
    category: 'pool',
  },
  {
    type: 'AvgPool2D',
    label: '平均池化层',
    icon: 'pool',
    description: '平均池化操作，降低空间维度',
    defaultParams: {
      poolKernelSize: 2,
      poolStride: 2,
    },
    color: '#66BB6A',
    category: 'pool',
  },
  {
    type: 'Linear',
    label: '全连接层',
    icon: 'linear',
    description: '全连接层，进行线性变换',
    defaultParams: {
      inFeatures: 128,
      outFeatures: 10,
    },
    color: '#FFB74D',
    category: 'linear',
  },
  {
    type: 'ReLU',
    label: 'ReLU 激活',
    icon: 'relu',
    description: 'ReLU 激活函数，引入非线性',
    defaultParams: {},
    color: '#E57373',
    category: 'activation',
  },
  {
    type: 'Sigmoid',
    label: 'Sigmoid 激活',
    icon: 'sigmoid',
    description: 'Sigmoid 激活函数，输出 0-1 概率',
    defaultParams: {},
    color: '#EF5350',
    category: 'activation',
  },
  {
    type: 'Tanh',
    label: 'Tanh 激活',
    icon: 'tanh',
    description: 'Tanh 激活函数，输出 -1 到 1',
    defaultParams: {},
    color: '#EC407A',
    category: 'activation',
  },
  {
    type: 'BatchNorm2d',
    label: '批量归一化',
    icon: 'batchnorm',
    description: '批量归一化，加速训练收敛',
    defaultParams: {
      numFeatures: 32,
    },
    color: '#BA68C8',
    category: 'norm',
  },
  {
    type: 'LayerNorm',
    label: '层归一化',
    icon: 'layernorm',
    description: '层归一化，稳定深层网络训练',
    defaultParams: {
      normalizedShape: 32,
    },
    color: '#AB47BC',
    category: 'norm',
  },
  {
    type: 'Dropout',
    label: 'Dropout',
    icon: 'dropout',
    description: '随机丢弃神经元，防止过拟合',
    defaultParams: {
      dropRate: 0.5,
    },
    color: '#90A4AE',
    category: 'utility',
  },
  {
    type: 'Flatten',
    label: '展平层',
    icon: 'flatten',
    description: '将多维张量展平为一维向量',
    defaultParams: {},
    color: '#FFF176',
    category: 'utility',
  },
];

/**
 * 默认输入形状
 * 用于形状推导的初始输入，对应 MNIST 数据集的单通道 28x28 图像
 */
export const DEFAULT_INPUT_SHAPE: TensorShape = [1, 28, 28];

/**
 * 积木高度（单位：3D 空间长度）
 */
export const BLOCK_HEIGHT = 1.0;

/**
 * 积木间隙（单位：3D 空间长度）
 */
export const BLOCK_GAP = 0.3;

/**
 * 积木步长（BLOCK_HEIGHT + BLOCK_GAP）
 * 用于计算层的 Y 坐标位置
 */
export const BLOCK_STEP = 1.3;
