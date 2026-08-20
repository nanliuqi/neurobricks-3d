/**
 * 推理类别语义化：把类别索引映射为数据集相关的可读标签。
 * - MNIST：数字 0-9（标签为 "0"~"9"）
 * - CIFAR-10：飞机/汽车/鸟/猫/鹿/狗/青蛙/马/船/卡车
 * - 其他数据集：返回 null（由 UI 回退显示 "Class N"）
 */

const CIFAR10_CLASSES = [
  '飞机',
  '汽车',
  '鸟',
  '猫',
  '鹿',
  '狗',
  '青蛙',
  '马',
  '船',
  '卡车',
];

/** 数据集类型（按训练配置 dataset 字段归一化） */
export type PredictDatasetKind = 'mnist' | 'cifar10' | 'other';

/** 从卡片 dataset 字符串识别数据集类型（大小写不敏感、容忍别名） */
export function getDatasetKind(dataset: string | undefined | null): PredictDatasetKind {
  const d = (dataset ?? '').toLowerCase();
  if (d.includes('mnist')) return 'mnist';
  if (d.includes('cifar')) return 'cifar10';
  return 'other';
}

/**
 * 获取类别的语义化标签。
 * @returns MNIST 返回 "0"~"9"；CIFAR-10 返回中文名称；其他数据集返回 null
 */
export function getClassLabel(kind: PredictDatasetKind, classIndex: number): string | null {
  if (kind === 'mnist' && classIndex >= 0 && classIndex <= 9) {
    return String(classIndex);
  }
  if (kind === 'cifar10' && classIndex >= 0 && classIndex < CIFAR10_CLASSES.length) {
    return CIFAR10_CLASSES[classIndex];
  }
  return null;
}
