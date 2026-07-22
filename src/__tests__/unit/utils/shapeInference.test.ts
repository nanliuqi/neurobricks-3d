import { describe, it, expect } from 'vitest';
import { inferOutputShape, validateLayerSequence } from '@/utils/shapeInference';
import type { Layer3D } from '@/types/layer';

describe('shapeInference', () => {
  describe('inferOutputShape', () => {
    it('应该正确推断 Input 层输出形状', () => {
      const inputLayer: Layer3D = {
        id: '1',
        type: 'Input',
        params: {},
        position: [0, 0, 0],
        order: 0,
        outputShape: null,
        paramCount: 0,
      };

      const shape = inferOutputShape(inputLayer, null);
      expect(shape).toEqual([28, 28, 1]);
    });

    it('应该正确推断 Conv2D 层输出形状', () => {
      const convLayer: Layer3D = {
        id: '2',
        type: 'Conv2D',
        params: { filters: 32, kernelSize: [3, 3], stride: [1, 1], padding: [1, 1] },
        position: [0, 0, 0],
        order: 1,
        outputShape: null,
        paramCount: 0,
      };

      const prevLayer: Layer3D = {
        id: '1',
        type: 'Input',
        params: {},
        position: [0, 0, 0],
        order: 0,
        outputShape: [28, 28, 1],
        paramCount: 0,
      };

      const shape = inferOutputShape(convLayer, prevLayer);
      expect(shape).toEqual([28, 28, 32]);
    });

    it('应该正确推断 MaxPool2D 层输出形状', () => {
      const poolLayer: Layer3D = {
        id: '3',
        type: 'MaxPool2D',
        params: { kernelSize: [2, 2], stride: [2, 2] },
        position: [0, 0, 0],
        order: 2,
        outputShape: null,
        paramCount: 0,
      };

      const prevLayer: Layer3D = {
        id: '2',
        type: 'Conv2D',
        params: { filters: 32 },
        position: [0, 0, 0],
        order: 1,
        outputShape: [28, 28, 32],
        paramCount: 0,
      };

      const shape = inferOutputShape(poolLayer, prevLayer);
      expect(shape).toEqual([14, 14, 32]);
    });

    it('应该正确推断 Flatten 层输出形状', () => {
      const flattenLayer: Layer3D = {
        id: '4',
        type: 'Flatten',
        params: {},
        position: [0, 0, 0],
        order: 3,
        outputShape: null,
        paramCount: 0,
      };

      const prevLayer: Layer3D = {
        id: '3',
        type: 'MaxPool2D',
        params: {},
        position: [0, 0, 0],
        order: 2,
        outputShape: [14, 14, 32],
        paramCount: 0,
      };

      const shape = inferOutputShape(flattenLayer, prevLayer);
      expect(shape).toEqual([6272]);
    });

    it('应该正确推断 Linear 层输出形状', () => {
      const linearLayer: Layer3D = {
        id: '5',
        type: 'Linear',
        params: { units: 128 },
        position: [0, 0, 0],
        order: 4,
        outputShape: null,
        paramCount: 0,
      };

      const prevLayer: Layer3D = {
        id: '4',
        type: 'Flatten',
        params: {},
        position: [0, 0, 0],
        order: 3,
        outputShape: [6272],
        paramCount: 0,
      };

      const shape = inferOutputShape(linearLayer, prevLayer);
      expect(shape).toEqual([128]);
    });
  });

  describe('validateLayerSequence', () => {
    it('应该验证空图层序列为有效', () => {
      const result = validateLayerSequence([]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('应该检测第一层不是 Input 的错误', () => {
      const layers: Layer3D[] = [
        {
          id: '1',
          type: 'Conv2D',
          params: {},
          position: [0, 0, 0],
          order: 0,
          outputShape: null,
          paramCount: 0,
        },
      ];

      const result = validateLayerSequence(layers);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('第一层必须是输入层（Input）');
    });

    it('应该检测最后一层不是 Softmax 的错误', () => {
      const layers: Layer3D[] = [
        {
          id: '1',
          type: 'Input',
          params: {},
          position: [0, 0, 0],
          order: 0,
          outputShape: null,
          paramCount: 0,
        },
        {
          id: '2',
          type: 'Conv2D',
          params: {},
          position: [0, 0, 0],
          order: 1,
          outputShape: null,
          paramCount: 0,
        },
      ];

      const result = validateLayerSequence(layers);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('最后一层必须是输出层（Softmax）');
    });

    it('应该验证正确的图层序列', () => {
      const layers: Layer3D[] = [
        { id: '1', type: 'Input', params: {}, position: [0, 0, 0], order: 0, outputShape: [28, 28, 1], paramCount: 0 },
        { id: '2', type: 'Conv2D', params: {}, position: [0, 0, 0], order: 1, outputShape: [28, 28, 32], paramCount: 0 },
        { id: '3', type: 'ReLU', params: {}, position: [0, 0, 0], order: 2, outputShape: [28, 28, 32], paramCount: 0 },
        { id: '4', type: 'Softmax', params: {}, position: [0, 0, 0], order: 3, outputShape: [10], paramCount: 0 },
      ];

      const result = validateLayerSequence(layers);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
