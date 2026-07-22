/**
 * 数据集类型枚举
 * 支持内置数据集和外部导入格式
 */
export type DatasetType = 'mnist' | 'cifar10' | 'local_image' | 'csv' | 'excel';

/**
 * 数据集详细信息接口
 * 描述数据集的元信息和统计特征
 */
export interface DatasetInfo {
  /** 数据集名称 */
  name: string;
  /** 数据集类型 */
  type: DatasetType;
  /** 样本总数 */
  sampleCount: number;
  /** 类别数量 */
  classCount: number;
  /** 图像宽度（仅图像数据集） */
  imageWidth?: number;
  /** 图像高度（仅图像数据集） */
  imageHeight?: number;
  /** 通道数（仅图像数据集，如 RGB=3, Grayscale=1） */
  channels?: number;
  /** 列名列表（仅表格数据集） */
  columns?: string[];
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
