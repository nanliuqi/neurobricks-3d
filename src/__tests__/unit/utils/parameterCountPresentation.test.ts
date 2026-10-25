/**
 * N4 参数量展示规则的单元测试：资格判定、格式化、总量投影、几何宽度与耗时预估。
 * 证据边界：这里只验证纯函数结论，真实 WebGL/Three 几何与桌面渲染由组件用例与人工复测负责。
 */
import { describe, expect, it } from 'vitest';
import {
  estimateEpochSecondsPerEpoch,
  isDisplayableCount,
  PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH,
  PARAM_COUNT_UNAVAILABLE_TEXT,
  paramCountToBlockWidth,
  projectParamCount,
  projectTotalParamCount,
} from '@/utils/parameterCountPresentation';

/** 原始宽度公式：本轮只要求「合法值逐点不变」，因此把它作为对照参考而不是再次抽象。 */
function legacyBlockWidth(paramCount: number): number {
  return Math.max(1, Math.log2(paramCount + 1) * 0.3 + 1);
}

/** 原始耗时公式，同样只作对照。 */
function legacyEpochSeconds(totalParams: number, batchSize: number, throughput: number): number {
  return totalParams > 0 ? Math.ceil(totalParams * batchSize / throughput) : 0;
}

describe('唯一规则来源：N2 入口只做委托', () => {
  it('networkStructureViewModel 导出的规则与共享模块是同一份实现', async () => {
    const shared = await import('@/utils/parameterCountPresentation');
    const viewModel = await import('@/utils/networkStructureViewModel');
    expect(viewModel.projectParamCount).toBe(shared.projectParamCount);
    expect(viewModel.PARAM_COUNT_UNAVAILABLE_TEXT).toBe(shared.PARAM_COUNT_UNAVAILABLE_TEXT);
  });
});

const ILLEGAL_COUNTS: Array<[string, unknown]> = [
  ['NaN', Number.NaN],
  ['+Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['负数', -1],
  ['小数', 1.5],
  ['缺失 undefined', undefined],
  ['缺失 null', null],
  ['字符串数字', '896'],
  ['带千分位字符串', '1,234,567'],
  ['布尔', true],
  ['对象', {}],
  ['超出安全整数', 2 ** 53],
  ['极大有限浮点', 1e300],
];

describe('isDisplayableCount：唯一资格判定', () => {
  it('0 与常规正整数合法（0 是「无参数层」的正常值，不是缺失）', () => {
    expect(isDisplayableCount(0)).toBe(true);
    expect(isDisplayableCount(1)).toBe(true);
    expect(isDisplayableCount(896)).toBe(true);
    expect(isDisplayableCount(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('非有限 / 非整数 / 负数 / 非数值 / 超出可精确表示范围一律不达标', () => {
    for (const [, value] of ILLEGAL_COUNTS) {
      expect(isDisplayableCount(value), `value=${String(value)}`).toBe(false);
    }
  });
});

describe('projectParamCount：展示文本口径', () => {
  it('合法值沿用 toLocaleString 原有格式', () => {
    expect(projectParamCount(0)).toBe('0');
    expect(projectParamCount(896)).toBe('896');
    expect(projectParamCount(1234567)).toBe((1234567).toLocaleString());
    expect(projectParamCount(448)).toBe('448');
  });

  it('非法与缺失值返回 null（交给界面显示「不可用」），不 fallback 成 0', () => {
    for (const [label, value] of ILLEGAL_COUNTS) {
      expect(projectParamCount(value), label).toBeNull();
    }
    expect(PARAM_COUNT_UNAVAILABLE_TEXT).toBe('不可用');
    expect(projectParamCount(0)).not.toBeNull();
  });

  it('合法值文本不含 NaN / Infinity / 科学计数法，非法值不产出文本', () => {
    for (const value of [0, 1, 448, 896, 1_234_567, 50_000_000, Number.MAX_SAFE_INTEGER]) {
      const text = projectParamCount(value);
      expect(text, `value=${value}`).not.toBeNull();
      expect(text).not.toMatch(/NaN|Infinity|e\+|e-/);
    }
    for (const [label, value] of ILLEGAL_COUNTS) {
      expect(projectParamCount(value), label).toBeNull();
    }
  });
});

describe('projectTotalParamCount：总量不得冒充完整', () => {
  const layer = (id: string, paramCount: unknown) => ({ id, paramCount });

  it('全部层与总量合法时给出可用总量文本', () => {
    const result = projectTotalParamCount({
      totalParams: 1344,
      layers: [layer('conv-1', 896), layer('fc-1', 448)],
    });
    expect(result.kind).toBe('available');
    expect(result.text).toBe('1,344');
    expect(result.unavailableLayerIds).toEqual([]);
    expect(result.unavailableRecordCount).toBe(0);
    expect(result.unavailableRecordPositions).toEqual([]);
  });

  it('非法记录没有 ID 也必须使总量不可用：资格判定不依赖能否取到 ID', () => {
    // 已确认的坏输入：总量有限、一条合法、另一条 paramCount=NaN 且取不到 ID。
    // 旧实现按 ID 列表长度判定，这一条会被凭空跳过并把 896 说成完整总量。
    const result = projectTotalParamCount({
      totalParams: 896,
      layers: [{ id: 'ok', paramCount: 896 }, { paramCount: Number.NaN }],
    });
    expect(result.kind).toBe('unavailable');
    expect(result.text).toBe('不可用');
    expect(result.text).not.toBe('896');
    expect(result.unavailableLayerIds).toEqual([]);
    expect(result.unavailableRecordCount).toBe(1);
    expect(result.unavailableRecordPositions).toEqual([2]);
    expect(result.hint).toContain('第 2 条记录');
    expect(result.hint).not.toMatch(/undefined|object/i);
  });

  it('两条坏记录共用同一个 ID：判定用记录数量，不用去重后的 ID 长度', () => {
    const result = projectTotalParamCount({
      totalParams: 896,
      layers: [layer('dup', Number.NaN), layer('dup', -1)],
    });
    expect(result.kind).toBe('unavailable');
    expect(result.unavailableRecordCount).toBe(2);
    expect(result.unavailableLayerIds).toEqual(['dup']);
  });

  it('空字符串 ID 不用于定位，也不伪造一个 ID 写进说明', () => {
    const result = projectTotalParamCount({
      totalParams: 896,
      layers: [{ id: '   ', paramCount: Number.NaN }] as never[],
    });
    expect(result.kind).toBe('unavailable');
    expect(result.unavailableLayerIds).toEqual([]);
    expect(result.unavailableRecordPositions).toEqual([1]);
    expect(result.hint).toContain('第 1 条记录');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['字符串', 'conv-1'],
    ['数字', 896],
    ['布尔', true],
    ['函数', () => 0],
    ['空数组', []],
  ])('列表里的 %s 读不出合格的参数量：按不达标记录处理，不跳过', (_label, value) => {
    const result = projectTotalParamCount({
      totalParams: 896,
      layers: [layer('ok', 896), value] as never[],
    });
    expect(result.kind, _label).toBe('unavailable');
    expect(result.unavailableRecordCount, _label).toBe(1);
    expect(result.unavailableRecordPositions, _label).toEqual([2]);
  });

  it('层列表本身不是数组时无从核验任何记录，不默认放行', () => {
    const result = projectTotalParamCount({ totalParams: 896, layers: undefined as never });
    expect(result.kind).toBe('unavailable');
    expect(result.text).toBe('不可用');
    expect(result.unavailableRecordCount).toBe(1);
    expect(result.hint).toContain('层列表不可用');
  });

  it('某层记录非法时，即使总量是有限数字也不宣称完整（不做只加总合法层的降级求和）', () => {
    // 手工构造「总量有限、单层非法」的状态：真实求和会得到 NaN，
    // 但展示规则不能依赖这一点，必须自己识别层的记录质量。
    const result = projectTotalParamCount({
      totalParams: 896,
      layers: [layer('conv-1', 896), layer('relu-1', Number.NaN)],
    });
    expect(result.kind).toBe('unavailable');
    expect(result.text).toBe('不可用');
    expect(result.text).not.toBe('896');
    expect(result.unavailableLayerIds).toEqual(['relu-1']);
    expect(result.unavailableRecordCount).toBe(1);
    expect(result.hint).toContain('relu-1');
  });

  it('总量自身非法（超安全整数）时不可用，而不是显示一个可能错位的数字', () => {
    const result = projectTotalParamCount({
      totalParams: 2 ** 53,
      layers: [layer('conv-1', 2 ** 53)],
    });
    expect(result.kind).toBe('unavailable');
    expect(result.text).toBe('不可用');
    expect(result.text).not.toBe((2 ** 53).toLocaleString());
  });

  it('合法 0 与空网络保持原有表现，不当成缺失或异常', () => {
    const empty = projectTotalParamCount({ totalParams: 0, layers: [] });
    expect(empty.kind).toBe('available');
    expect(empty.text).toBe('0');
    expect(empty.unavailableRecordCount).toBe(0);

    const zeroLayers = projectTotalParamCount({
      totalParams: 0,
      layers: [layer('relu-1', 0), layer('pool-1', 0)],
    });
    expect(zeroLayers.kind).toBe('available');
    expect(zeroLayers.text).toBe('0');
    expect(zeroLayers.unavailableRecordCount).toBe(0);
  });

  it('列表里的 null / undefined 记录判为不达标：总量不可用，不靠跳过它们凑出完整', () => {
    // 空列表是合法的空网络；非空列表里的读不出记录不是「可以忽略的记录」
    expect(projectTotalParamCount({ totalParams: 0, layers: [] as never[] }).kind).toBe('available');

    const result = projectTotalParamCount({ totalParams: 896, layers: [null, undefined, layer('a', 896)] as never[] });
    expect(result.kind).toBe('unavailable');
    expect(result.text).toBe('不可用');
    expect(result.text).not.toBe('896');
    expect(result.unavailableRecordCount).toBe(2);
    expect(result.unavailableLayerIds).toEqual([]);
    expect(result.unavailableRecordPositions).toEqual([1, 2]);
    expect(result.hint).toContain('第 1 条记录');
    expect(result.hint).toContain('第 2 条记录');

    const missingField = projectTotalParamCount({ totalParams: 0, layers: [{ id: 'x' } as never] });
    expect(missingField.kind).toBe('unavailable');
    expect(missingField.unavailableLayerIds).toEqual(['x']);
    expect(missingField.unavailableRecordCount).toBe(1);
  });

  it('不修改传入的层对象（冻结夹具验证只读取）', () => {
    const frozen = Object.freeze({ id: 'conv-1', paramCount: Number.NaN });
    const list = Object.freeze([frozen]);
    const result = projectTotalParamCount({ totalParams: Number.NaN, layers: list as readonly never[] });
    expect(result.kind).toBe('unavailable');
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.is(frozen.paramCount, Number.NaN)).toBe(true);
  });

  it('总量有限 + 坏记录取不到 ID：不回填 ID、不改动记录、也不裁剪列表', () => {
    const frozenBad = Object.freeze({ paramCount: Number.NaN });
    const list = Object.freeze([Object.freeze({ id: 'ok', paramCount: 896 }), frozenBad]);
    const result = projectTotalParamCount({ totalParams: 896, layers: list as readonly never[] });
    expect(result.kind).toBe('unavailable');
    expect(result.unavailableLayerIds).toEqual([]);
    expect(result.unavailableRecordPositions).toEqual([2]);
    expect(list).toHaveLength(2);
    expect(Object.isFrozen(frozenBad)).toBe(true);
    expect((frozenBad as { id?: unknown }).id).toBeUndefined();
    expect(Object.is(frozenBad.paramCount, Number.NaN)).toBe(true);
  });
});

describe('paramCountToBlockWidth：几何只能是有限正数', () => {
  it('合法参数量的宽度与原公式逐点一致', () => {
    const samples = [0, 1, 2, 10, 64, 448, 896, 7840, 1_000_000, 1234567, 50_000_000];
    for (const value of samples) {
      expect(paramCountToBlockWidth(value), `paramCount=${value}`).toBe(legacyBlockWidth(value));
    }
    expect(paramCountToBlockWidth(0)).toBe(1);
  });

  it('非法参数宽度是有限正数占位值，且不写入 NaN / Infinity / 负数', () => {
    for (const [label, value] of ILLEGAL_COUNTS) {
      const width = paramCountToBlockWidth(value);
      expect(Number.isFinite(width), label).toBe(true);
      expect(width > 0, label).toBe(true);
    }
    expect(paramCountToBlockWidth(Number.NaN)).toBe(PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH);
  });

  it('占位宽度落在合法映射取不到的区间，因此不会被看成 0 参数积木', () => {
    // 合法整数宽度只有两种：恰为 1（0 参数）或不小于 log2(2)*0.3+1 = 1.3
    expect(paramCountToBlockWidth(0)).toBe(1);
    expect(paramCountToBlockWidth(1)).toBeCloseTo(1.3, 10);
    expect(PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH).toBeGreaterThan(1);
    expect(PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH).toBeLessThan(1.3);

    const reachable = new Set<number>();
    for (let count = 0; count <= 200000; count += 1) reachable.add(paramCountToBlockWidth(count));
    expect(reachable.has(PARAM_COUNT_PLACEHOLDER_BLOCK_WIDTH)).toBe(false);

    const zeroWidth = paramCountToBlockWidth(0);
    expect(paramCountToBlockWidth(Number.NaN)).not.toBe(zeroWidth);
  });
});

describe('estimateEpochSecondsPerEpoch：不可估算就说不可估算', () => {
  it('合法输入与原公式逐点一致', () => {
    for (const total of [0, 1, 896, 1234567, 50_000_000]) {
      for (const batch of [1, 32, 512]) {
        for (const throughput of [5000, 50000]) {
          expect(
            estimateEpochSecondsPerEpoch({ totalParams: total, batchSize: batch, throughput }),
            `total=${total} batch=${batch} throughput=${throughput}`,
          ).toBe(legacyEpochSeconds(total, batch, throughput));
        }
      }
    }
  });

  it('参数量不可用 → null（不是 0 秒，也不是 NaN）', () => {
    for (const [label, value] of ILLEGAL_COUNTS) {
      expect(estimateEpochSecondsPerEpoch({ totalParams: value, batchSize: 32, throughput: 5000 }), label).toBeNull();
    }
  });

  it('批量或吞吐非法 → null', () => {
    expect(estimateEpochSecondsPerEpoch({ totalParams: 896, batchSize: Number.NaN, throughput: 5000 })).toBeNull();
    expect(estimateEpochSecondsPerEpoch({ totalParams: 896, batchSize: -1, throughput: 5000 })).toBeNull();
    expect(estimateEpochSecondsPerEpoch({ totalParams: 896, batchSize: 0, throughput: 5000 })).toBe(0);
    expect(estimateEpochSecondsPerEpoch({ totalParams: 896, batchSize: 32, throughput: Number.NaN })).toBeNull();
    expect(estimateEpochSecondsPerEpoch({ totalParams: 896, batchSize: 32, throughput: 0 })).toBeNull();
  });

  it('中间乘积或结果超出可精确表示范围 → null，不显示一个末位不可信的秒数', () => {
    // MAX_SAFE_INTEGER × 512 已越过精确整数范围：结果即使是有限整数也不再冒充估计
    const overflowing = estimateEpochSecondsPerEpoch({
      totalParams: Number.MAX_SAFE_INTEGER,
      batchSize: 512,
      throughput: 5000,
    });
    expect(overflowing).toBeNull();

    // 仍在范围内的合法组合照旧给出估计
    expect(estimateEpochSecondsPerEpoch({
      totalParams: 50_000_000,
      batchSize: 512,
      throughput: 5000,
    })).toBe(5_120_000);
  });

  it('数值来自原始记录：带千分位的展示文字不会被反解析成数字', () => {
    expect(estimateEpochSecondsPerEpoch({
      totalParams: 1234567,
      batchSize: 32,
      throughput: 5000,
    })).toBe(Math.ceil(1234567 * 32 / 5000));

    // 「1,234,567」这种展示文字（Number() 会得到 NaN，parseInt 会得到 1）必须判为不可用
    expect(estimateEpochSecondsPerEpoch({
      totalParams: '1,234,567',
      batchSize: 32,
      throughput: 5000,
    })).toBeNull();
  });
});
