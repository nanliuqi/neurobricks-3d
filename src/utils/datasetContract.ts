/**
 * CSV 数据契约的中立单一来源（非 UI 工具）：
 * 训练前检查（模块 04）、数据集工作台视图模型、experimentRuntime 回退推导、
 * LayerLibrary 经典模型适配必须共同调用这里的纯函数，不得各自实现排除规则。
 *
 * 核心不变量（监督式回归的任务契约）：
 * - 没有目标列 ≠ 所有列都是特征；目标列未确认时训练任务契约尚未成立，
 *   不存在可用于自动适配的有效特征集合，一律返回空集（不得把全部列当特征）；
 * - 非 CSV 数据集返回 undefined（不适用，而不是空数组）。
 *
 * 排除语义（与真实训练端口径一致）：
 * - 始终排除 targetField；
 * - group 策略只额外排除激活的 groupField（不排除未激活的 timeField）；
 * - temporal 策略只额外排除激活的 timeField（不排除未激活的 groupField）；
 * - random 不额外排除未激活的 group/time 字段；
 * - 字段顺序保持 dataset.columns 顺序。
 */
import type { DatasetInfo } from '@/types/dataset';

export interface CsvFieldSelections {
  splitStrategy: 'random' | 'group' | 'temporal';
  groupField: string | null;
  timeField: string | null;
  targetField: string | null;
}

/**
 * 按列清单与字段选择推导有效特征列（核心规则，唯一实现）。
 * 契约未成立防护在最低层生效：targetField 未确认时返回空集，
 * 任何调用方都不得把未确认契约解释成“全部列都是特征”。
 * 列清单缺失时同样返回空数组。
 */
export function deriveCsvFeatureFieldsFromColumns(
  columns: readonly string[] | null | undefined,
  selections: CsvFieldSelections,
): string[] {
  if (!columns) return [];
  if (!selections.targetField) return [];
  const excluded = new Set<string>(
    [
      selections.targetField,
      selections.splitStrategy === 'group' ? selections.groupField : null,
      selections.splitStrategy === 'temporal' ? selections.timeField : null,
    ].filter((value): value is string => Boolean(value)),
  );
  return columns.filter(column => !excluded.has(column));
}

/**
 * 数据集级入口：
 * - 非 CSV 返回 undefined（不适用），便于调用方区分“没有特征”与“该数据集不存在特征概念”；
 * - CSV 且目标列未确认：返回空特征集合（契约未成立，不得预适配/不得生成伪特征）；
 * - CSV 且目标列已确认：按当前策略推导特征集合。
 */
export function deriveCsvFeatureFields(
  dataset: DatasetInfo | null,
  selections: CsvFieldSelections,
): string[] | undefined {
  if (!dataset || dataset.type !== 'csv') return undefined;
  return deriveCsvFeatureFieldsFromColumns(dataset.columns, selections);
}

/** 进入训练前仍含文本/日期值的特征列；与模块 04 Preflight 的阻断口径一致。 */
export function deriveNonNumericFeatureColumns(
  dataset: DatasetInfo | null,
  selections: CsvFieldSelections,
): string[] {
  const featureFields = deriveCsvFeatureFields(dataset, selections);
  if (!featureFields || !dataset?.nonNumericColumns) return [];
  const nonNumeric = new Set(dataset.nonNumericColumns);
  return featureFields.filter(column => nonNumeric.has(column));
}
