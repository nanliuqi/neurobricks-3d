import type { LayerType, LayerParams, TensorShape, Layer3D, ShapeValidationError, ValidationResult } from '@/types/layer';
import { DEFAULT_INPUT_SHAPE } from '@/types/layer';

/**
 * 维度合法资格：有限正整数。用安全整数上界同时排除
 * NaN / Infinity / 小数 / 0 / 负数 / 溢出后的非精确整数。
 */
export function isFinitePositiveInteger(value: unknown): value is number {
  if (typeof value !== 'number') return false;
  return Number.isSafeInteger(value) && value > 0;
}

/** 填充这类允许 0 的量：有限非负整数。 */
export function isFiniteNonNegativeInteger(value: unknown): value is number {
  if (typeof value !== 'number') return false;
  return Number.isSafeInteger(value) && value >= 0;
}

/** 一份能当作张量形状使用的记录：非空数组，且每一维都是有限正整数。 */
export function isValidTensorShape(shape: unknown): shape is TensorShape {
  if (!Array.isArray(shape) || shape.length === 0) return false;
  return shape.every(isFinitePositiveInteger);
}

function asPositiveInteger(value: unknown): number | null {
  return isFinitePositiveInteger(value) ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return isFiniteNonNegativeInteger(value) ? value : null;
}

/** 参与形状推导的参数字段（别名解析后的正式字段名）。 */
export type ShapeOperandField =
  | 'outChannels'
  | 'kernelSize'
  | 'stride'
  | 'padding'
  | 'poolKernelSize'
  | 'poolStride'
  | 'outFeatures'
  | 'inChannels'
  | 'inputHeight'
  | 'inputWidth';

type OperandRequirement = 'positive-integer' | 'non-negative-integer';

const SHAPE_OPERAND_RULES: Partial<Record<LayerType, ReadonlyArray<{ field: ShapeOperandField; requirement: OperandRequirement }>>> = {
  Conv2D: [
    { field: 'outChannels', requirement: 'positive-integer' },
    { field: 'kernelSize', requirement: 'positive-integer' },
    { field: 'stride', requirement: 'positive-integer' },
    { field: 'padding', requirement: 'non-negative-integer' },
  ],
  MaxPool2D: [
    { field: 'poolKernelSize', requirement: 'positive-integer' },
    { field: 'poolStride', requirement: 'positive-integer' },
    { field: 'padding', requirement: 'non-negative-integer' },
  ],
  AvgPool2D: [
    { field: 'poolKernelSize', requirement: 'positive-integer' },
    { field: 'poolStride', requirement: 'positive-integer' },
    { field: 'padding', requirement: 'non-negative-integer' },
  ],
  Linear: [{ field: 'outFeatures', requirement: 'positive-integer' }],
  Input: [
    { field: 'inChannels', requirement: 'positive-integer' },
    { field: 'inputHeight', requirement: 'positive-integer' },
    { field: 'inputWidth', requirement: 'positive-integer' },
  ],
};

/** 兼容别名只在这里解析，推导与非法值审计共用同一份解析结果。 */
function resolveShapeOperands(
  type: LayerType,
  params: LayerParams
): Partial<Record<ShapeOperandField, unknown>> {
  switch (type) {
    case 'Conv2D':
      return {
        outChannels: params.outChannels ?? params.filters,
        kernelSize: params.kernelSize ?? 3,
        stride: params.stride ?? 1,
        padding: params.padding ?? 0,
      };
    case 'MaxPool2D':
    case 'AvgPool2D': {
      const poolKernelSize = params.poolKernelSize ?? params.poolSize ?? 2;
      return {
        poolKernelSize,
        poolStride: params.poolStride ?? poolKernelSize,
        padding: params.padding ?? 0,
      };
    }
    case 'Linear':
      return { outFeatures: params.outFeatures ?? params.units ?? params.outputSize };
    case 'Input':
      return {
        inChannels: params.inChannels,
        inputHeight: params.inputHeight,
        inputWidth: params.inputWidth,
      };
    default:
      return {};
  }
}

export interface ShapeOperandViolation {
  field: ShapeOperandField;
  value: unknown;
  requirement: OperandRequirement;
}

/**
 * 找出解析后仍不合法的操作数。未提供（null / undefined）不算违规，沿用原有
 * 「无法推导」路径，避免把缺参数误报成数值非法；但显式给出的非法值不会被
 * 合法别名或合法默认值替换，因此一定在这里暴露出来。
 */
export function findIllegalShapeOperands(
  type: LayerType,
  params: LayerParams
): ShapeOperandViolation[] {
  const rules = SHAPE_OPERAND_RULES[type];
  if (!rules) return [];

  const resolved = resolveShapeOperands(type, params);
  const violations: ShapeOperandViolation[] = [];
  for (const rule of rules) {
    const value = resolved[rule.field];
    if (value === null || value === undefined) continue;
    const legal =
      rule.requirement === 'positive-integer'
        ? isFinitePositiveInteger(value)
        : isFiniteNonNegativeInteger(value);
    if (!legal) violations.push({ field: rule.field, value, requirement: rule.requirement });
  }
  return violations;
}

export function describeShapeOperandViolation(violation: ShapeOperandViolation): string {
  const requirementText =
    violation.requirement === 'positive-integer'
      ? '必须是有限正整数'
      : '必须是有限非负整数（允许 0）';
  const valueText = typeof violation.value === 'string' ? JSON.stringify(violation.value) : String(violation.value);
  return `${violation.field}（当前值 ${valueText}）${requirementText}`;
}

/**
 * 推导失败的错误记录，按检查方向分流：
 * 本层参数值非法 / 上游形状不可用 / 本层参数与上游形状不相容。
 * 不复用 missing_flatten，避免把所有失败都说成缺少 Flatten。
 */
export function createDerivationFailureError(
  layer: { id: string; type: LayerType; params: LayerParams },
  index: number,
  inputShape: TensorShape | null
): ShapeValidationError {
  const violations = findIllegalShapeOperands(layer.type, layer.params);
  if (violations.length > 0) {
    return {
      layerId: layer.id,
      layerType: layer.type,
      errorType: 'invalid_dimension',
      message: `第 ${index + 1} 层 (${layer.type}) 本层参数值非法，无法推导输出形状：${violations
        .map(describeShapeOperandViolation)
        .join('；')}`,
      suggestion: `将 ${violations.map(violation => violation.field).join('、')} 改为合法整数后重试`,
      expectedInputShape: null,
      actualInputShape: inputShape,
    };
  }

  if (!isValidTensorShape(inputShape)) {
    return {
      layerId: layer.id,
      layerType: layer.type,
      errorType: 'shape_mismatch',
      message: `第 ${index + 1} 层 (${layer.type}) 无法推导输出形状，输入形状为 ${formatShape(inputShape)}`,
      suggestion: '检查前一层的输出形状是否与当前层兼容',
      expectedInputShape: null,
      actualInputShape: inputShape,
    };
  }

  return {
    layerId: layer.id,
    layerType: layer.type,
    errorType: 'shape_mismatch',
    message: `第 ${index + 1} 层 (${layer.type}) 的本层参数与上游输出形状 ${formatShape(inputShape)} 不相容，无法推导输出形状`,
    suggestion: '检查本层参数是否完整，以及前一层的输出形状是否与当前层兼容',
    expectedInputShape: null,
    actualInputShape: inputShape,
  };
}

/** BigInt 向下取整除法：保持与 Math.floor 一致的负数语义（核大于输入时仍得到 ≤ 0）。 */
function floorDivide(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const negative = (numerator < 0n) !== (denominator < 0n);
  return negative && numerator % denominator !== 0n ? quotient - 1n : quotient;
}

/**
 * 单条空间维度 floor((size + 2*padding - kernel) / stride) + 1。
 *
 * 中间量必须用 BigInt：size、padding、kernel 各自都是合法安全整数，但
 * size + 2*padding 可能已经越过 double 的精确整数范围，先用 number 计算会
 * 悄悄丢精度，再把错位的末位伪装成合法安全整数通过出口检查。最终仍只在
 * 结果本身可精确表示为安全整数时才转回 number；超出范围返回 null 是
 * 「不可精确表示」，不等于参数非法。
 */
function spatialExtent(
  size: number,
  kernel: number,
  stride: number,
  padding: number
): number | null {
  const numerator = BigInt(size) + 2n * BigInt(padding) - BigInt(kernel);
  const extent = floorDivide(numerator, BigInt(stride)) + 1n;
  if (extent <= 0n) return null;
  if (extent > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(extent);
}

/** [C, H, W] 空间维推导：卷积与两种池化共用同一算式。 */
function deriveSpatialShape(
  channels: number,
  inputShape: TensorShape,
  kernel: number,
  stride: number,
  padding: number
): TensorShape | null {
  const outH = spatialExtent(inputShape[1], kernel, stride, padding);
  const outW = spatialExtent(inputShape[2], kernel, stride, padding);
  if (outH === null || outW === null) return null;
  return [channels, outH, outW];
}

function deriveOutputShape(
  type: LayerType,
  params: LayerParams,
  inputShape: TensorShape
): TensorShape | null {
  switch (type) {
    case 'Conv2D': {
      // Conv2D：[outC, floor((H+2*padding-kernelSize)/stride)+1, floor((W+2*padding-kernelSize)/stride)+1]
      if (inputShape.length < 3) return null;

      const operands = resolveShapeOperands(type, params);
      const outChannels = asPositiveInteger(operands.outChannels);
      const kernelSize = asPositiveInteger(operands.kernelSize);
      const stride = asPositiveInteger(operands.stride);
      const padding = asNonNegativeInteger(operands.padding);
      if (outChannels === null || kernelSize === null || stride === null || padding === null) return null;

      return deriveSpatialShape(outChannels, inputShape, kernelSize, stride, padding);
    }

    case 'MaxPool2D':
    case 'AvgPool2D': {
      if (inputShape.length < 3) return null;

      const operands = resolveShapeOperands(type, params);
      const poolKernelSize = asPositiveInteger(operands.poolKernelSize);
      const poolStride = asPositiveInteger(operands.poolStride);
      const padding = asNonNegativeInteger(operands.padding);
      if (poolKernelSize === null || poolStride === null || padding === null) return null;

      return deriveSpatialShape(inputShape[0], inputShape, poolKernelSize, poolStride, padding);
    }

    case 'Linear': {
      // Linear：如果 inputShape.length > 1，返回 null（需要在前面加 Flatten）
      if (inputShape.length > 1) {
        return null;
      }

      // 否则返回 [params.outFeatures]
      const outFeatures = asPositiveInteger(resolveShapeOperands(type, params).outFeatures);
      if (outFeatures === null) return null;

      return [outFeatures];
    }

    case 'ReLU':
    case 'Sigmoid':
    case 'Tanh':
    case 'BatchNorm2d':
    case 'Dropout': {
      // 激活函数/归一化/Dropout：返回 inputShape（不变形状）
      return inputShape;
    }

    case 'LayerNorm': {
      // LayerNorm：返回 inputShape（不变形状）
      return inputShape;
    }

    case 'Input': {
      // 显式给出的维度非法时直接失败，不允许回落到默认形状把问题藏起来
      if (findIllegalShapeOperands(type, params).length > 0) return null;

      // Input 层：优先使用参数中指定的形状，否则使用默认
      if (params.inChannels != null && params.inputHeight != null && params.inputWidth != null) {
        return [params.inChannels, params.inputHeight, params.inputWidth];
      }
      if (params.inChannels != null && inputShape.length >= 3) {
        return [params.inChannels, inputShape[1], inputShape[2]];
      }
      return inputShape;
    }

    case 'Flatten': {
      // Flatten：将 inputShape 所有元素相乘返回 [product]
      let product = 1;
      for (const dim of inputShape) {
        product *= dim;
      }
      // 连乘可能溢出成不精确整数，溢出结果不算合法形状
      if (!isFinitePositiveInteger(product)) return null;
      return [product];
    }

    default: {
      // 未知层类型，返回 null
      console.warn(`Unknown layer type: ${type}`);
      return null;
    }
  }
}

/**
 * 前向推导输出形状
 * @param type - 层类型
 * @param params - 层参数
 * @param inputShape - 输入形状 [C, H, W] 或 [N]
 * @returns 输出形状，如果无法推导返回 null
 */
export function inferOutputShape(
  type: LayerType,
  params: LayerParams,
  inputShape: TensorShape | null
): TensorShape | null {
  // 输入形状缺失或含非法维度时不进入推导，也不经由直通层传播
  if (!isValidTensorShape(inputShape)) {
    return null;
  }

  const derived = deriveOutputShape(type, params, inputShape);

  // 唯一出口检查：非 null 返回值每一维都必须是有限正整数
  if (!isValidTensorShape(derived)) {
    return null;
  }
  return derived;
}

/**
 * 计算层参数量
 * @param type - 层类型
 * @param params - 层参数
 * @param inputShape - 输入形状 [C, H, W] 或 [N]
 * @returns 参数量
 */
export function computeParamCount(
  type: LayerType,
  params: LayerParams,
  inputShape: TensorShape | null
): number {
  if (!inputShape || inputShape.length === 0) {
    return 0;
  }

  switch (type) {
    case 'Conv2D': {
      // Conv2D：kernelSize² × inChannels × outChannels + outChannels（bias）
      const inChannels = inputShape[0];
      if (inChannels === null || inChannels === undefined) return 0;

      const outChannels = params.outChannels ?? params.filters;
      if (outChannels === undefined || outChannels === null) return 0;

      const kernelSize = params.kernelSize ?? 3;

      const weights = kernelSize * kernelSize * inChannels * outChannels;
      const bias = outChannels; // bias 默认启用

      return weights + bias;
    }

    case 'Linear': {
      // Linear：inFeatures × outFeatures + outFeatures（bias）
      const inFeatures = params.inFeatures ?? params.inputSize ?? inputShape[0];
      if (inFeatures === null || inFeatures === undefined) return 0;

      const outFeatures = params.outFeatures ?? params.units ?? params.outputSize;
      if (outFeatures === undefined || outFeatures === null) return 0;

      const weights = inFeatures * outFeatures;
      const bias = outFeatures; // bias 默认启用

      return weights + bias;
    }

    case 'BatchNorm2d': {
      // BatchNorm2d：2 × numFeatures（gamma + beta）
      const numFeatures = params.numFeatures ?? inputShape[0];
      if (numFeatures === null || numFeatures === undefined) return 0;

      return 2 * numFeatures;
    }

    case 'ReLU':
    case 'Sigmoid':
    case 'Tanh':
    case 'Dropout':
    case 'Flatten':
    case 'MaxPool2D':
    case 'AvgPool2D':
    case 'Input': {
      // 无参数层
      return 0;
    }

    case 'LayerNorm': {
      // LayerNorm：2 × normalizedShape
      const normalizedShape = params.normalizedShape ?? inputShape[0];
      if (normalizedShape === null || normalizedShape === undefined) return 0;
      return 2 * normalizedShape;
    }

    default: {
      console.warn(`Unknown layer type for param count: ${type}`);
      return 0;
    }
  }
}

/**
 * 校验整个网络结构
 * @param layers - 3D 层列表
 * @param inputShape - 输入形状，默认为 [1, 28, 28]
 * @returns 校验结果
 */
export function validateNetwork(
  layers: Layer3D[],
  inputShape: TensorShape = DEFAULT_INPUT_SHAPE
): ValidationResult {
  const errors: ShapeValidationError[] = [];
  const warnings: string[] = [];

  // 按 order 排序层
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);

  let currentShape: TensorShape | null = inputShape;

  for (let i = 0; i < sortedLayers.length; i++) {
    const layer = sortedLayers[i];
    const layerType = layer.type;
    const layerParams = layer.params;

    // 检查 Linear 前是否缺少 Flatten
    if (layerType === 'Linear' && currentShape && currentShape.length > 1) {
      errors.push({
        layerId: layer.id,
        layerType,
        errorType: 'missing_flatten',
        message: `Linear 层前需要添加 Flatten 层，当前输入形状为 ${formatShape(currentShape)}`,
        suggestion: '在 Linear 层前添加 Flatten 层',
        expectedInputShape: null,
        actualInputShape: currentShape,
      });
      currentShape = null;
      continue;
    }

    // 交叉校验 Conv2D 声明的输入通道数与实际输入形状是否一致。
    // inferOutputShape 按实际形状推导输出，若不做此检查，
    // 前端校验会通过但 Python 端 nn.Conv2d 运行时必然报通道不匹配错误
    if (layerType === 'Conv2D' && currentShape && currentShape.length === 3) {
      const declaredInChannels = layerParams.inChannels;
      if (declaredInChannels != null && declaredInChannels !== currentShape[0]) {
        errors.push({
          layerId: layer.id,
          layerType,
          errorType: 'param_conflict',
          message: `Conv2D 输入通道不匹配：inChannels=${declaredInChannels}，但上游输出为 ${formatShape(currentShape)}`,
          suggestion: `将 inChannels 修改为 ${currentShape[0]}`,
          expectedInputShape: currentShape,
          actualInputShape: currentShape,
        });
      }
    }

    // 交叉校验 Linear 声明的输入特征数与实际输入形状是否一致
    if (layerType === 'Linear' && currentShape && currentShape.length === 1) {
      const declaredInFeatures = layerParams.inFeatures ?? layerParams.inputSize;
      if (declaredInFeatures != null && declaredInFeatures !== currentShape[0]) {
        errors.push({
          layerId: layer.id,
          layerType,
          errorType: 'param_conflict',
          message: `Linear 输入特征不匹配：inFeatures=${declaredInFeatures}，但上游输出为 ${formatShape(currentShape)}`,
          suggestion: `将 inFeatures 修改为 ${currentShape[0]}`,
          expectedInputShape: currentShape,
          actualInputShape: currentShape,
        });
      }
    }

    // 推导输出形状
    const outputShape = inferOutputShape(layerType, layerParams, currentShape);

    if (outputShape === null) {
      errors.push(createDerivationFailureError(layer, i, currentShape));
      currentShape = null;
      continue;
    }

    // 更新当前形状
    currentShape = outputShape;

    // 检查形状是否合理（维度不能过大或过小）
    if (currentShape.some(dim => dim !== null && (dim < 1 || dim > 10000))) {
      warnings.push(`第 ${i + 1} 层 (${layerType}) 输出形状异常：${formatShape(currentShape)}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 将层列表适配到指定输入形状（用于切换数据集 / 添加经典模型时的自动适配）。
 *
 * 不仅更新 Input 层的形状参数，还会前向传播形状，自动修正下游层的依赖参数：
 * - Conv2D.inChannels ← 上游输出的通道数（如 MNIST→CIFAR-10 时 1→3）
 * - Linear.inFeatures ← 上游输出的特征数（Flatten 后，如 LeNet-5 在 CIFAR-10 下 256→400）
 *
 * 不修改调用方传入的原始数据（深拷贝 params），返回全新的层数组。
 *
 * @param layers - 层列表（经典模型模板或场景中的 Layer3D 均可）
 * @param inputShape - 目标输入形状 [C, H, W]
 * @returns 适配后的新层列表
 */
export function adaptLayersToInputShape<T extends { type: LayerType; params?: Partial<LayerParams> }>(
  layers: T[],
  inputShape: [number, number, number]
): T[] {
  // 深拷贝 params，避免修改原始模板 / store 状态
  const adapted = layers.map(layer => ({ ...layer, params: { ...(layer.params ?? {}) } }));

  let currentShape: TensorShape | null = [inputShape[0], inputShape[1], inputShape[2]];

  for (const layer of adapted) {
    if (layer.type === 'Input') {
      // Input 层：强制同步为目标输入形状
      layer.params.inChannels = inputShape[0];
      layer.params.inputHeight = inputShape[1];
      layer.params.inputWidth = inputShape[2];
      currentShape = [inputShape[0], inputShape[1], inputShape[2]];
      continue;
    }

    // 上游形状无法推导时停止适配，剩余层交由 validateNetwork 报错
    if (!currentShape) break;

    if (layer.type === 'Conv2D' && currentShape.length === 3) {
      // 卷积输入通道数必须等于上游输出通道数
      layer.params.inChannels = currentShape[0];
    } else if (layer.type === 'Linear' && currentShape.length === 1) {
      // 全连接输入特征数必须等于上游输出特征数（Flatten 之后）
      layer.params.inFeatures = currentShape[0];
    }

    currentShape = inferOutputShape(layer.type, layer.params, currentShape);
  }

  return adapted;
}

/**
 * 将层列表适配为 CSV 单目标回归网络。
 *
 * 表格输入沿用统一的三维形状协议 [1, 1, featureCount]，并把最后一个 Linear
 * 的输出维度固定为 1。中间隐藏层保持不变，因此用户仍能比较不同的 MLP 宽度。
 */
export function adaptLayersForCsvRegression<
  T extends { type: LayerType; params?: Partial<LayerParams> }
>(layers: T[], featureCount: number): T[] {
  if (!Number.isInteger(featureCount) || featureCount <= 0) {
    return layers.map(layer => ({ ...layer, params: { ...(layer.params ?? {}) } }));
  }

  const adapted = adaptLayersToInputShape(layers, [1, 1, featureCount]);
  for (let index = adapted.length - 1; index >= 0; index -= 1) {
    const layer = adapted[index];
    if (layer?.type === 'Linear') {
      layer.params = { ...(layer.params ?? {}), outFeatures: 1 };
      break;
    }
  }
  return adapted;
}

/**
 * 格式化形状为字符串
 * @param shape - 张量形状
 * @returns 格式化的字符串，如 '[1, 28, 28]' 或 '?'
 */
export function formatShape(shape: TensorShape | null): string {
  if (!shape || shape.length === 0) {
    return '?';
  }
  return `[${shape.join(', ')}]`;
}
