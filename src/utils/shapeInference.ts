import type { LayerType, LayerParams, TensorShape, Layer3D, ShapeValidationError, ValidationResult } from '@/types/layer';
import { DEFAULT_INPUT_SHAPE } from '@/types/layer';

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
  // 输入为 null 时返回 null
  if (!inputShape || inputShape.length === 0) {
    return null;
  }

  switch (type) {
    case 'Conv2D': {
      // Conv2D：[outC, floor((H+2*padding-kernelSize)/stride)+1, floor((W+2*padding-kernelSize)/stride)+1]
      const inChannels = inputShape[0];
      if (inChannels === null || inChannels === undefined) return null;

      const outChannels = params.outChannels ?? params.filters;
      if (outChannels === undefined || outChannels === null) return null;

      const kernelSize = params.kernelSize ?? 3;
      const stride = params.stride ?? 1;
      const padding = params.padding ?? 0;

      const H = inputShape[1];
      const W = inputShape[2];

      if (H === null || H === undefined || W === null || W === undefined) return null;

      const outH = Math.floor((H + 2 * padding - kernelSize) / stride) + 1;
      const outW = Math.floor((W + 2 * padding - kernelSize) / stride) + 1;

      if (outH <= 0 || outW <= 0) return null;

      return [outChannels, outH, outW];
    }

    case 'MaxPool2D': {
      const C = inputShape[0];
      if (C === null || C === undefined) return null;

      const poolKernelSize = params.poolKernelSize ?? params.poolSize ?? 2;
      const poolStride = params.poolStride ?? poolKernelSize;
      const padding = params.padding ?? 0;

      const H = inputShape[1];
      const W = inputShape[2];

      if (H === null || H === undefined || W === null || W === undefined) return null;

      const outH = Math.floor((H + 2 * padding - poolKernelSize) / poolStride) + 1;
      const outW = Math.floor((W + 2 * padding - poolKernelSize) / poolStride) + 1;

      if (outH <= 0 || outW <= 0) return null;

      return [C, outH, outW];
    }

    case 'Linear': {
      // Linear：如果 inputShape.length > 1，返回 null（需要在前面加 Flatten）
      if (inputShape.length > 1) {
        return null;
      }

      // 否则返回 [params.outFeatures]
      const outFeatures = params.outFeatures ?? params.units ?? params.outputSize;
      if (outFeatures === undefined || outFeatures === null) return null;

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

    case 'AvgPool2D': {
      const C = inputShape[0];
      if (C === null || C === undefined) return null;

      const poolKernelSize = params.poolKernelSize ?? params.poolSize ?? 2;
      const poolStride = params.poolStride ?? poolKernelSize;
      const padding = params.padding ?? 0;

      const H = inputShape[1];
      const W = inputShape[2];

      if (H === null || H === undefined || W === null || W === undefined) return null;

      const outH = Math.floor((H + 2 * padding - poolKernelSize) / poolStride) + 1;
      const outW = Math.floor((W + 2 * padding - poolKernelSize) / poolStride) + 1;

      if (outH <= 0 || outW <= 0) return null;

      return [C, outH, outW];
    }

    case 'Input': {
      // Input 层：优先使用参数中指定的形状，否则使用默认
      if (params.inChannels != null && params.inputHeight != null && params.inputWidth != null) {
        return [params.inChannels, params.inputHeight, params.inputWidth];
      }
      if (params.inChannels != null && inputShape && inputShape.length >= 3) {
        return [params.inChannels, inputShape[1], inputShape[2]];
      }
      return inputShape;
    }

    case 'Flatten': {
      // Flatten：将 inputShape 所有元素相乘返回 [product]
      let product = 1;
      for (const dim of inputShape) {
        if (dim === null || dim === undefined) return null;
        product *= dim;
      }
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
      errors.push({
        layerId: layer.id,
        layerType,
        errorType: 'shape_mismatch',
        message: `第 ${i + 1} 层 (${layerType}) 无法推导输出形状，输入形状为 ${formatShape(currentShape)}`,
        suggestion: '检查前一层的输出形状是否与当前层兼容',
        expectedInputShape: null,
        actualInputShape: currentShape,
      });
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
