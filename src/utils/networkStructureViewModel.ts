/**
 * 网络结构理解（N2）视图模型：逐层结构清单的纯展示投影。
 * - 无 React、无 DOM、无 store、无副作用；输入数组与层对象都不被修改；
 * - 只读取 store 中**已经记录**的事实（outputShape / paramCount / validationError /
 *   validationResult.errors），绝不调用 inferOutputShape、computeParamCount、
 *   validateNetwork 或任何重算动作，因此本模块不存在第二套推导算法；
 * - 「上游」严格指排序后前一层的已记录输出：记录缺失即未知，记录非法即无效，
 *   两者都不回填 DEFAULT_INPUT_SHAPE，也不把本层声明的 inChannels / inFeatures 当作上游；
 * - 形状记录先过**展示资格**（每维必须是有限正整数）才允许当作已知形状展示；
 *   该判定只决定能否展示，不推导、不修正、不写回任何业务数据；
 * - 「有可展示输出」「记录非法」「形状未记录」「已记录本层错误」是互相独立的维度：
 *   有形状不代表可运行，错误存在性不依赖详情文字是否为空，上游有错误的后续结果只供定位参考。
 */
import { LAYER_META_LIST } from '@/types/layer';
import type { Layer3D, LayerType, ShapeValidationError, TensorShape, ValidationResult } from '@/types/layer';
import { formatShape } from '@/utils/shapeInference';
import { PARAM_COUNT_UNAVAILABLE_TEXT, projectParamCount } from '@/utils/parameterCountPresentation';

/**
 * 参数量与「不可用」文案的规则都住在 parameterCountPresentation，本模块只原样委托导出，
 * 保持既有引用入口兼容；不在此保留第二份资格判定或格式化规则。
 */
export { PARAM_COUNT_UNAVAILABLE_TEXT, projectParamCount };

/** 首层为 Input 时的上游位置说明：它没有前驱层。 */
export const UPSTREAM_ENTRY_TEXT = '网络入口（首层，无前驱）';
/** 没有可用上游记录时的说明：不猜测、不回填默认形状。 */
export const UPSTREAM_UNKNOWN_TEXT = '未记录（不猜测）';
/** 上游记录存在但维度非法：既不当作已知输入，也不修正后展示。 */
export const UPSTREAM_INVALID_TEXT = '形状记录无效（不作为已知输入）';
/** 本层记录存在但维度非法时的中性说明。 */
export const SHAPE_INVALID_TEXT = '形状记录无效';
/** 错误已归属本层但详情文字缺失时的中性占位：不自造原因或建议。 */
export const ERROR_DETAIL_MISSING_TEXT = '已记录结构错误，但详情缺失';

export type UpstreamKind = 'entry' | 'recorded' | 'invalid' | 'unknown';

/** 形状记录的展示资格：缺失（未记录）与非法（记录了但不能当形状展示）互斥。 */
export type ShapeRecordKind = 'valid' | 'invalid' | 'missing';

/** 单行的可见状态；与 hasRecordedError / upstreamHasError 一起构成独立维度。 */
export type LayerStructureStatusKind = 'error' | 'shapeInvalid' | 'shapeUnknown' | 'derived';

export interface NetworkStructureRow {
  id: string;
  /** 展示序号，从 1 开始，按 order 排序后的位置 */
  index: number;
  type: LayerType;
  /** 层名称：复用 LAYER_META_LIST，不持有第二份名称表 */
  label: string;
  /** 基础说明：复用 LAYER_META_LIST */
  description: string;
  upstreamKind: UpstreamKind;
  /** 上游已记录输出的展示文本 */
  upstreamText: string;
  /** 本层已记录输出，直接来自 layer.outputShape，经共享 formatShape 格式化 */
  outputText: string;
  /** 本层是否记录到了可展示的输出形状 */
  outputKnown: boolean;
  /** 本层记录非空但维度非法（与「未记录」区分） */
  outputShapeInvalid: boolean;
  /** 参数量展示文本；不可用时为 null，由界面显示 PARAM_COUNT_UNAVAILABLE_TEXT */
  paramCountText: string | null;
  /** 是否已记录属于本层的结构错误（不依赖详情文字是否非空） */
  hasRecordedError: boolean;
  /** 已归属本层但没有任何非空详情文字 */
  errorDetailMissing: boolean;
  /** 本层之前的任意层是否已记录错误 */
  upstreamHasError: boolean;
  statusKind: LayerStructureStatusKind;
  statusText: string;
  /** 已记录错误原文（按层 ID 归属，已去重；不含占位文案） */
  errorMessages: string[];
  /** 已记录修复建议（原文，已去重，不含自造建议） */
  suggestions: string[];
}

export interface NetworkStructureViewModel {
  rows: NetworkStructureRow[];
  isEmpty: boolean;
  /** 参与展示的层数 */
  layerCount: number;
  /** 已记录结构错误的层数 */
  errorLayerCount: number;
}

function uniqueTexts(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function hasRecordedShape(shape: TensorShape | null | undefined): shape is TensorShape {
  return Array.isArray(shape) && shape.length > 0;
}

/**
 * 维度展示资格：必须是数值、有限、整数且大于 0。
 * 这是「这份记录能否当作形状展示」的判定，不是新的形状推导规则，
 * 也不修正数据：不删维度、不转字符串、不取绝对值、不四舍五入、不补默认形状。
 */
function isDimensionEligible(value: unknown): boolean {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  if (!Number.isInteger(value)) return false;
  return value > 0;
}

/** 区分「未记录（null / 空数组）」与「记录了但非法（非空数组含非法维度）」。 */
export function classifyShapeRecord(shape: TensorShape | null | undefined): ShapeRecordKind {
  if (!hasRecordedShape(shape)) return 'missing';
  return shape.every(isDimensionEligible) ? 'valid' : 'invalid';
}

/** 按层 ID 归属已记录错误；没有可用 layerId 的错误不猜测归属。 */
function groupErrorsByLayer(errors: readonly ShapeValidationError[]): Map<string, ShapeValidationError[]> {
  const grouped = new Map<string, ShapeValidationError[]>();
  for (const error of errors) {
    if (!error || typeof error.layerId !== 'string' || error.layerId === '') continue;
    const bucket = grouped.get(error.layerId);
    if (bucket) bucket.push(error);
    else grouped.set(error.layerId, [error]);
  }
  return grouped;
}

export function buildNetworkStructureViewModel(input: {
  layers: readonly Layer3D[];
  validationResult: Pick<ValidationResult, 'errors'> | null | undefined;
}): NetworkStructureViewModel {
  const source = Array.isArray(input.layers) ? input.layers : [];
  // 副本排序：不对传入数组做原地 sort，也不改动层对象本身
  const sorted = [...source].sort((a, b) => a.order - b.order);
  const errors = input.validationResult?.errors;
  const grouped = groupErrorsByLayer(Array.isArray(errors) ? errors : []);

  const rows: NetworkStructureRow[] = [];
  let upstreamHasError = false;

  sorted.forEach((layer, position) => {
    const meta = LAYER_META_LIST.find(item => item.type === layer.type);
    const previous = position === 0 ? null : sorted[position - 1];

    const previousRecord = previous === null ? null : classifyShapeRecord(previous.outputShape);

    let upstreamKind: UpstreamKind;
    let upstreamText: string;
    if (previous === null) {
      // 首层：只有 Input 才有「入口」语义；其它首层的上游同样只是「未记录」
      upstreamKind = layer.type === 'Input' ? 'entry' : 'unknown';
      upstreamText = layer.type === 'Input' ? UPSTREAM_ENTRY_TEXT : UPSTREAM_UNKNOWN_TEXT;
    } else if (previousRecord === 'valid') {
      upstreamKind = 'recorded';
      upstreamText = formatShape(previous.outputShape);
    } else if (previousRecord === 'invalid') {
      // 非法记录不升级为已知输入，也不修正后展示
      upstreamKind = 'invalid';
      upstreamText = UPSTREAM_INVALID_TEXT;
    } else {
      upstreamKind = 'unknown';
      upstreamText = UPSTREAM_UNKNOWN_TEXT;
    }

    const outputRecord = classifyShapeRecord(layer.outputShape);
    const outputKnown = outputRecord === 'valid';
    const outputShapeInvalid = outputRecord === 'invalid';
    const layerErrors = grouped.get(layer.id) ?? [];
    const errorMessages = uniqueTexts([
      ...layerErrors.map(error => error.message),
      layer.validationError,
    ]);
    const suggestions = uniqueTexts(layerErrors.map(error => error.suggestion));
    // 错误存在性来自「有记录归属本层」，与详情文字是否为空无关
    const hasRecordedError = layerErrors.length > 0 || typeof layer.validationError === 'string';
    const errorDetailMissing = hasRecordedError && errorMessages.length === 0;

    let statusKind: LayerStructureStatusKind;
    let statusText: string;
    if (hasRecordedError) {
      // 即使本层有 outputShape，已记录错误优先：不标记为「正常」或「可运行」
      statusKind = 'error';
      statusText = '已记录结构错误';
    } else if (outputShapeInvalid) {
      // 非法记录不获得「形状已静态推导」，也不与「未记录」混为一谈
      statusKind = 'shapeInvalid';
      statusText = SHAPE_INVALID_TEXT;
    } else if (!outputKnown) {
      statusKind = 'shapeUnknown';
      statusText = '输出形状未记录';
    } else {
      statusKind = 'derived';
      statusText = '形状已静态推导';
    }

    rows.push({
      id: layer.id,
      index: position + 1,
      type: layer.type,
      label: meta?.label ?? layer.type,
      description: meta?.description ?? '',
      upstreamKind,
      upstreamText,
      outputText: outputShapeInvalid ? SHAPE_INVALID_TEXT : formatShape(layer.outputShape),
      outputKnown,
      outputShapeInvalid,
      paramCountText: projectParamCount(layer.paramCount),
      hasRecordedError,
      errorDetailMissing,
      upstreamHasError,
      statusKind,
      statusText,
      errorMessages,
      suggestions,
    });

    if (hasRecordedError) upstreamHasError = true;
  });

  return {
    rows,
    isEmpty: rows.length === 0,
    layerCount: rows.length,
    errorLayerCount: rows.filter(row => row.hasRecordedError).length,
  };
}
