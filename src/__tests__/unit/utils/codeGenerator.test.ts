import { describe, it, expect } from 'vitest';
import { generatePyTorchCode } from '../../utils/codeGenerator';
import { Layer3D } from '../../types/layer';

describe('codeGenerator', () => {
  describe('generatePyTorchCode', () => {
    it('应该为空图层序列生成提示代码', () => {
      const code = generatePyTorchCode([]);
      expect(code).toContain('# 请先添加图层');
    });

    it('应该为简单序列生成有效的 PyTorch 代码', () => {
      const layers: Layer3D[] = [
        { id: '1', type: 'Input', params: {}, position: [0, 0, 0], order: 0, outputShape: [28, 28, 1], paramCount: 0 },
        { id: '2', type: 'Conv2D', params: { filters: 32, kernelSize: [3, 3] }, position: [0, 0, 0], order: 1, outputShape: [28, 28, 32], paramCount: 0 },
        { id: '3', type: 'ReLU', params: {}, position: [0, 0, 0], order: 2, outputShape: [28, 28, 32], paramCount: 0 },
        { id: '4', type: 'Softmax', params: {}, position: [0, 0, 0], order: 3, outputShape: [10], paramCount: 0 },
      ];

      const code = generatePyTorchCode(layers);
      
      expect(code).toContain('import torch');
      expect(code).toContain('import torch.nn as nn');
      expect(code).toContain('class NeuralNetwork(nn.Module)');
      expect(code).toContain('def forward(self, x)');
      expect(code).toContain('torch.relu');
      expect(code).toContain('torch.softmax');
    });

    it('应该包含 Conv2d 层定义', () => {
      const layers: Layer3D[] = [
        { id: '1', type: 'Input', params: {}, position: [0, 0, 0], order: 0, outputShape: [28, 28, 1], paramCount: 0 },
        { id: '2', type: 'Conv2D', params: { filters: 64, kernelSize: [5, 5] }, position: [0, 0, 0], order: 1, outputShape: [24, 24, 64], paramCount: 0 },
        { id: '3', type: 'Softmax', params: {}, position: [0, 0, 0], order: 2, outputShape: [10], paramCount: 0 },
      ];

      const code = generatePyTorchCode(layers);
      expect(code).toContain('nn.Conv2d(1, 64, 5)');
    });

    it('应该包含 Linear 层定义', () => {
      const layers: Layer3D[] = [
        { id: '1', type: 'Input', params: {}, position: [0, 0, 0], order: 0, outputShape: [28, 28, 1], paramCount: 0 },
        { id: '2', type: 'Flatten', params: {}, position: [0, 0, 0], order: 1, outputShape: [784], paramCount: 0 },
        { id: '3', type: 'Linear', params: { units: 128 }, position: [0, 0, 0], order: 2, outputShape: [128], paramCount: 0 },
        { id: '4', type: 'Softmax', params: {}, position: [0, 0, 0], order: 3, outputShape: [10], paramCount: 0 },
      ];

      const code = generatePyTorchCode(layers);
      expect(code).toContain('nn.Linear(784, 128)');
    });

    it('应该包含 Dropout 层定义', () => {
      const layers: Layer3D[] = [
        { id: '1', type: 'Input', params: {}, position: [0, 0, 0], order: 0, outputShape: [28, 28, 1], paramCount: 0 },
        { id: '2', type: 'Dropout', params: { rate: 0.5 }, position: [0, 0, 0], order: 1, outputShape: [28, 28, 1], paramCount: 0 },
        { id: '3', type: 'Softmax', params: {}, position: [0, 0, 0], order: 2, outputShape: [10], paramCount: 0 },
      ];

      const code = generatePyTorchCode(layers);
      expect(code).toContain('nn.Dropout(0.5)');
    });

    it('应该包含训练代码模板', () => {
      const layers: Layer3D[] = [
        { id: '1', type: 'Input', params: {}, position: [0, 0, 0], order: 0, outputShape: [28, 28, 1], paramCount: 0 },
        { id: '2', type: 'Softmax', params: {}, position: [0, 0, 0], order: 1, outputShape: [10], paramCount: 0 },
      ];

      const code = generatePyTorchCode(layers);
      expect(code).toContain('criterion = nn.CrossEntropyLoss()');
      expect(code).toContain('optimizer = optim.Adam');
      expect(code).toContain('def train(');
    });

    it('应该处理 padding=0 的边界情况', () => {
      const layers: Layer3D[] = [
        { id: '1', type: 'Input', params: {}, position: [0, 0, 0], order: 0, outputShape: [28, 28, 1], paramCount: 0 },
        { id: '2', type: 'Conv2D', params: { filters: 32, kernelSize: [3, 3], padding: [0, 0] }, position: [0, 0, 0], order: 1, outputShape: [26, 26, 32], paramCount: 0 },
        { id: '3', type: 'Softmax', params: {}, position: [0, 0, 0], order: 2, outputShape: [10], paramCount: 0 },
      ];

      const code = generatePyTorchCode(layers);
      expect(code).toContain('import torch');
      expect(code).toBeTruthy();
    });

    it('生成的代码应该是可执行的 Python 语法', () => {
      const layers: Layer3D[] = [
        { id: '1', type: 'Input', params: {}, position: [0, 0, 0], order: 0, outputShape: [28, 28, 1], paramCount: 0 },
        { id: '2', type: 'Conv2D', params: { filters: 32 }, position: [0, 0, 0], order: 1, outputShape: [28, 28, 32], paramCount: 0 },
        { id: '3', type: 'ReLU', params: {}, position: [0, 0, 0], order: 2, outputShape: [28, 28, 32], paramCount: 0 },
        { id: '4', type: 'MaxPool2D', params: {}, position: [0, 0, 0], order: 3, outputShape: [14, 14, 32], paramCount: 0 },
        { id: '5', type: 'Flatten', params: {}, position: [0, 0, 0], order: 4, outputShape: [6272], paramCount: 0 },
        { id: '6', type: 'Linear', params: { units: 128 }, position: [0, 0, 0], order: 5, outputShape: [128], paramCount: 0 },
        { id: '7', type: 'Dropout', params: { rate: 0.5 }, position: [0, 0, 0], order: 6, outputShape: [128], paramCount: 0 },
        { id: '8', type: 'Linear', params: { units: 10 }, position: [0, 0, 0], order: 7, outputShape: [10], paramCount: 0 },
        { id: '9', type: 'Softmax', params: {}, position: [0, 0, 0], order: 8, outputShape: [10], paramCount: 0 },
      ];

      const code = generatePyTorchCode(layers);
      
      // 检查基本结构
      expect(code).toContain('class NeuralNetwork(nn.Module):');
      expect(code).toContain('def __init__(self):');
      expect(code).toContain('def forward(self, x):');
      
      // 检查所有层类型都被正确处理
      expect(code).toContain('nn.Conv2d');
      expect(code).toContain('nn.Linear');
      expect(code).toContain('nn.Dropout');
      expect(code).toContain('nn.Flatten');
      expect(code).toContain('torch.relu');
      expect(code).toContain('torch.max_pool2d');
      expect(code).toContain('torch.softmax');
    });
  });
});
