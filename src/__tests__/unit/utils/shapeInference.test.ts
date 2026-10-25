import { describe, it, expect } from 'vitest';
import {
  createDerivationFailureError,
  inferOutputShape,
  findIllegalShapeOperands,
  isFiniteNonNegativeInteger,
  isFinitePositiveInteger,
  isValidTensorShape,
  validateNetwork,
} from '@/utils/shapeInference';
import type { Layer3D, LayerParams, LayerType, TensorShape } from '@/types/layer';

/** 构造 Layer3D 测试夹具 */
function makeLayer(type: LayerType, params: LayerParams, order: number): Layer3D {
  return {
    id: `layer-${order}`,
    type,
    params,
    order,
    position: [0, 0, 0],
    outputShape: null,
    paramCount: 0,
    validationError: null,
  };
}

describe('shapeInference', () => {
  describe('inferOutputShape', () => {
    it('应该正确推断 Input 层输出形状（参数完整时）', () => {
      const shape = inferOutputShape('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, [1, 28, 28]);
      expect(shape).toEqual([1, 28, 28]);
    });

    it('输入形状为 null 时应返回 null', () => {
      const shape = inferOutputShape('Conv2D', { outChannels: 32 }, null);
      expect(shape).toBeNull();
    });

    it('应该正确推断 Conv2D 层输出形状（padding=1 保持尺寸）', () => {
      const shape = inferOutputShape(
        'Conv2D',
        { outChannels: 32, kernelSize: 3, stride: 1, padding: 1 },
        [1, 28, 28]
      );
      expect(shape).toEqual([32, 28, 28]);
    });

    it('应该正确推断 Conv2D 层输出形状（padding=0 尺寸收缩）', () => {
      const shape = inferOutputShape(
        'Conv2D',
        { outChannels: 32, kernelSize: 3, stride: 1, padding: 0 },
        [1, 28, 28]
      );
      expect(shape).toEqual([32, 26, 26]);
    });

    it('应该正确推断 MaxPool2D 层输出形状', () => {
      const shape = inferOutputShape('MaxPool2D', { poolKernelSize: 2, poolStride: 2 }, [32, 28, 28]);
      expect(shape).toEqual([32, 14, 14]);
    });

    it('激活层应保持形状不变', () => {
      const shape = inferOutputShape('ReLU', {}, [32, 28, 28]);
      expect(shape).toEqual([32, 28, 28]);
    });

    it('应该正确推断 Flatten 层输出形状', () => {
      const shape = inferOutputShape('Flatten', {}, [32, 14, 14]);
      expect(shape).toEqual([6272]);
    });

    it('应该正确推断 Linear 层输出形状', () => {
      const shape = inferOutputShape('Linear', { outFeatures: 128 }, [6272]);
      expect(shape).toEqual([128]);
    });

    it('Linear 层输入为多维时应该返回 null（缺少 Flatten）', () => {
      const shape = inferOutputShape('Linear', { outFeatures: 128 }, [32, 14, 14]);
      expect(shape).toBeNull();
    });
  });

  describe('validateNetwork', () => {
    it('应该验证空网络为有效', () => {
      const result = validateNetwork([]);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('应该检测 Linear 层前缺少 Flatten 的错误', () => {
      const layers = [
        makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
        makeLayer('Linear', { inFeatures: 784, outFeatures: 10 }, 1),
      ];

      const result = validateNetwork(layers);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.errorType === 'missing_flatten')).toBe(true);
    });

    it('应该检测 Conv2D 声明输入通道与上游输出不匹配的错误', () => {
      const layers = [
        makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
        makeLayer('Conv2D', { inChannels: 3, outChannels: 32, kernelSize: 3 }, 1),
      ];

      const result = validateNetwork(layers);
      expect(result.isValid).toBe(false);
      const conflict = result.errors.find(e => e.errorType === 'param_conflict');
      expect(conflict).toBeDefined();
      expect(conflict!.suggestion).toContain('inChannels');
    });

    it('应该检测 Linear 声明输入特征数与 Flatten 输出不匹配的错误', () => {
      const layers = [
        makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
        makeLayer('Flatten', {}, 1),
        makeLayer('Linear', { inFeatures: 100, outFeatures: 10 }, 2),
      ];

      const result = validateNetwork(layers);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.errorType === 'param_conflict')).toBe(true);
    });

    it('应该验证正确的完整网络（卷积→池化→展平→全连接）', () => {
      const layers = [
        makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
        makeLayer('Conv2D', { inChannels: 1, outChannels: 32, kernelSize: 3, stride: 1, padding: 1 }, 1),
        makeLayer('ReLU', {}, 2),
        makeLayer('MaxPool2D', { poolKernelSize: 2, poolStride: 2 }, 3),
        makeLayer('Flatten', {}, 4),
        makeLayer('Linear', { inFeatures: 6272, outFeatures: 10 }, 5),
      ];

      const result = validateNetwork(layers);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  /**
   * N3：推导层自身的数值合法性。这些用例证明「非法值不产生形状」，
   * 而不是只证明界面把它显示成无效。
   */
  describe('数值合法性：非法定值一律不产生形状', () => {
    const ILLEGAL: ReadonlyArray<readonly [string, unknown]> = [
      ['文本', 'three'],
      ['空字符串', ''],
      ['NaN', Number.NaN],
      ['正无穷', Number.POSITIVE_INFINITY],
      ['负无穷', Number.NEGATIVE_INFINITY],
      ['小数', 2.5],
      ['零', 0],
      ['负数', -3],
      ['布尔', true],
    ];
    const ILLEGAL_NON_ZERO: ReadonlyArray<readonly [string, unknown]> = ILLEGAL.filter(
      ([, value]) => value !== 0,
    );
    const CONV_INPUT: TensorShape = [3, 4, 4];

    it.each(ILLEGAL)('Conv2D kernelSize 为%s 时返回 null', (_label, value) => {
      expect(
        inferOutputShape('Conv2D', { outChannels: 8, kernelSize: value as number, stride: 1, padding: 0 }, CONV_INPUT),
      ).toBeNull();
    });

    it.each(ILLEGAL)('Conv2D stride 为%s 时返回 null（0 步长同样非法）', (_label, value) => {
      expect(
        inferOutputShape('Conv2D', { outChannels: 8, kernelSize: 3, stride: value as number, padding: 0 }, CONV_INPUT),
      ).toBeNull();
    });

    it.each(ILLEGAL_NON_ZERO)('Conv2D padding 为%s 时返回 null', (_label, value) => {
      expect(
        inferOutputShape('Conv2D', { outChannels: 8, kernelSize: 3, stride: 1, padding: value as number }, CONV_INPUT),
      ).toBeNull();
    });

    it('padding=0 仍然合法，保持既有收缩算式', () => {
      expect(
        inferOutputShape('Conv2D', { outChannels: 8, kernelSize: 3, stride: 1, padding: 0 }, [3, 28, 28]),
      ).toEqual([8, 26, 26]);
    });

    it.each(ILLEGAL)('Conv2D outChannels 为%s 时返回 null', (_label, value) => {
      expect(
        inferOutputShape('Conv2D', { outChannels: value as number, kernelSize: 3, stride: 1, padding: 0 }, CONV_INPUT),
      ).toBeNull();
    });

    it.each(ILLEGAL)('MaxPool2D poolKernelSize 为%s 时返回 null', (_label, value) => {
      expect(
        inferOutputShape('MaxPool2D', { poolKernelSize: value as number, poolStride: 2 }, [8, 20, 20]),
      ).toBeNull();
    });

    it.each(ILLEGAL)('AvgPool2D poolStride 为%s 时返回 null', (_label, value) => {
      expect(
        inferOutputShape('AvgPool2D', { poolKernelSize: 2, poolStride: value as number }, [8, 20, 20]),
      ).toBeNull();
    });

    it.each(ILLEGAL_NON_ZERO)('池化 padding 为%s 时返回 null（MaxPool2D 与 AvgPool2D 同规则）', (_label, value) => {
      const params = { poolKernelSize: 2, poolStride: 2, padding: value as number };
      expect(inferOutputShape('MaxPool2D', params, [8, 20, 20])).toBeNull();
      expect(inferOutputShape('AvgPool2D', params, [8, 20, 20])).toBeNull();
    });

    it('池化 padding=0 仍然合法', () => {
      expect(inferOutputShape('MaxPool2D', { poolKernelSize: 2, poolStride: 2, padding: 0 }, [8, 20, 20])).toEqual([8, 10, 10]);
      expect(inferOutputShape('AvgPool2D', { poolKernelSize: 2, poolStride: 2, padding: 0 }, [8, 20, 20])).toEqual([8, 10, 10]);
    });

    it.each(ILLEGAL)('Linear outFeatures 为%s 时返回 null', (_label, value) => {
      expect(inferOutputShape('Linear', { outFeatures: value as number }, [6272])).toBeNull();
    });

    it.each(ILLEGAL)('Input 显式维度为%s 时返回 null，不回落到默认形状', (_label, value) => {
      expect(
        inferOutputShape('Input', { inChannels: 3, inputHeight: value as number, inputWidth: 4 }, [1, 28, 28]),
      ).toBeNull();
      // 部分提供时的非法值也不能被「未提供其余维度」掩盖
      expect(inferOutputShape('Input', { inputHeight: value as number }, [1, 28, 28])).toBeNull();
    });

    it('别名解析后的非法值不会被合法默认值掩盖', () => {
      // outChannels 缺失时 filters 是被实际使用的字段
      expect(inferOutputShape('Conv2D', { filters: 'eight' as unknown as number }, CONV_INPUT)).toBeNull();
      // 正式字段非法时，不能用合法别名顶替
      expect(inferOutputShape('Conv2D', { outChannels: 'eight' as unknown as number, filters: 8 }, CONV_INPUT)).toBeNull();
      expect(inferOutputShape('Linear', { outFeatures: Number.NaN, units: 10 }, [6272])).toBeNull();
      expect(inferOutputShape('MaxPool2D', { poolKernelSize: 0, poolSize: 2 }, [8, 20, 20])).toBeNull();
      // poolStride 未提供时继承池化核，非法的池化核不能被这一步洗白
      expect(inferOutputShape('MaxPool2D', { poolKernelSize: 'two' as unknown as number }, [8, 20, 20])).toBeNull();
    });

    it('输入侧检查不能被出口检查替代：不消费输入维度的层同样拒绝非法输入', () => {
      // Linear 只用自身的 outFeatures 生成输出，出口检查看不到输入维度里的非法值，
      // 所以输入侧守卫必须先把这些形状挡在推导之前。
      expect(inferOutputShape('Linear', { outFeatures: 10 }, [Number.NaN])).toBeNull();
      expect(inferOutputShape('Linear', { outFeatures: 10 }, ['784' as unknown as number])).toBeNull();
      expect(inferOutputShape('Linear', { outFeatures: 10 }, [Number.POSITIVE_INFINITY])).toBeNull();
      expect(inferOutputShape('Linear', { outFeatures: 10 }, [0])).toBeNull();
      expect(inferOutputShape('Linear', { outFeatures: 10 }, [-7])).toBeNull();
      expect(inferOutputShape('Linear', { outFeatures: 10 }, [784.5])).toBeNull();
      // 合法一维输入不受影响
      expect(inferOutputShape('Linear', { outFeatures: 10 }, [784])).toEqual([10]);
    });

    it.each(['ReLU', 'Sigmoid', 'Tanh', 'BatchNorm2d', 'Dropout', 'LayerNorm'] as const)(
      '%s 直通层不把非法输入形状传播成输出',
      type => {
        const illegalShapes: TensorShape[] = [
          [8, Number.NaN, 20],
          [8, Number.POSITIVE_INFINITY, 20],
          [8, Number.NEGATIVE_INFINITY, 20],
          [8, 0, 20],
          [8, -2, 20],
          [8, 12.5, 20],
          ['8' as unknown as number, 12, 20],
          [Number.NaN],
          [0],
        ];
        for (const shape of illegalShapes) {
          expect(inferOutputShape(type, {}, shape)).toBeNull();
        }
      },
    );

    it('Flatten 的连乘结果溢出或不合法时不返回形状', () => {
      expect(inferOutputShape('Flatten', {}, [1e300, 1e300])).toBeNull();
      expect(inferOutputShape('Flatten', {}, [Number.MAX_SAFE_INTEGER, 2])).toBeNull();
      expect(inferOutputShape('Flatten', {}, [2 ** 62])).toBeNull();
      // 合法乘积保持不变
      expect(inferOutputShape('Flatten', {}, [32, 14, 14])).toEqual([6272]);
    });

    it('输出侧溢出与异常结果也被拒绝（参数本身合法）', () => {
      // 每个参数与输入维度都是合法有限正整数，但算式结果超出安全整数上界
      const overflowParams = { outChannels: 8, kernelSize: 1, stride: 1, padding: Number.MAX_SAFE_INTEGER };
      expect(
        inferOutputShape('Conv2D', overflowParams, [1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]),
      ).toBeNull();
      expect(
        inferOutputShape('MaxPool2D', { poolKernelSize: 1, poolStride: 1, padding: Number.MAX_SAFE_INTEGER }, [8, 4, 4]),
      ).toBeNull();
      // 乘积本身超出安全整数的展平同样被输出侧检查拦下
      expect(inferOutputShape('Flatten', {}, [Number.MAX_SAFE_INTEGER, 3])).toBeNull();

      // 边界另一侧：大但仍在安全整数范围内的合法维度不能被误杀（不设自造上限）
      expect(
        inferOutputShape('Conv2D', { outChannels: 8, kernelSize: 1, stride: 1, padding: 0 }, [3, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]),
      ).toEqual([8, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
    });

    it('中间算式丢精度时不再返回错位尺寸（N3 精度补丁）', () => {
      // 复现值：float 下 size + 2*padding 先越界舍入，末位错位后仍「像」合法安全整数
      const huge: TensorShape = [3, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
      const convParams = { outChannels: 8, kernelSize: 3, stride: 2, padding: 1 };
      const shape = inferOutputShape('Conv2D', convParams, huge);
      // 精确值 floor((2^53-1 + 2 - 3) / 2) + 1 = 2^52 = 4503599627370496
      expect(shape).toEqual([8, 4503599627370496, 4503599627370496]);
      expect(shape?.[1]).not.toBe(4503599627370495);
      expect(isFinitePositiveInteger(shape?.[1])).toBe(true);

      // 两种池化共用同一修复
      expect(inferOutputShape('MaxPool2D', { poolKernelSize: 3, poolStride: 2, padding: 1 }, huge))
        .toEqual([3, 4503599627370496, 4503599627370496]);
      expect(inferOutputShape('AvgPool2D', { poolKernelSize: 3, poolStride: 2, padding: 1 }, huge))
        .toEqual([3, 4503599627370496, 4503599627370496]);
    });

    it('数学结果本身超出可精确表示范围时拒绝，而不是返回 MAX_SAFE_INTEGER', () => {
      const huge: TensorShape = [3, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
      const convParams = { outChannels: 8, kernelSize: 2, stride: 1, padding: 1 };
      // 精确结果 = 2^53，已越过 double 的精确整数上界，无法作为维度返回
      expect(inferOutputShape('Conv2D', convParams, huge)).toBeNull();
      expect(inferOutputShape('MaxPool2D', { poolKernelSize: 2, poolStride: 1, padding: 1 }, huge)).toBeNull();
      expect(inferOutputShape('AvgPool2D', { poolKernelSize: 2, poolStride: 1, padding: 1 }, huge)).toBeNull();

      // 这是精度/可表示性保护：参数与输入维度全部合法，审计不得报出非法操作数
      expect(findIllegalShapeOperands('Conv2D', convParams)).toEqual([]);
      expect(isValidTensorShape(huge)).toBe(true);
    });

    it('边界算式与独立 BigInt 参考实现逐组合一致', () => {
      /** 独立实现（含负数 floor 语义），仅用于交叉验证，不复用被测代码 */
      const exactExtent = (size: number, kernel: number, stride: number, padding: number): bigint => {
        const numerator = BigInt(size) + 2n * BigInt(padding) - BigInt(kernel);
        const s = BigInt(stride);
        const floored = numerator >= 0n
          ? numerator / s
          : -((-numerator + s - 1n) / s);
        return floored + 1n;
      };

      const sizes = [4, 28, 32, 1024, 4503599627370496, 9007199254740990, Number.MAX_SAFE_INTEGER];
      const kernels = [1, 2, 3, 5];
      const strides = [1, 2, 3];
      const paddings = [0, 1, 2];

      for (const size of sizes) {
        for (const kernel of kernels) {
          for (const stride of strides) {
            for (const padding of paddings) {
              const expected = exactExtent(size, kernel, stride, padding);
              const derivable = expected > 0n && expected <= BigInt(Number.MAX_SAFE_INTEGER);
              const shape = inferOutputShape(
                'Conv2D',
                { outChannels: 8, kernelSize: kernel, stride, padding },
                [3, size, size],
              );
              if (!derivable) {
                expect(shape).toBeNull();
                continue;
              }
              expect(shape).toEqual([8, Number(expected), Number(expected)]);
            }
          }
        }
      }
    });

    it('核大于输入时的既有的非法维度语义不变（floor 而非向零截断）', () => {
      // -1 / 2 若按向零截断会得到 0，从而错误地返回尺寸 1；floor 语义必须保持
      expect(inferOutputShape('Conv2D', { outChannels: 8, kernelSize: 5, stride: 2, padding: 0 }, [3, 4, 4])).toBeNull();
      expect(inferOutputShape('Conv2D', { outChannels: 8, kernelSize: 5, stride: 1, padding: 0 }, [3, 4, 4])).toBeNull();
      expect(inferOutputShape('MaxPool2D', { poolKernelSize: 5, poolStride: 2, padding: 0 }, [8, 4, 4])).toBeNull();
      // 恰好为 1 的合法边界仍然通过
      expect(inferOutputShape('Conv2D', { outChannels: 8, kernelSize: 4, stride: 1, padding: 0 }, [3, 4, 4])).toEqual([8, 1, 1]);
    });

    it('常规尺寸、默认参数与 padding=0 的结果完全未受影响', () => {
      expect(inferOutputShape('Conv2D', { outChannels: 32, kernelSize: 3, stride: 1, padding: 1 }, [1, 28, 28])).toEqual([32, 28, 28]);
      expect(inferOutputShape('Conv2D', { outChannels: 32, kernelSize: 3, stride: 1, padding: 0 }, [1, 28, 28])).toEqual([32, 26, 26]);
      expect(inferOutputShape('Conv2D', { outChannels: 32 }, [1, 28, 28])).toEqual([32, 26, 26]);
      expect(inferOutputShape('Conv2D', { filters: 16 }, [1, 28, 28])).toEqual([16, 26, 26]);
      expect(inferOutputShape('MaxPool2D', { poolKernelSize: 2, poolStride: 2 }, [32, 28, 28])).toEqual([32, 14, 14]);
      expect(inferOutputShape('MaxPool2D', { poolSize: 2 }, [32, 28, 28])).toEqual([32, 14, 14]);
      expect(inferOutputShape('AvgPool2D', {}, [32, 28, 28])).toEqual([32, 14, 14]);
      expect(inferOutputShape('Flatten', {}, [32, 14, 14])).toEqual([6272]);
    });

    it('合法性谓词本身的边界', () => {
      expect(isFinitePositiveInteger(1)).toBe(true);
      expect(isFinitePositiveInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
      expect(isFinitePositiveInteger(0)).toBe(false);
      expect(isFinitePositiveInteger(-1)).toBe(false);
      expect(isFinitePositiveInteger(1.5)).toBe(false);
      expect(isFinitePositiveInteger(Number.NaN)).toBe(false);
      expect(isFinitePositiveInteger(Number.POSITIVE_INFINITY)).toBe(false);
      expect(isFinitePositiveInteger(2 ** 53)).toBe(false);
      expect(isFinitePositiveInteger('3')).toBe(false);
      expect(isFiniteNonNegativeInteger(0)).toBe(true);
      expect(isFiniteNonNegativeInteger(-1)).toBe(false);
      expect(isFiniteNonNegativeInteger(Number.NaN)).toBe(false);
      expect(isValidTensorShape(null)).toBe(false);
      expect(isValidTensorShape([])).toBe(false);
      expect(isValidTensorShape([1, 28, 28])).toBe(true);
      expect(isValidTensorShape([1, Number.NaN, 28])).toBe(false);
      expect(isValidTensorShape(['1', 28, 28])).toBe(false);
    });

    it('审计函数与推导结果不出现分歧：有非法操作数时推导一定失败', () => {
      const fixtures: Array<[LayerType, LayerParams, TensorShape]> = [
        ['Conv2D', { outChannels: 8, kernelSize: 'three', stride: 1, padding: 0 }, CONV_INPUT],
        ['Conv2D', { outChannels: 8, kernelSize: 3, stride: 0, padding: 0 }, CONV_INPUT],
        ['Conv2D', { outChannels: 8, kernelSize: 3, stride: 1, padding: -1 }, CONV_INPUT],
        ['MaxPool2D', { poolKernelSize: 2, poolStride: Number.NaN }, [8, 20, 20]],
        ['Linear', { outFeatures: -4 }, [6272]],
        ['Input', { inChannels: 3, inputHeight: Number.NaN, inputWidth: 4 }, [1, 28, 28]],
      ];
      for (const [type, params, input] of fixtures) {
        expect(findIllegalShapeOperands(type, params).length).toBeGreaterThan(0);
        expect(inferOutputShape(type, params, input)).toBeNull();
      }
      // 合法参数不得被审计误报
      expect(findIllegalShapeOperands('Conv2D', { outChannels: 8, kernelSize: 3, padding: 0 })).toEqual([]);
      expect(findIllegalShapeOperands('Input', { inChannels: 3 })).toEqual([]);
      expect(findIllegalShapeOperands('Conv2D', { kernelSize: 3 })).toEqual([]);
    });

    it('满足不变量：任何非 null 返回值的每一维都是有限正整数', () => {
      const types: LayerType[] = [
        'Conv2D', 'MaxPool2D', 'AvgPool2D', 'Linear', 'ReLU', 'Sigmoid',
        'Tanh', 'BatchNorm2d', 'Dropout', 'LayerNorm', 'Input', 'Flatten',
      ];
      const inputs: TensorShape[] = [
        [1, 28, 28], [3, 4, 4], [6272], [8, Number.NaN, 20], [8, 0, 20],
        [8, Number.POSITIVE_INFINITY, 2], ['x' as unknown as number, 2, 2],
      ];
      const paramsList: LayerParams[] = [
        {},
        { outChannels: 8, kernelSize: 3, stride: 1, padding: 0 },
        { outChannels: 8, kernelSize: 'three', stride: 1, padding: 0 },
        { outChannels: Number.NaN, kernelSize: 3 },
        { poolKernelSize: 2, poolStride: 2 },
        { poolSize: 0 },
        { outFeatures: 10 },
        { outFeatures: Number.POSITIVE_INFINITY },
        { inChannels: 3, inputHeight: 4, inputWidth: 4 },
        { inChannels: 3, inputHeight: 'four' },
        { filters: 8 },
        { units: -1 },
      ];

      let checkedNonNull = 0;
      for (const type of types) {
        for (const params of paramsList) {
          for (const input of inputs) {
            const out = inferOutputShape(type, params, input);
            if (out === null) continue;
            checkedNonNull += 1;
            expect(Array.isArray(out)).toBe(true);
            expect(out.length > 0).toBe(true);
            expect(out.every(isFinitePositiveInteger)).toBe(true);
          }
        }
      }
      // 保证上面确实跑出了合法分支，而不是全部 null 让不变量空洞成立
      expect(checkedNonNull).toBeGreaterThan(10);
    });

    it('推导不修改调用方传入的参数对象与形状数组', () => {
      const params = Object.freeze({ outChannels: 8, kernelSize: 'three', stride: 1, padding: 0 });
      const inputShape = Object.freeze([3, 4, 4]) as unknown as TensorShape;
      const paramsBefore = structuredClone(params as LayerParams);

      expect(inferOutputShape('Conv2D', params as LayerParams, inputShape)).toBeNull();
      expect(structuredClone(params as LayerParams)).toEqual(paramsBefore);
      expect(inputShape).toEqual([3, 4, 4]);

      const legalInput = Object.freeze([8, 20, 20]) as unknown as TensorShape;
      const legalBefore = structuredClone(legalInput);
      const reluOut = inferOutputShape('ReLU', {}, legalInput);
      const convOut = inferOutputShape('Conv2D', { outChannels: 4, kernelSize: 3 }, legalInput);
      expect(reluOut).toEqual([8, 20, 20]);
      expect(convOut).toEqual([4, 18, 18]);
      expect(legalInput).toEqual(legalBefore);
    });

    it('错误记录区分三个方向，且都不说成缺少 Flatten', () => {
      const illegalParam = createDerivationFailureError(
        { id: 'conv-1', type: 'Conv2D', params: { outChannels: 8, kernelSize: 'three', stride: 1, padding: 0 } },
        1,
        [3, 4, 4],
      );
      expect(illegalParam.errorType).toBe('invalid_dimension');
      expect(illegalParam.message).toContain('kernelSize');
      expect(illegalParam.message).toContain('有限正整数');
      expect(illegalParam.message).not.toMatch(/Flatten|前一层/);
      expect(illegalParam.actualInputShape).toEqual([3, 4, 4]);

      const illegalPadding = createDerivationFailureError(
        { id: 'conv-2', type: 'Conv2D', params: { outChannels: 8, kernelSize: 3, padding: -1 } },
        2,
        [3, 4, 4],
      );
      expect(illegalPadding.message).toContain('padding');
      expect(illegalPadding.message).toContain('允许 0');

      const upstreamMissing = createDerivationFailureError(
        { id: 'conv-3', type: 'Conv2D', params: { outChannels: 8, kernelSize: 3 } },
        3,
        null,
      );
      expect(upstreamMissing.errorType).toBe('shape_mismatch');
      expect(upstreamMissing.message).toContain('输入形状为 ?');
      expect(upstreamMissing.suggestion).toContain('前一层');

      const rankIncompatible = createDerivationFailureError(
        { id: 'conv-4', type: 'Conv2D', params: { outChannels: 8, kernelSize: 3 } },
        4,
        [6272],
      );
      expect(rankIncompatible.message).toContain('本层参数与上游输出形状 [6272] 不相容');
      expect(rankIncompatible.message).not.toMatch(/Flatten/);

      const kernelTooLarge = createDerivationFailureError(
        { id: 'conv-5', type: 'Conv2D', params: { outChannels: 8, kernelSize: 9, stride: 1, padding: 0 } },
        5,
        [3, 4, 4],
      );
      expect(kernelTooLarge.errorType).toBe('shape_mismatch');
      expect(kernelTooLarge.message).not.toMatch(/Flatten/);
    });

    it('validateNetwork 也把参数非法记录成结构错误而不是放行', () => {
      const layers = [
        makeLayer('Input', { inChannels: 3, inputHeight: 4, inputWidth: 4 }, 0),
        makeLayer('Conv2D', { inChannels: 3, outChannels: 8, kernelSize: 'three' }, 1),
      ];
      const result = validateNetwork(layers);
      expect(result.isValid).toBe(false);
      const failure = result.errors.find(error => error.errorType === 'invalid_dimension');
      expect(failure).toBeDefined();
      // makeLayer 的 id 规则是 layer-${order}：非法参数记录必须归属到那一层本身
      expect(failure?.layerId).toBe('layer-1');
      expect(failure?.message).toContain('kernelSize');
    });
  });
});
