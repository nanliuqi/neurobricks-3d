/**
 * 参数量展示规则（N4）：读取、格式化、几何映射与耗时预估的唯一一份规则。
 * - 无 React、无 DOM、无 store、无副作用；只做「读已经记录的数字 → 决定能否展示」，
 *   不调用 computeParamCount / inferOutputShape，因此不存在第二套计算算法；
 * - 不写回 layers / paramCount / totalParams / 任何训练状态，也不清洗源数据：
 *   非法记录仍然是非法记录，只是不被展示成一个看起来正常的数字；
 * - 资格判定只有一条：有限、非负、安全整数（0 合法）。小数、负数、NaN、±Infinity、
 *   字符串、缺失、超出可精确表示范围一律「不可用」，不 fallback 成 0；
 * - 「不可用」是展示结论，不是「参数量为 0」，也不是结构错误：结构状态与本状态互相独立；
 * - 总量必须同时满足「总量自身合格」与「没有任何层的记录不合格」才允许宣称完整；
 * - 「存在不合格记录」与「该记录能否取到 ID」是两件事：判定只看记录数量，ID 只用于定位成因，
 *   取不到 ID 就用列表位置说明，绝不因为「说不清是哪一层」而把不合格记录放行为合法。
 */

/** 参数量不可用时的统一文案（所有消费面共用）。 */
export const PARAM_COUNT_UNAVAILABLE_TEXT = '不可用';

/**
 * 唯一资格判定：有限 + 安全整数 + 非负。0 通过（无参数层是合法的）。
 * 用安全整数而非仅 isInteger：超出 2^53-1 的 double 已不保证精确，展示它就是把
 * 一个可能错位的数字说成事实。
 */
export function isDisplayableCount(value: unknown): value is number {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  if (!Number.isSafeInteger(value)) return false;
  return value >= 0;
}

/**
 * 单层参数量的展示文本；不可用时返回 null，由界面渲染 PARAM_COUNT_UNAVAILABLE_TEXT。
 * 返回带千分位的文本只用于展示，任何数值用途必须回到原始记录，不得反向解析此字符串。
 */
export function projectParamCount(value: unknown): string | null {
  return isDisplayableCount(value) ? value.toLocaleString() : null;
}

export interface TotalParamCountProjection {
  /** 'available' 才表示这是一个可以宣称完整的总量 */
  kind: 'available' | 'unavailable';
  /** 展示文本；不可用时为 PARAM_COUNT_UNAVAILABLE_TEXT，绝不用部分层之和冒充 */
  text: string;
  /** 自身记录不达标且能取到 ID 的层：只用于说明成因，不修补、不删除这些层 */
  unavailableLayerIds: string[];
  /**
   * 自身记录不达标的条目数量（与能否取到 ID 无关）：总量的资格只看这个数字。
   * 用计数而不是 ID 列表长度判定，否则缺 ID 的非法记录会凭空消失、总量被冒充完整。
   */
  unavailableRecordCount: number;
  /** 不达标的条目中取不到 ID 的那些在列表里的 1 基位置：仅用于定位，不是业务 ID */
  unavailableRecordPositions: number[];
  /** 为什么不能宣称完整总量 */
  hint: string;
}

interface UnavailableRecordSummary {
  count: number;
  ids: string[];
  positions: number[];
}

/**
 * 逐条判定层记录：只有「是对象且 paramCount 合格」才算通过。
 * null / undefined / 非对象 / 缺少 paramCount 都算不达标条目，不做跳过；
 * 达标与否判完之后才考虑定位，定位失败（没有可用 ID）退化为列表位置。
 */
function collectUnavailableRecords(layers: readonly unknown[]): UnavailableRecordSummary {
  const summary: UnavailableRecordSummary = { count: 0, ids: [], positions: [] };

  layers.forEach((layer, index) => {
    const record = layer as { id?: unknown; paramCount?: unknown } | null | undefined;
    const isRecordShape = typeof record === 'object' && record !== null;
    if (isRecordShape && isDisplayableCount(record.paramCount)) return;

    summary.count += 1;
    const id = isRecordShape ? record.id : undefined;
    if (typeof id === 'string' && id.trim() !== '') {
      if (!summary.ids.includes(id)) summary.ids.push(id);
    } else {
      summary.positions.push(index + 1);
    }
  });

  return summary;
}

function describeUnavailableRecords(summary: UnavailableRecordSummary): string {
  const located = [...summary.ids, ...summary.positions.map((position) => `第 ${position} 条记录`)];
  return `有 ${summary.count} 条参数量记录不可用（${located.join('、')}），无法给出完整总量`;
}

/**
 * 总量展示投影：只要有一条层的参数量记录不可用，有限总量也不等于「完整」，
 * 因此整条显示「不可用」；不做「只加总合法层」的降级求和。
 * 层列表本身不是数组时无从核验任何记录，同样按「不完整」处理，不默认放行。
 */
export function projectTotalParamCount(input: {
  totalParams: unknown;
  layers: readonly unknown[];
}): TotalParamCountProjection {
  const listUnreadable = !Array.isArray(input.layers);
  const unavailable = listUnreadable
    ? { count: 1, ids: [], positions: [] }
    : collectUnavailableRecords(input.layers);

  if (unavailable.count > 0) {
    const hint = listUnreadable
      ? '层列表不可用，无法核验各层参数量记录，无法给出完整总量'
      : describeUnavailableRecords(unavailable);
    return {
      kind: 'unavailable',
      text: PARAM_COUNT_UNAVAILABLE_TEXT,
      unavailableLayerIds: unavailable.ids,
      unavailableRecordCount: unavailable.count,
      unavailableRecordPositions: unavailable.positions,
      hint,
    };
  }

  if (!isDisplayableCount(input.totalParams)) {
    return {
      kind: 'unavailable',
      text: PARAM_COUNT_UNAVAILABLE_TEXT,
      unavailableLayerIds: unavailable.ids,
      unavailableRecordCount: unavailable.count,
      unavailableRecordPositions: unavailable.positions,
      hint: '总参数量记录不可用（非有限、非整数、负数或超出可精确表示范围）',
    };
  }

  return {
    kind: 'available',
    text: input.totalParams.toLocaleString(),
    unavailableLayerIds: unavailable.ids,
    unavailableRecordCount: unavailable.count,
    unavailableRecordPositions: unavailable.positions,
    hint: '',
  };
}

/**
 * 非法参数量积木的占位宽度。
 * 合法整数的宽度只可能是 1（恰为 0 参数）或不小于 1.3（最小非零合法值），
 * 因此 1.15 不会被任何合法参数量映射到：占位宽度不等于「0 参数」的外观。
 * 这是视觉兜底，只保证几何参数是有限正数，不声明任何参数量含义。
 */
export const PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH = 1.15;

/**
 * 参数量 → 积木宽度。合法值沿用原有映射公式，保证既有视觉行为不变；
 * 不可用时返回占位宽度，NaN / Infinity / 负数不会进入 RoundedBox 的几何参数。
 */
export function paramCountToBlockWidth(value: unknown): number {
  if (!isDisplayableCount(value)) return PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH;
  return Math.max(1, Math.log2(value + 1) * 0.3 + 1);
}

export interface EpochEstimateInput {
  /** 当前工程记录的总参数量（不可用时不估算，而不是估成 0 秒） */
  totalParams: unknown;
  batchSize: unknown;
  /** 每秒可处理的样本量（设备吞吐） */
  throughput: unknown;
}

/**
 * 每 epoch 粗略秒数。返回 null 表示「无法估算」：参数量不可用、批量或吞吐非法、
 * 中间乘积或结果已超出可精确表示范围。0 保持原有语义（网络尚无参数，界面不显示估算）。
 * 中间乘积也要检查：totalParams * batchSize 一旦越过 2^53，得到的秒数末位已不可信，
 * 不能伪装成一个精确的粗略估计。
 * 注意本函数只能核验传进来的这个数字本身，看不出「某一层的记录非法而总量仍是有限数」，
 * 因此调用方必须先按 projectTotalParamCount 的 kind 决定是否估算（QuickTrain 已接通）。
 */
export function estimateEpochSecondsPerEpoch(input: EpochEstimateInput): number | null {
  if (!isDisplayableCount(input.totalParams)) return null;
  if (!isDisplayableCount(input.batchSize)) return null;
  if (!isDisplayableCount(input.throughput) || input.throughput === 0) return null;

  const scaled = input.totalParams * input.batchSize;
  if (!Number.isSafeInteger(scaled)) return null;

  const seconds = Math.ceil(scaled / input.throughput);
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  return seconds;
}
