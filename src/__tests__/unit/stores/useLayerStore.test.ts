import { describe, it, expect, beforeEach } from 'vitest';
import { useLayerStore } from '@/stores/useLayerStore';
import { BLOCK_STEP } from '@/types/layer';

/** 构造放置位置：垂直模式下 order 由 position[1] 决定 */
function posForOrder(order: number): [number, number, number] {
  return [0, order * BLOCK_STEP, 0];
}

describe('useLayerStore', () => {
  beforeEach(() => {
    useLayerStore.setState(useLayerStore.getInitialState());
  });

  describe('addLayer', () => {
    it('应该添加 Input 层', () => {
      const { addLayer } = useLayerStore.getState();

      addLayer('Input', posForOrder(0));

      const state = useLayerStore.getState();
      expect(state.layers).toHaveLength(1);
      expect(state.layers[0].type).toBe('Input');
    });

    it('应该添加 Conv2D 层并计算输出形状', () => {
      const { addLayer } = useLayerStore.getState();

      addLayer('Input', posForOrder(0));
      // Conv2D 默认参数：inChannels=1, outChannels=32, kernelSize=3, padding=0 → [32, 26, 26]
      addLayer('Conv2D', posForOrder(1));

      const state = useLayerStore.getState();
      expect(state.layers).toHaveLength(2);
      expect(state.layers[1].type).toBe('Conv2D');
      expect(state.layers[1].outputShape).toEqual([32, 26, 26]);
    });

    it('应该为图层分配唯一 ID', () => {
      const { addLayer } = useLayerStore.getState();

      addLayer('Input', posForOrder(0));
      addLayer('Conv2D', posForOrder(1));

      const state = useLayerStore.getState();
      expect(state.layers[0].id).not.toBe(state.layers[1].id);
    });

    it('添加第二层 Conv2D 时应报告输入通道不匹配错误（inChannels 默认 1 ≠ 上游 32）', () => {
      const { addLayer } = useLayerStore.getState();

      addLayer('Input', posForOrder(0));
      addLayer('Conv2D', posForOrder(1));
      addLayer('Conv2D', posForOrder(2));

      const state = useLayerStore.getState();
      expect(state.validationResult.isValid).toBe(false);
      expect(
        state.validationResult.errors.some(e => e.errorType === 'param_conflict')
      ).toBe(true);
      expect(state.hasShapeError).toBe(true);
    });
  });

  describe('removeLayer', () => {
    it('应该移除指定图层并重排序', () => {
      const { addLayer } = useLayerStore.getState();

      addLayer('Input', posForOrder(0));
      addLayer('Conv2D', posForOrder(1));
      addLayer('ReLU', posForOrder(2));

      const firstLayerId = useLayerStore.getState().layers[0].id;
      useLayerStore.getState().removeLayer(firstLayerId);

      const state = useLayerStore.getState();
      expect(state.layers).toHaveLength(2);
      expect(state.layers[0].type).toBe('Conv2D');
      expect(state.layers[0].order).toBe(0);
      expect(state.layers[1].order).toBe(1);
    });

    it('应该清除选中状态如果移除的是选中图层', () => {
      const { addLayer, setSelectedId } = useLayerStore.getState();

      addLayer('Input', posForOrder(0));
      const layerId = useLayerStore.getState().layers[0].id;
      setSelectedId(layerId);

      useLayerStore.getState().removeLayer(layerId);

      const state = useLayerStore.getState();
      expect(state.selectedId).toBeNull();
    });
  });

  describe('updateLayerParam', () => {
    it('应该更新图层参数并重算输出形状', () => {
      const { addLayer } = useLayerStore.getState();

      addLayer('Input', posForOrder(0));
      addLayer('Conv2D', posForOrder(1));

      const layerId = useLayerStore.getState().layers[1].id;
      const oldShape = useLayerStore.getState().layers[1].outputShape;

      useLayerStore.getState().updateLayerParam(layerId, 'outChannels', 64);

      const state = useLayerStore.getState();
      expect(state.layers[1].params.outChannels).toBe(64);
      expect(state.layers[1].outputShape).toEqual([64, 26, 26]);
      expect(state.layers[1].outputShape).not.toEqual(oldShape);
      // 参数量 = 3×3×1×64 + 64 = 640
      expect(state.layers[1].paramCount).toBe(640);
    });
  });

  describe('setSelectedId', () => {
    it('应该设置选中图层 ID，也允许取消选择', () => {
      const { addLayer, setSelectedId } = useLayerStore.getState();

      addLayer('Input', posForOrder(0));
      const layerId = useLayerStore.getState().layers[0].id;

      setSelectedId(layerId);
      expect(useLayerStore.getState().selectedId).toBe(layerId);

      setSelectedId(null);
      expect(useLayerStore.getState().selectedId).toBeNull();
    });
  });

  describe('clearAllLayers', () => {
    it('应该清除所有图层并重置校验状态', () => {
      const { addLayer } = useLayerStore.getState();

      addLayer('Input', posForOrder(0));
      addLayer('Conv2D', posForOrder(1));

      useLayerStore.getState().clearAllLayers();

      const state = useLayerStore.getState();
      expect(state.layers).toHaveLength(0);
      expect(state.selectedId).toBeNull();
      expect(state.validationResult.isValid).toBe(true);
      expect(state.validationResult.errors).toHaveLength(0);
      expect(state.totalParams).toBe(0);
    });
  });

  describe('validationResult', () => {
    it('Conv2D 声明通道与 Input 不一致时应该记录 param_conflict 错误', () => {
      const { addLayer } = useLayerStore.getState();

      addLayer('Input', posForOrder(0));
      addLayer('Conv2D', posForOrder(1));

      // 默认 Conv2D inChannels=1 与 Input 输出 [1,28,28] 一致 → 通过
      let state = useLayerStore.getState();
      expect(state.validationResult.isValid).toBe(true);

      // 改 inChannels=3 制造冲突
      const convId = state.layers[1].id;
      useLayerStore.getState().updateLayerParam(convId, 'inChannels', 3);

      state = useLayerStore.getState();
      expect(state.validationResult.isValid).toBe(false);
      expect(
        state.validationResult.errors.some(e => e.errorType === 'param_conflict')
      ).toBe(true);
    });
  });

  describe('addClassicModel', () => {
    it('应该批量添加模型层并保持校验通过', () => {
      useLayerStore.getState().addClassicModel([
        { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
        { type: 'Conv2D', params: { inChannels: 1, outChannels: 32, kernelSize: 3, padding: 1 } },
        { type: 'ReLU' },
        { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
        { type: 'Flatten' },
        { type: 'Linear', params: { inFeatures: 6272, outFeatures: 10 } },
      ]);

      const state = useLayerStore.getState();
      expect(state.layers).toHaveLength(6);
      expect(state.validationResult.isValid).toBe(true);
      expect(state.totalParams).toBeGreaterThan(0);
    });
  });
});
