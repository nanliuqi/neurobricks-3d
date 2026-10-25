/**
 * 数据集类型枚举
 * 支持内置数据集和外部导入格式
 */
export type DatasetType = 'mnist' | 'cifar10' | 'local_image' | 'csv' | 'excel';

/** 本地图像 group 切分的受控字段：类别目录下的第一级子目录。 */
export const LOCAL_IMAGE_PARENT_GROUP_FIELD = '__image_parent_directory__';

export interface ImageGroupInfo {
  /** 训练端可识别的稳定字段 ID，不使用展示文案参与协议。 */
  field: typeof LOCAL_IMAGE_PARENT_GROUP_FIELD;
  /** 面向用户的字段说明。 */
  label: string;
  /** 跨类别合并后的独立分组数。 */
  distinctCount: number;
  /** 成功提取分组身份的样本数。 */
  groupedSampleCount: number;
  /** 每个类别覆盖的不同分组数，用于识别类别与采集组混杂。 */
  groupsPerClass: Record<string, number>;
  /** false 时 group 选项仍展示，但不可选择，并给出原因。 */
  available: boolean;
  unavailableReason?: string;
  /** 可以选择但三路划分很可能无法形成有效分类集合时的强提示。 */
  readinessWarning?: string;
}

/**
 * 数据集详细信息接口
 * 描述数据集的元信息和统计特征
 */
export interface DatasetInfo {
  /** 数据集实体 ID；旧导入记录缺失时按 legacy/unverified 处理。 */
  datasetId?: string;
  /** 后端对文件内容与相对路径计算的 SHA-256。 */
  contentHash?: string;
  importedAt?: number;
  sampleUnit?: string;
  sampleIndependence?: 'iid_assumed' | 'user_declared' | 'machine_verified';
  sampleUnitDeclaration?: string;
  machineChecks?: Array<{
    check: 'cross_split_exact_duplicate' | 'group_disjoint' | 'temporal_order';
    status: 'passed' | 'failed' | 'not_run';
    details?: string;
  }>;
  /** 数据集名称 */
  name: string;
  /** 数据集类型 */
  type: DatasetType;
  /** 样本总数 */
  sampleCount: number;
  /** 类别数量 */
  classCount: number;
  /** 分类索引的稳定显示名；索引顺序必须与训练端类别排序一致。 */
  classNames?: string[];
  /** 图像宽度（仅图像数据集） */
  imageWidth?: number;
  /** 图像高度（仅图像数据集） */
  imageHeight?: number;
  /** 通道数（仅图像数据集，如 RGB=3, Grayscale=1） */
  channels?: number;
  /** 从嵌套目录中见证到的图像分组能力。 */
  imageGroup?: ImageGroupInfo;
  /** 列名列表（仅表格数据集） */
  columns?: string[];
  /** 含文本/日期值、不能直接进入 MLP 的列；仅可声明为 group/time 元数据或先清洗。 */
  nonNumericColumns?: string[];
  /** 预览行数据（用于 UI 展示前几行样本） */
  previewRows?: any[];
}

/**
 * 本地图片导入结果
 * 从文件夹结构导入图片数据集时的返回信息
 */
export interface ImportLocalImagesResult {
  /** 数据集路径 */
  path: string;
  /** 类别名称列表（从子文件夹名提取） */
  classNames: string[];
  /** 每个类别的图片数量映射 */
  imagesPerClass: Record<string, number>;
}

/**
 * 表格数据导入结果
 * 从 CSV/Excel 文件导入时的返回信息
 */
export interface ImportTableResult {
  /** 文件路径 */
  path: string;
  /** 总行数（不含表头） */
  rowCount: number;
  /** 列名列表 */
  columns: string[];
  /** 预览行数据（前 5-10 行） */
  previewRows: any[];
  /** 建议的标签列名（如果检测到分类列） */
  suggestedLabelColumn?: string;
}
