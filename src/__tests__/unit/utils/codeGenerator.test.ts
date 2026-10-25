import { describe, it, expect } from 'vitest';
import { generatePyTorchCode } from '@/utils/codeGenerator';
import type { Layer3D, LayerType, LayerParams } from '@/types/layer';

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

describe('codeGenerator', () => {
  describe('generatePyTorchCode', () => {
    it('应该为空图层序列生成提示代码', () => {
      const code = generatePyTorchCode([]);
      expect(code).toContain('# No layers defined');
    });

    it('应该为简单序列生成有效的 PyTorch 代码', () => {
      const layers = [
        makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
        makeLayer('Conv2D', { inChannels: 1, outChannels: 32, kernelSize: 3 }, 1),
        makeLayer('ReLU', {}, 2),
      ];

      const code = generatePyTorchCode(layers);

      expect(code).toContain('import torch');
      expect(code).toContain('import torch.nn as nn');
      expect(code).toContain('class NeuroBricksModel(nn.Module)');
      expect(code).toContain('def forward(self, x)');
      expect(code).toContain('nn.ReLU()');
    });

    it('应该包含 Conv2d 层定义', () => {
      const layers = [
        makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
        makeLayer('Conv2D', { inChannels: 1, outChannels: 64, kernelSize: 5 }, 1),
      ];

      const code = generatePyTorchCode(layers);
      expect(code).toContain('nn.Conv2d(1, 64, 5');
    });

    it('应该包含 Linear 层定义', () => {
      const layers = [
        makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
        makeLayer('Flatten', {}, 1),
        makeLayer('Linear', { inFeatures: 784, outFeatures: 128 }, 2),
      ];

      const code = generatePyTorchCode(layers);
      expect(code).toContain('nn.Linear(784, 128)');
    });

    it('应该包含 Dropout 层定义', () => {
      const layers = [
        makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
        makeLayer('Dropout', { dropRate: 0.5 }, 1),
      ];

      const code = generatePyTorchCode(layers);
      expect(code).toContain('nn.Dropout(0.5)');
    });

    it('应该包含 MaxPool2d 与 Flatten 层定义', () => {
      const layers = [
        makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
        makeLayer('Conv2D', { inChannels: 1, outChannels: 32, kernelSize: 3 }, 1),
        makeLayer('MaxPool2D', { poolKernelSize: 2, poolStride: 2 }, 2),
        makeLayer('Flatten', {}, 3),
        makeLayer('Linear', { inFeatures: 338, outFeatures: 10 }, 4),
      ];

      const code = generatePyTorchCode(layers);
      expect(code).toContain('nn.MaxPool2d(2, stride=2)');
      expect(code).toContain('nn.Flatten()');
    });

    it('应该按 order 排序生成层定义（与传入数组顺序无关）', () => {
      const layers = [
        makeLayer('ReLU', {}, 2),
        makeLayer('Conv2D', { inChannels: 1, outChannels: 32, kernelSize: 3 }, 1),
        makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
      ];

      const code = generatePyTorchCode(layers);
      const inputCommentIdx = code.indexOf('# Input:');
      const convIdx = code.indexOf('nn.Conv2d(1, 32, 3');
      const reluIdx = code.indexOf('nn.ReLU()');

      expect(inputCommentIdx).toBeGreaterThanOrEqual(0);
      expect(convIdx).toBeGreaterThan(inputCommentIdx);
      expect(reluIdx).toBeGreaterThan(convIdx);
    });
  });
});
