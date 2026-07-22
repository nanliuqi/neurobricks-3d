import type { Layer3D } from '../types/layer';

/**
 * 生成 PyTorch 代码
 * @param layers - 3D 层列表
 * @returns Python 代码字符串
 */
export function generatePyTorchCode(layers: Layer3D[]): string {
  // 按 order 排序，如果 order 不存在则保持原序或设为 0
  const sortedLayers = [...layers].sort((a, b) => (a.order || 0) - (b.order || 0));

  if (sortedLayers.length === 0) {
    return '# No layers defined';
  }

  // 生成 __init__ 中的层定义
  const initLines: string[] = [];
  const forwardLines: string[] = ['x'];

  for (let i = 0; i < sortedLayers.length; i++) {
    const layer = sortedLayers[i];
    const layerName = `self.layer_${i}`;
    const params = layer.params || {};

    // 规范化类型名称，兼容不同大小写或命名风格
    const type = layer.type.toLowerCase();

    switch (type) {
      case 'input': {
        // Input 层：在 forward 中添加注释说明输入形状
        const ic = params.inChannels ?? 1;
        const ih = params.inputHeight ?? 28;
        const iw = params.inputWidth ?? 28;
        initLines.push(`        # Input: shape [${ic}, ${ih}, ${iw}]`);
        forwardLines.push(`x  # Input: [${ic}, ${ih}, ${iw}]`);
        break;
      }

      case 'conv2d': {
        const inChannels = params.inChannels ?? (i === 0 ? 1 : 64); // 默认非首层为64仅作占位，实际需根据上一层调整
        const outChannels = params.outChannels ?? params.filters ?? 64;
        const kernelSize = Array.isArray(params.kernelSize) ? params.kernelSize[0] : (params.kernelSize ?? 3);
        const stride = params.stride ?? 1;
        const padding = params.padding ?? 0;

        initLines.push(
          `        ${layerName} = nn.Conv2d(${inChannels}, ${outChannels}, ${kernelSize}, stride=${stride}, padding=${padding})`
        );
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      case 'maxpool2d': {
        const poolKernelSize = params.poolKernelSize ?? params.poolSize ?? 2;
        const poolStride = params.poolStride ?? poolKernelSize;

        initLines.push(
          `        ${layerName} = nn.MaxPool2d(${poolKernelSize}, stride=${poolStride})`
        );
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      case 'avgpool2d': {
        const avgPoolSize = params.poolKernelSize ?? params.poolSize ?? 2;
        const avgPoolStride = params.poolStride ?? avgPoolSize;

        initLines.push(
          `        ${layerName} = nn.AvgPool2d(${avgPoolSize}, stride=${avgPoolStride})`
        );
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      case 'linear':
      case 'dense': {
        const inFeatures = params.inFeatures ?? params.inputSize ?? 128;
        const outFeatures = params.outFeatures ?? params.units ?? params.outputSize ?? 10;

        initLines.push(
          `        ${layerName} = nn.Linear(${inFeatures}, ${outFeatures})`
        );
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      case 'relu': {
        initLines.push(`        ${layerName} = nn.ReLU()`);
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      case 'sigmoid': {
        initLines.push(`        ${layerName} = nn.Sigmoid()`);
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      case 'tanh': {
        initLines.push(`        ${layerName} = nn.Tanh()`);
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      case 'batchnorm2d': {
        const numFeatures = params.numFeatures ?? 64;

        initLines.push(`        ${layerName} = nn.BatchNorm2d(${numFeatures})`);
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      case 'layernorm': {
        const normalizedShape = params.normalizedShape ?? 64;

        initLines.push(`        ${layerName} = nn.LayerNorm(${normalizedShape})`);
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      case 'dropout': {
        const dropRate = params.dropRate ?? params.p ?? 0.5;

        initLines.push(`        ${layerName} = nn.Dropout(${dropRate})`);
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      case 'flatten': {
        initLines.push(`        ${layerName} = nn.Flatten()`);
        forwardLines.push(`${layerName}(x)`);
        break;
      }

      default:
        console.warn(`Unsupported layer type for PyTorch: ${layer.type}`);
        break;
    }
  }

  // 构建完整的 Python 文件内容
  const code = `import torch
import torch.nn as nn


class NeuroBricksModel(nn.Module):
    def __init__(self, in_channels=1):
        super(NeuroBricksModel, self).__init__()
${initLines.join('\n')}

    def forward(self, x):
${forwardLines.map(line => `        x = ${line}`).join('\n')}
        return x


if __name__ == '__main__':
    model = NeuroBricksModel()
    print(model)
    
    # Test with sample input
    dummy_input = torch.randn(1, 1, 28, 28)
    output = model(dummy_input)
    print(f"Output shape: {output.shape}")
`;

  return code;
}

/**
 * 生成 Keras 代码
 * @param layers - 3D 层列表
 * @returns Python 代码字符串
 */
export function generateKerasCode(layers: Layer3D[]): string {
  // 按 order 排序
  const sortedLayers = [...layers].sort((a, b) => (a.order || 0) - (b.order || 0));

  if (sortedLayers.length === 0) {
    return '# No layers defined';
  }

  // 生成 Sequential 中的层列表
  const kerasLayers: string[] = [];

  for (const layer of sortedLayers) {
    const params = layer.params || {};
    const type = layer.type.toLowerCase();

    switch (type) {
      case 'input': {
        // Input 层：使用 params 中的实际输入形状
        const ic = params.inChannels ?? 1;
        const ih = params.inputHeight ?? 28;
        const iw = params.inputWidth ?? 28;
        kerasLayers.push(`    tf.keras.layers.InputLayer(input_shape=(${ih}, ${iw}, ${ic}))`);
        break;
      }

      case 'conv2d': {
        const filters = params.outChannels ?? params.filters ?? 64;
        const kernelSize = Array.isArray(params.kernelSize) ? params.kernelSize[0] : (params.kernelSize ?? 3);
        const stride = params.stride ?? 1;
        const padding = params.padding ?? 0;
        const paddingStr = padding === 0 ? "'valid'" : "'same'";

        kerasLayers.push(
          `    tf.keras.layers.Conv2D(${filters}, (${kernelSize}, ${kernelSize}), strides=${stride}, padding=${paddingStr})`
        );
        break;
      }

      case 'maxpool2d': {
        const poolSize = params.poolKernelSize ?? params.poolSize ?? 2;
        const poolStride = params.poolStride ?? poolSize;

        kerasLayers.push(
          `    tf.keras.layers.MaxPooling2D(pool_size=(${poolSize}, ${poolSize}), strides=${poolStride})`
        );
        break;
      }

      case 'avgpool2d': {
        const avgPoolSize = params.poolKernelSize ?? params.poolSize ?? 2;
        const avgPoolStride = params.poolStride ?? avgPoolSize;

        kerasLayers.push(
          `    tf.keras.layers.AveragePooling2D(pool_size=(${avgPoolSize}, ${avgPoolSize}), strides=${avgPoolStride})`
        );
        break;
      }

      case 'linear':
      case 'dense': {
        const units = params.outFeatures ?? params.units ?? params.outputSize ?? 10;

        kerasLayers.push(`    tf.keras.layers.Dense(${units})`);
        break;
      }

      case 'relu': {
        kerasLayers.push('    tf.keras.layers.ReLU()');
        break;
      }

      case 'sigmoid': {
        kerasLayers.push('    tf.keras.layers.Activation("sigmoid")');
        break;
      }

      case 'tanh': {
        kerasLayers.push('    tf.keras.layers.Activation("tanh")');
        break;
      }

      case 'batchnorm2d': {
        kerasLayers.push('    tf.keras.layers.BatchNormalization()');
        break;
      }

      case 'layernorm': {
        const normalizedShape = params.normalizedShape ?? 64;
        kerasLayers.push(`    tf.keras.layers.LayerNormalization()`);
        void normalizedShape;
        break;
      }

      case 'dropout': {
        const rate = params.dropRate ?? params.p ?? 0.5;

        kerasLayers.push(`    tf.keras.layers.Dropout(${rate})`);
        break;
      }

      case 'flatten': {
        kerasLayers.push('    tf.keras.layers.Flatten()');
        break;
      }

      default:
        console.warn(`Unsupported layer type for Keras: ${layer.type}`);
        break;
    }
  }

  // 构建完整的 Python 文件内容
  const code = `import tensorflow as tf


model = tf.keras.Sequential([
${kerasLayers.join(',\n')},
])

if __name__ == '__main__':
    model.build(input_shape=(None, 28, 28, 1))
    model.summary()
    
    # Test with sample input
    import numpy as np
    dummy_input = np.random.randn(1, 28, 28, 1).astype('float32')
    output = model.predict(dummy_input)
    print(f"Output shape: {output.shape}")
`;

  return code;
}
