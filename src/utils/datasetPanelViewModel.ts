/**
 * 数据集工作台视图模型：DatasetPanel 的纯函数层。
 * - 无 React、无 DOM、无 store、无异步；输入不被修改，输出确定性；
 * - 每一层只陈述自己真正知道的事实：文件名≠身份、计划比例≠实际分配、
 *   用户声明≠机器验证、未运行的检查≠通过；
 * - CSV 特征列推导不在本文件实现：统一转发中立单一来源 datasetContract，
 *   避免 UI 层、Preflight、experimentRuntime 各自维护排除规则。
 */
import type { DatasetInfo, DatasetType } from '@/types/dataset';
import {
  deriveCsvFeatureFields,
  deriveNonNumericFeatureColumns,
  type CsvFieldSelections,
} from '@/utils/datasetContract';

/** 内置数据集元数据：与历史 DatasetPanel 内联常量逐字段一致，不改业务语义。 */
export const BUILTIN_DATASET_OPTIONS = [
  { value: 'mnist', label: 'MNIST' },
  { value: 'cifar10', label: 'CIFAR-10' },
] as const;

export function buildBuiltinDatasetInfo(datasetName: 'mnist' | 'cifar10'): DatasetInfo {
  return {
    datasetId: `builtin-${datasetName}-torchvision-v1`,
    contentHash: `builtin:${datasetName}:torchvision-v1`,
    importedAt: Date.now(),
    sampleUnit: 'image',
    sampleIndependence: 'machine_verified',
    sampleUnitDeclaration: 'TorchVision 官方预定义 train/test 样本',
    machineChecks: [],
    name: datasetName.toUpperCase(),
    type: datasetName,
    sampleCount: datasetName === 'mnist' ? 60000 : 50000,
    classCount: 10,
    classNames: Array.from({ length: 10 }, (_value, index) => String(index)),
    imageWidth: datasetName === 'mnist' ? 28 : 32,
    imageHeight: datasetName === 'mnist' ? 28 : 32,
    channels: datasetName === 'mnist' ? 1 : 3,
  };
}

export function isBuiltinDatasetType(type: DatasetType | null | undefined): boolean {
  return type === 'mnist' || type === 'cifar10';
}

/** 字段选择输入类型：单一来源在 datasetContract。 */
export type DatasetFieldSelections = CsvFieldSelections;

// CSV 特征列推导的单一来源：直接转发 datasetContract，本文件不再持有第二套规则。
export { deriveCsvFeatureFields, deriveNonNumericFeatureColumns };

/** 未知字段统一显示“未记录”，绝不显示 undefined/null/空白/NaN/Infinity。 */
export function formatKnownValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '未记录';
  if (typeof value === 'number' && !Number.isFinite(value)) return '未记录';
  const text = String(value).trim();
  if (!text || text === 'NaN' || text === 'Infinity' || text === '-Infinity') return '未记录';
  return text;
}

const DATASET_TYPE_LABELS: Record<DatasetType, string> = {
  mnist: 'MNIST（内置）',
  cifar10: 'CIFAR-10（内置）',
  local_image: '本地图片目录',
  csv: 'CSV 表格',
  excel: 'Excel',
};

export type DatasetTaskState = 'classification' | 'regression_confirmed' | 'regression_pending';

export interface DatasetSummaryView {
  name: string;
  typeLabel: string;
  sampleCountText: string;
  /** 分类任务显示类别数；CSV 显示回归任务标记；不适用显示“不适用”。 */
  taskLine: string;
  taskState: DatasetTaskState;
  /** 图像形状 [C, H, W] 或表格列数；不可推导时为 null。 */
  inputText: string | null;
  fingerprintShort: string | null;
  fingerprintFull: string | null;
  importedAtText: string;
}

export function buildDatasetSummaryView(dataset: DatasetInfo): DatasetSummaryView {
  const taskState: DatasetTaskState = dataset.type === 'csv'
    ? 'regression_confirmed'
    : 'classification';
  const hasImageShape = dataset.channels != null && dataset.imageHeight != null && dataset.imageWidth != null;

  // 样本数：非有限或负数都属于异常元数据，诚实显示“未记录”。
  const sampleCountText = Number.isFinite(dataset.sampleCount) && dataset.sampleCount >= 0
    ? dataset.sampleCount.toLocaleString()
    : '未记录';

  // 分类任务：classCount 缺失/非法时不拼接出“未记录 个类别”。
  const classCountText = formatKnownValue(dataset.classCount);
  const taskLine = dataset.type === 'csv'
    ? '监督式回归（单目标列）'
    : classCountText === '未记录'
      ? '分类任务 · 类别数未记录'
      : `分类任务 · ${classCountText} 个类别`;

  // 指纹：短哈希不追加误导性省略号；仅超过 22 字符时截断。
  const fingerprintShort = dataset.contentHash
    ? dataset.contentHash.length > 22 ? `${dataset.contentHash.slice(0, 22)}…` : dataset.contentHash
    : null;

  // 导入时间：NaN/Infinity/无效日期都显示“未记录”，不展示 Invalid Date。
  let importedAtText = '未记录';
  if (typeof dataset.importedAt === 'number' && Number.isFinite(dataset.importedAt)) {
    const date = new Date(dataset.importedAt);
    if (!Number.isNaN(date.getTime())) importedAtText = date.toLocaleString();
  }

  return {
    name: formatKnownValue(dataset.name),
    typeLabel: DATASET_TYPE_LABELS[dataset.type] ?? '未记录',
    sampleCountText,
    taskLine,
    taskState,
    inputText: dataset.type === 'csv'
      ? dataset.columns && dataset.columns.length > 0 ? `${dataset.columns.length} 列` : null
      : hasImageShape
        ? `${dataset.channels} × ${dataset.imageHeight} × ${dataset.imageWidth}`
        : null,
    fingerprintShort,
    fingerprintFull: dataset.contentHash || null,
    importedAtText,
  };
}

export type MachineCheckType = 'cross_split_exact_duplicate' | 'group_disjoint' | 'temporal_order';
export type MachineCheckStatus = 'passed' | 'failed' | 'not_run';

export interface MachineCheckViewInput {
  check: MachineCheckType;
  status: MachineCheckStatus;
  details?: string;
}

export const MACHINE_CHECK_LABELS: Record<MachineCheckType, string> = {
  cross_split_exact_duplicate: '跨切分精确重复检测',
  group_disjoint: '分组不相交检查',
  temporal_order: '时间先后顺序检查',
};

export const MACHINE_CHECK_DESCRIPTIONS: Record<MachineCheckType, string> = {
  cross_split_exact_duplicate: '检测训练/验证/测试集合之间是否存在内容完全相同的样本。',
  group_disjoint: '检测同一分组是否只出现在训练、验证、测试中的一个集合。',
  temporal_order: '检测切分是否严格遵守时间先后（训练在前、测试在后）。',
};

export const MACHINE_CHECK_STATUS_LABELS: Record<MachineCheckStatus, string> = {
  passed: '通过',
  failed: '未通过',
  not_run: '未运行',
};

export const INDEPENDENCE_LABELS: Record<NonNullable<DatasetInfo['sampleIndependence']>, string> = {
  iid_assumed: '仅 IID 假设',
  user_declared: '用户声明',
  machine_verified: '机器记录',
};

/**
 * 预览表格视图模型：安全处理对象行/数组行/原始值行/脏数据。
 * - 展示文本（displayText）与完整安全文本（fullText）分离：
 *   界面显示受限文本，查看详情使用 fullText，两者不得混为一个字段；
 * - 普通合理长度数据的 fullText 就是原始完整值；极端超大值按安全上限截断，
 *   并在 fullText 中明确标注“预览值过长，已安全截断”，不冒充完整值，
 *   也不把数 MB 内容塞入 DOM 属性；
 * - 确定性矩形化：metadata.columns 顺序优先；对象行额外字段按首次出现顺序追加；
 *   数组行超出已知列数时追加“列 N”；缺失位置显示“—”；
 *   混合对象/数组/原始值行不崩溃，所有行列数一致，不静默丢弃协议返回的字段或值；
 * - 不使用 dangerouslySetInnerHTML，不解释 HTML/脚本；绝不出现 [object Object]；
 * - 任何异常路径都回退为“无可用预览”，不得让面板白屏。
 */
export interface PreviewTextView {
  /** 界面展示的受限文本。 */
  displayText: string;
  /** 用于查看详情的安全文本；超长时为安全截断后的表示（含标注），不冒充原始完整值。 */
  fullText: string;
  /** displayText 是否发生了截断（含安全上限截断）。 */
  truncated: boolean;
}

export interface PreviewTableView {
  columns: PreviewTextView[];
  rows: PreviewTextView[][];
}

/** 单元格展示上限（可见文本）。 */
const MAX_CELL_LENGTH = 80;
/** 完整安全文本上限：防止极端超大值直接进入 DOM 属性。 */
const MAX_FULL_LENGTH = 2000;
const FULL_TEXT_CAP_NOTE = '…（预览值过长，已安全截断）';

function safeCellText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '—' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `${String(value)}n`;
  try {
    const serialized = JSON.stringify(value);
    // JSON 序列化成功；失败（如循环引用）时回退为类型描述，绝不产生 [object Object]。
    return serialized ?? `${(value as { constructor?: { name?: string } }).constructor?.name ?? '值'}（复杂值）`;
  } catch {
    return `${(value as { constructor?: { name?: string } }).constructor?.name ?? '值'}（复杂值）`;
  }
}

/** 把原始安全文本转成展示/完整双文本；先安全上限，再展示截断。 */
export function toPreviewTextView(raw: string): PreviewTextView {
  let fullText = raw;
  if (fullText.length > MAX_FULL_LENGTH) {
    // 明确标注已安全截断，不得继续宣称这是完整值。
    fullText = `${fullText.slice(0, MAX_FULL_LENGTH)}${FULL_TEXT_CAP_NOTE}`;
  }
  const displayText = fullText.length > MAX_CELL_LENGTH
    ? `${fullText.slice(0, MAX_CELL_LENGTH)}…`
    : fullText;
  return { displayText, fullText, truncated: displayText !== fullText };
}

function isPlainObjectRow(row: unknown): row is Record<string, unknown> {
  return row !== null && typeof row === 'object' && !Array.isArray(row);
}

export function buildPreviewTableView(
  previewRows: unknown,
  columns?: string[],
): PreviewTableView | null {
  try {
    if (!Array.isArray(previewRows) || previewRows.length === 0) return null;

    // ---- 第一遍：确定性地构建最终列集合（不丢弃任何协议返回的字段/值） ----
    const columnNames: string[] = Array.isArray(columns)
      ? columns.filter(column => typeof column === 'string')
      : [];
    const knownColumns = new Set<string>(columnNames);
    const appendColumn = (name: string) => {
      if (knownColumns.has(name)) return;
      knownColumns.add(name);
      columnNames.push(name);
    };

    for (const row of previewRows) {
      if (isPlainObjectRow(row)) {
        for (const key of Object.keys(row)) appendColumn(key);
        continue;
      }
      if (Array.isArray(row)) {
        for (let index = columnNames.length; index < row.length; index += 1) {
          appendColumn(`列 ${index + 1}`);
        }
        continue;
      }
      // 原始值行：至少保证存在第一列。
      if (columnNames.length === 0) appendColumn('值');
    }

    if (columnNames.length === 0) return null;

    // ---- 第二遍：按最终列集合对位取值，缺失位置显示“—”（矩形化） ----
    const rows: PreviewTextView[][] = previewRows.map(row => {
      if (isPlainObjectRow(row)) {
        return columnNames.map(column =>
          toPreviewTextView(safeCellText(column in row ? row[column] : undefined)));
      }
      if (Array.isArray(row)) {
        return columnNames.map((_column, index) =>
          toPreviewTextView(safeCellText(index < row.length ? row[index] : undefined)));
      }
      return columnNames.map((_column, index) =>
        toPreviewTextView(safeCellText(index === 0 ? row : undefined)));
    });

    return {
      columns: columnNames.map(name => toPreviewTextView(name)),
      rows,
    };
  } catch {
    return null;
  }
}
