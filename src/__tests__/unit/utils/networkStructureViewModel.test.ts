/**
 * N2 逐层结构清单的纯投影契约：
 * 只读取 store 已记录事实、不重算、不回填默认形状、不修改任何输入，
 * 并且「有推导输出 / 已记录错误 / 形状未知」三个维度彼此独立。
 */
import { describe, expect, it } from 'vitest';
import {
  ERROR_DETAIL_MISSING_TEXT,
  PARAM_COUNT_UNAVAILABLE_TEXT,
  SHAPE_INVALID_TEXT,
  UPSTREAM_INVALID_TEXT,
  UPSTREAM_ENTRY_TEXT,
  UPSTREAM_UNKNOWN_TEXT,
  buildNetworkStructureViewModel,
  classifyShapeRecord,
  projectParamCount,
} from '@/utils/networkStructureViewModel';
import { LAYER_META_LIST, DEFAULT_INPUT_SHAPE } from '@/types/layer';
import type { Layer3D, LayerType, ShapeValidationError, TensorShape, ValidationResult } from '@/types/layer';

function makeLayer(
  id: string,
  type: LayerType,
  order: number,
  outputShape: TensorShape | null,
  extra: Partial<Layer3D> = {},
): Layer3D {
  return {
    id,
    type,
    params: {},
    order,
    position: [0, order, 0],
    outputShape,
    paramCount: 0,
    validationError: null,
    ...extra,
  };
}

function okResult(errors: ShapeValidationError[] = []): ValidationResult {
  return { isValid: errors.length === 0, errors, warnings: [] };
}

function errorOf(layerId: string, message: string, suggestion = '检查前一层'): ShapeValidationError {
  return {
    layerId,
    layerType: 'Conv2D',
    errorType: 'param_conflict',
    message,
    suggestion,
    expectedInputShape: null,
    actualInputShape: null,
  };
}

function deepSnapshot(layers: readonly Layer3D[]) {
  return JSON.parse(JSON.stringify(layers));
}

/**
 * NaN / Infinity 会被 JSON 序列化成 null，因此非法数据的不可变性检查
 * 不能使用 JSON 快照：改用结构化克隆 + 逐维 Object.is 断言。
 */
function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

/** 冻结层对象与形状数组：任何原地写入会直接抛错，而不只是让断言变绿。 */
function frozenLayer(layer: Layer3D): Layer3D {
  if (Array.isArray(layer.outputShape)) Object.freeze(layer.outputShape);
  return Object.freeze(layer);
}

describe('buildNetworkStructureViewModel：顺序与不可变性', () => {
  it('空网络返回空清单并标记为空', () => {
    const model = buildNetworkStructureViewModel({ layers: [], validationResult: okResult() });
    expect(model.isEmpty).toBe(true);
    expect(model.rows).toEqual([]);
    expect(model.layerCount).toBe(0);
    expect(model.errorLayerCount).toBe(0);
  });

  it('乱序输入按 order 排序展示，且原数组与层对象完全不被修改', () => {
    const layers = [
      makeLayer('c', 'MaxPool2D', 2, [3, 5, 7]),
      makeLayer('a', 'Input', 0, [3, 20, 20]),
      makeLayer('b', 'Conv2D', 1, [3, 10, 10]),
    ];
    const arrayRef = layers;
    const shapeRefs = layers.map(l => l.outputShape);
    const before = deepSnapshot(layers);

    const model = buildNetworkStructureViewModel({ layers, validationResult: okResult() });

    expect(model.rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(model.rows.map(r => r.index)).toEqual([1, 2, 3]);
    // 输入侧：数组引用未变、未被原地 sort、值未被改写
    expect(layers).toBe(arrayRef);
    expect(deepSnapshot(layers)).toEqual(before);
    layers.forEach((layer, i) => expect(layer.outputShape).toBe(shapeRefs[i]));
  });

  it('多次投影结果稳定且不产生任何输入侧副作用', () => {
    const layers = [
      makeLayer('a', 'Input', 0, [3, 24, 40], { paramCount: 0 }),
      makeLayer('b', 'Conv2D', 1, [8, 12, 20], { paramCount: 896 }),
    ];
    const result = okResult();
    const before = deepSnapshot(layers);
    const resultBefore = JSON.parse(JSON.stringify(result));

    const first = buildNetworkStructureViewModel({ layers, validationResult: result });
    const second = buildNetworkStructureViewModel({ layers, validationResult: result });

    expect(second).toEqual(first);
    expect(deepSnapshot(layers)).toEqual(before);
    expect(JSON.parse(JSON.stringify(result))).toEqual(resultBefore);
  });
});

describe('buildNetworkStructureViewModel：上游与输出的诚实呈现', () => {
  it('三维形状保持存储顺序，一维不补 batch 维', () => {
    const layers = [
      makeLayer('a', 'Input', 0, [3, 24, 40]),
      makeLayer('b', 'Flatten', 1, [784]),
    ];
    const model = buildNetworkStructureViewModel({ layers, validationResult: okResult() });

    expect(model.rows[0].outputText).toBe('[3, 24, 40]');
    expect(model.rows[1].outputText).toBe('[784]');
    expect(model.rows[1].upstreamText).toBe('[3, 24, 40]');
    expect(model.rows[1].upstreamKind).toBe('recorded');
    expect(model.rows[1].outputText).not.toContain('1, 784');
  });

  it('首层为 Input 标记为网络入口', () => {
    const model = buildNetworkStructureViewModel({
      layers: [makeLayer('a', 'Input', 0, [3, 24, 40])],
      validationResult: okResult(),
    });
    expect(model.rows[0].upstreamKind).toBe('entry');
    expect(model.rows[0].upstreamText).toBe(UPSTREAM_ENTRY_TEXT);
  });

  it('首层不是 Input 时不猜测上游，也不回填默认输入形状', () => {
    const model = buildNetworkStructureViewModel({
      layers: [makeLayer('a', 'Conv2D', 0, [32, 26, 26])],
      validationResult: okResult(),
    });
    expect(model.rows[0].upstreamKind).toBe('unknown');
    expect(model.rows[0].upstreamText).toBe(UPSTREAM_UNKNOWN_TEXT);
    const defaultText = `[${DEFAULT_INPUT_SHAPE.join(', ')}]`;
    expect(model.rows[0].upstreamText).not.toBe(defaultText);
  });

  it('上游输出缺失时只说“未记录”，不冒充真实已知输入', () => {
    const layers = [
      makeLayer('a', 'Linear', 0, null),
      makeLayer('b', 'ReLU', 1, null),
    ];
    const model = buildNetworkStructureViewModel({ layers, validationResult: okResult() });
    expect(model.rows[1].upstreamKind).toBe('unknown');
    expect(model.rows[1].upstreamText).toBe(UPSTREAM_UNKNOWN_TEXT);
    expect(model.rows[1].outputKnown).toBe(false);
    expect(model.rows[1].statusKind).toBe('shapeUnknown');
  });

  it('上游的声明参数不会被当作上游实际形状', () => {
    const layers = [
      makeLayer('a', 'Input', 0, [5, 7, 19]),
      makeLayer('b', 'Linear', 1, [120], { params: { inFeatures: 784 } }),
    ];
    const model = buildNetworkStructureViewModel({ layers, validationResult: okResult() });
    expect(model.rows[1].upstreamText).toBe('[5, 7, 19]');
    expect(model.rows[1].upstreamText).not.toContain('784');
  });

  it('本层输出缺失时沿用共享未知表示并标记 outputKnown=false', () => {
    const model = buildNetworkStructureViewModel({
      layers: [makeLayer('a', 'Conv2D', 0, null)],
      validationResult: okResult(),
    });
    expect(model.rows[0].outputText).toBe('?');
    expect(model.rows[0].outputKnown).toBe(false);
  });
});

describe('buildNetworkStructureViewModel：错误、状态与参数量', () => {
  it('有推导输出但已记录结构错误时，状态仍是错误，不标为可运行', () => {
    const layers = [
      makeLayer('a', 'Input', 0, [1, 28, 28]),
      makeLayer('b', 'Conv2D', 1, [32, 26, 26], {
        params: { inChannels: 3 },
        validationError: 'Conv2D 输入通道不匹配：inChannels=3，但上游输出为 [1, 28, 28]',
      }),
    ];
    const model = buildNetworkStructureViewModel({
      layers,
      validationResult: okResult([
        errorOf('b', 'Conv2D 输入通道不匹配：inChannels=3，但上游输出为 [1, 28, 28]', '将 inChannels 修改为 1'),
      ]),
    });

    const row = model.rows[1];
    expect(row.outputKnown).toBe(true);
    expect(row.outputText).toBe('[32, 26, 26]');
    expect(row.hasRecordedError).toBe(true);
    expect(row.statusKind).toBe('error');
    expect(row.statusText).toBe('已记录结构错误');
    expect(row.statusText).not.toMatch(/正常|可训练|可运行/);
  });

  it('同一信息在 errors 与 layer.validationError 中重复时只显示一次', () => {
    const message = '第 2 层 (Linear) 无法推导输出形状，输入形状为 ?';
    const layers = [
      makeLayer('a', 'Conv2D', 0, null),
      makeLayer('b', 'Linear', 1, null, { validationError: message }),
    ];
    const model = buildNetworkStructureViewModel({
      layers,
      validationResult: okResult([errorOf('b', message, '在 Linear 层前添加 Flatten 层')]),
    });
    expect(model.rows[1].errorMessages).toEqual([message]);
    expect(model.rows[1].suggestions).toEqual(['在 Linear 层前添加 Flatten 层']);
  });

  it('没有可用 layerId 的错误不猜测归属', () => {
    const layers = [makeLayer('a', 'Conv2D', 0, [32, 26, 26])];
    const model = buildNetworkStructureViewModel({
      layers,
      validationResult: okResult([errorOf('', '缺少层归属的形状错误')]),
    });
    expect(model.rows[0].hasRecordedError).toBe(false);
    expect(model.rows[0].errorMessages).toEqual([]);
    expect(model.errorLayerCount).toBe(0);
  });

  it('错误归属只按层 ID，不按 warning 文本猜测', () => {
    const layers = [
      makeLayer('a', 'Conv2D', 0, [32, 26, 26]),
      makeLayer('b', 'MaxPool2D', 1, [32, 13, 13]),
    ];
    const model = buildNetworkStructureViewModel({
      layers,
      validationResult: {
        isValid: false,
        errors: [errorOf('b', '第 2 层 输出异常')],
        warnings: ['第 1 层 (Conv2D) 输出形状异常：[32, 0, 0]'],
      },
    });
    expect(model.rows[0].hasRecordedError).toBe(false);
    expect(model.rows[1].hasRecordedError).toBe(true);
    expect(model.rows[0].errorMessages).toEqual([]);
  });

  it('上游已记录错误时，后续行提示仅供定位，且自身错误维度仍然独立', () => {
    const layers = [
      makeLayer('a', 'Conv2D', 0, [32, 26, 26]),
      makeLayer('b', 'MaxPool2D', 1, [32, 13, 13]),
      makeLayer('c', 'Flatten', 2, [5408]),
    ];
    const model = buildNetworkStructureViewModel({
      layers,
      validationResult: okResult([errorOf('b', '第 2 层 输出异常')]),
    });
    expect(model.rows[0].upstreamHasError).toBe(false);
    expect(model.rows[1].upstreamHasError).toBe(false);
    expect(model.rows[1].hasRecordedError).toBe(true);
    expect(model.rows[2].upstreamHasError).toBe(true);
    expect(model.rows[2].hasRecordedError).toBe(false);
    expect(model.rows[2].outputKnown).toBe(true);
  });

  it('参数量 0 是合法值，非法或缺失值不伪装成 0', () => {
    expect(projectParamCount(0)).toBe('0');
    expect(projectParamCount(896)).toBe('896');
    expect(projectParamCount(Number.NaN)).toBeNull();
    expect(projectParamCount(Infinity)).toBeNull();
    expect(projectParamCount(-1)).toBeNull();
    expect(projectParamCount(1.5)).toBeNull();
    expect(projectParamCount(undefined)).toBeNull();
    expect(projectParamCount('12' as unknown)).toBeNull();

    const layers = [
      makeLayer('a', 'Dropout', 0, [3, 24, 40], { paramCount: 0 }),
      makeLayer('b', 'Conv2D', 1, [8, 12, 20], { paramCount: Number.NaN }),
    ];
    const model = buildNetworkStructureViewModel({ layers, validationResult: okResult() });
    expect(model.rows[0].paramCountText).toBe('0');
    expect(model.rows[1].paramCountText).toBeNull();
    expect(PARAM_COUNT_UNAVAILABLE_TEXT).toBe('不可用');
  });
});

describe('buildNetworkStructureViewModel：元信息复用', () => {
  it('层名称与说明来自共享 LAYER_META_LIST，不是第二份表', () => {
    const layers: Layer3D[] = ['Input', 'Conv2D', 'MaxPool2D', 'Linear', 'Flatten'].map((type, i) =>
      makeLayer(`m-${type}`, type as LayerType, i, null),
    );
    const model = buildNetworkStructureViewModel({ layers, validationResult: okResult() });

    model.rows.forEach((row, i) => {
      const meta = LAYER_META_LIST.find(item => item.type === row.type);
      expect(meta).toBeDefined();
      expect(row.label).toBe(meta?.label);
      expect(row.description).toBe(meta?.description);
      expect(row.id).toBe(layers[i].id);
    });
  });
});

describe('形状记录的展示资格', () => {
  const illegalDims: Array<[string, unknown]> = [
    ['NaN', Number.NaN],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['零', 0],
    ['负数', -8],
    ['小数', 12.5],
    ['字符串数字', '24'],
    ['null', null],
    ['undefined', undefined],
    ['布尔', true],
  ];

  it.each(illegalDims)('维度为%s时记录判定为 invalid，不是 valid 也不是 missing', (_label, dim) => {
    expect(classifyShapeRecord([8, dim as number, 20])).toBe('invalid');
  });

  it('正常三维与一维记录仍是可展示形状，缺失记录仍区分于非法记录', () => {
    expect(classifyShapeRecord([3, 24, 40])).toBe('valid');
    expect(classifyShapeRecord([784])).toBe('valid');
    expect(classifyShapeRecord([1])).toBe('valid');
    expect(classifyShapeRecord(null)).toBe('missing');
    expect(classifyShapeRecord([])).toBe('missing');
    expect(classifyShapeRecord(undefined)).toBe('missing');
    expect(classifyShapeRecord([8, Number.NaN, 20])).toBe('invalid');
  });

  it('本层记录非法时不获得 outputKnown，也不显示「形状已静态推导」', () => {
    const model = buildNetworkStructureViewModel({
      layers: [makeLayer('a', 'Conv2D', 0, [8, Number.NaN, 20])],
      validationResult: okResult(),
    });
    const row = model.rows[0];
    expect(row.outputKnown).toBe(false);
    expect(row.outputShapeInvalid).toBe(true);
    expect(row.statusKind).toBe('shapeInvalid');
    expect(row.statusText).toBe(SHAPE_INVALID_TEXT);
    expect(row.statusText).not.toBe('形状已静态推导');
    expect(row.outputText).toBe(SHAPE_INVALID_TEXT);
    expect(row.outputText).not.toMatch(/NaN|Infinity/);
  });

  it('零维与负维度记录同样被拒绝，不被修正也不被当作有效形状', () => {
    const model = buildNetworkStructureViewModel({
      layers: [
        makeLayer('a', 'Conv2D', 0, [8, 0, 0]),
        makeLayer('b', 'Conv2D', 1, [8, -1, 20]),
        makeLayer('c', 'Conv2D', 2, [8, 12.5, 20]),
      ],
      validationResult: okResult(),
    });
    expect(model.rows.map(r => r.statusKind)).toEqual(['shapeInvalid', 'shapeInvalid', 'shapeInvalid']);
    expect(model.rows.map(r => r.outputText)).toEqual([SHAPE_INVALID_TEXT, SHAPE_INVALID_TEXT, SHAPE_INVALID_TEXT]);
  });

  it('非法上游记录不升级为已知输入', () => {
    const layers = [
      makeLayer('a', 'Conv2D', 0, [8, Number.NaN, 20]),
      makeLayer('b', 'ReLU', 1, [3, 24, 40]),
    ];
    const model = buildNetworkStructureViewModel({ layers, validationResult: okResult() });
    expect(model.rows[1].upstreamKind).toBe('invalid');
    expect(model.rows[1].upstreamKind).not.toBe('recorded');
    expect(model.rows[1].upstreamText).toBe(UPSTREAM_INVALID_TEXT);
    expect(model.rows[1].upstreamText).not.toMatch(/NaN/);
  });

  it('「未记录」与「记录了但非法」在状态与上游两个位置都能区分', () => {
    const missing = buildNetworkStructureViewModel({
      layers: [makeLayer('a', 'Linear', 0, null), makeLayer('b', 'ReLU', 1, null)],
      validationResult: okResult(),
    });
    const invalid = buildNetworkStructureViewModel({
      layers: [
        makeLayer('a', 'Linear', 0, [Number.POSITIVE_INFINITY]),
        makeLayer('b', 'ReLU', 1, null),
      ],
      validationResult: okResult(),
    });

    expect(missing.rows[0].statusKind).toBe('shapeUnknown');
    expect(missing.rows[0].outputShapeInvalid).toBe(false);
    expect(missing.rows[1].upstreamKind).toBe('unknown');
    expect(missing.rows[1].upstreamText).toBe(UPSTREAM_UNKNOWN_TEXT);

    expect(invalid.rows[0].statusKind).toBe('shapeInvalid');
    expect(invalid.rows[0].outputShapeInvalid).toBe(true);
    expect(invalid.rows[1].upstreamKind).toBe('invalid');
    expect(invalid.rows[1].upstreamText).toBe(UPSTREAM_INVALID_TEXT);
  });

  it('非法记录被原样保留：不删除维度、不转换、不取绝对值、不四舍五入、不补默认形状', () => {
    const shapes: TensorShape[] = [
      [8, Number.NaN, 20],
      [8, Number.POSITIVE_INFINITY, 20],
      [8, Number.NEGATIVE_INFINITY, 20],
      [8, 0, -3],
      [12.5, '24' as unknown as number, true as unknown as number],
    ];
    const layers = shapes.map((shape, i) =>
      frozenLayer(makeLayer(`frozen-${i}`, 'Conv2D', i, shape)),
    );
    const layersRef = layers;
    const shapeRefs = layers.map(layer => layer.outputShape);
    const before = cloneSnapshot(layers);

    const model = buildNetworkStructureViewModel({ layers, validationResult: okResult() });

    // 冻结对象上的原地写入会抛 TypeError；此处仅确认引用、维度值与类型完全未变
    expect(layers).toBe(layersRef);
    layers.forEach((layer, i) => expect(layer.outputShape).toBe(shapeRefs[i]));
    expect(model.rows.every(row => row.outputShapeInvalid)).toBe(true);

    const actual = cloneSnapshot(layers);
    expect(actual).toEqual(before);
    expect(Object.is(actual[0].outputShape[1], Number.NaN)).toBe(true);
    expect(Object.is(actual[1].outputShape[1], Number.POSITIVE_INFINITY)).toBe(true);
    expect(Object.is(actual[2].outputShape[1], Number.NEGATIVE_INFINITY)).toBe(true);
    expect(actual[3].outputShape).toEqual([8, 0, -3]);
    expect(actual[4].outputShape[1]).toBe('24');
    expect(actual[4].outputShape[2]).toBe(true);
    // JSON 快照会把 NaN 变成 null，因此额外确认序列化差异存在（说明必须用克隆检查）
    expect(JSON.stringify(layers[0].outputShape)).toBe('[8,null,20]');
    expect(`[${DEFAULT_INPUT_SHAPE.join(', ')}]`).toBe('[1, 28, 28]');
    expect(model.rows[0].outputText).not.toContain('1, 28, 28');
  });

  it('非法输出层同时有归属错误时，错误状态优先且仍不显示为有效形状', () => {
    const model = buildNetworkStructureViewModel({
      layers: [makeLayer('a', 'Conv2D', 0, [8, Number.NaN, 20])],
      validationResult: okResult([errorOf('a', '第 1 层输出形状含非法维度')]),
    });
    expect(model.rows[0].statusKind).toBe('error');
    expect(model.rows[0].outputKnown).toBe(false);
    expect(model.rows[0].outputShapeInvalid).toBe(true);
    expect(model.rows[0].outputText).toBe(SHAPE_INVALID_TEXT);
    expect(model.errorLayerCount).toBe(1);
  });

  it('正常形状与参数量 0 的行为不因资格检查回归', () => {
    const model = buildNetworkStructureViewModel({
      layers: [
        makeLayer('a', 'Input', 0, [3, 24, 40], { paramCount: 0 }),
        makeLayer('b', 'Flatten', 1, [2880], { paramCount: 0 }),
      ],
      validationResult: okResult(),
    });
    expect(model.rows.map(r => r.statusKind)).toEqual(['derived', 'derived']);
    expect(model.rows.map(r => r.outputShapeInvalid)).toEqual([false, false]);
    expect(model.rows.map(r => r.paramCountText)).toEqual(['0', '0']);
    expect(model.rows[1].upstreamKind).toBe('recorded');
    expect(model.rows[1].upstreamText).toBe('[3, 24, 40]');
  });
});

describe('错误存在性不依赖详情文字', () => {
  it('归属明确但 message 为空白的错误仍是错误：保留状态、计入层数并传递下游警示', () => {
    const layers = [
      makeLayer('a', 'Conv2D', 0, [32, 26, 26], { validationError: '   ' }),
      makeLayer('b', 'ReLU', 1, [32, 26, 26]),
    ];
    const model = buildNetworkStructureViewModel({
      layers,
      validationResult: okResult([errorOf('a', '   ', '把 kernelSize 改为 1')]),
    });

    expect(model.rows[0].hasRecordedError).toBe(true);
    expect(model.rows[0].errorDetailMissing).toBe(true);
    expect(model.rows[0].statusKind).toBe('error');
    expect(model.rows[0].statusText).toBe('已记录结构错误');
    expect(model.errorLayerCount).toBe(1);
    expect(model.rows[1].upstreamHasError).toBe(true);
    // 不编造原因：详情缺失时不放任何自造文案进 errorMessages
    expect(model.rows[0].errorMessages).toEqual([]);
    expect(ERROR_DETAIL_MISSING_TEXT).toBe('已记录结构错误，但详情缺失');
  });

  it('空白 message 但建议有效时建议不丢失', () => {
    const model = buildNetworkStructureViewModel({
      layers: [makeLayer('a', 'Conv2D', 0, [32, 26, 26])],
      validationResult: okResult([errorOf('a', '', '将 inChannels 修改为 3')]),
    });
    expect(model.rows[0].hasRecordedError).toBe(true);
    expect(model.rows[0].suggestions).toEqual(['将 inChannels 修改为 3']);
    expect(model.rows[0].errorMessages).toEqual([]);
  });

  it('只有 layer.validationError 为空字符串时也视为已记录错误', () => {
    const model = buildNetworkStructureViewModel({
      layers: [makeLayer('a', 'Conv2D', 0, [32, 26, 26], { validationError: '' })],
      validationResult: okResult(),
    });
    expect(model.rows[0].hasRecordedError).toBe(true);
    expect(model.errorLayerCount).toBe(1);
  });

  it('没有可用 layerId 的空白错误不被分配给任何层', () => {
    const model = buildNetworkStructureViewModel({
      layers: [makeLayer('a', 'Conv2D', 0, [32, 26, 26])],
      validationResult: okResult([errorOf('', '   '), errorOf('', '有效文字但缺归属')]),
    });
    expect(model.rows[0].hasRecordedError).toBe(false);
    expect(model.rows[0].errorMessages).toEqual([]);
    expect(model.errorLayerCount).toBe(0);
  });

  it('错误存在性改变不影响形状维度：详情缺失的层若形状非法仍标无效', () => {
    const model = buildNetworkStructureViewModel({
      layers: [makeLayer('a', 'Conv2D', 0, [8, Number.NaN, 20], { validationError: ' ' })],
      validationResult: okResult([errorOf('a', ' ')]),
    });
    expect(model.rows[0].statusKind).toBe('error');
    expect(model.rows[0].outputShapeInvalid).toBe(true);
    expect(model.rows[0].outputText).toBe(SHAPE_INVALID_TEXT);
  });
});
