import { describe, it, expect, beforeEach } from 'vitest';
import { useLayerStore } from '../../stores/useLayerStore';

describe('useLayerStore', () => {
  beforeEach(() => {
    // 重置 store 状态
    useLayerStore.setState({
      layers: [],
      selectedId: null,
      validationResult: { valid: true, errors: [] },
    });
  });

  describe('addLayer', () => {
    it('应该添加 Input 层', () => {
      const { addLayer } = useLayerStore.getState();
      
      addLayer('Input');
      
      const newState = useLayerStore.getState();
      expect(newState.layers).toHaveLength(1);
      expect(newState.layers[0].type).toBe('Input');
    });

    it('应该添加 Conv2D 层并计算输出形状', () => {
      const { addLayer } = useLayerStore.getState();
      
      addLayer('Input');
      addLayer('Conv2D');
      
      const newState = useLayerStore.getState();
      expect(newState.layers).toHaveLength(2);
      expect(newState.layers[1].type).toBe('Conv2D');
      expect(newState.layers[1].outputShape).not.toBeNull();
    });

    it('应该为图层分配唯一 ID', () => {
      const { addLayer } = useLayerStore.getState();
      
      addLayer('Input');
      addLayer('Conv2D');
      
      const newState = useLayerStore.getState();
      expect(newState.layers[0].id).not.toBe(newState.layers[1].id);
    });
  });

  describe('removeLayer', () => {
    it('应该移除指定图层', () => {
      const { addLayer, removeLayer } = useLayerStore.getState();
      
      addLayer('Input');
      addLayer('Conv2D');
      
      const firstLayerId = useLayerStore.getState().layers[0].id;
      removeLayer(firstLayerId);
      
      const newState = useLayerStore.getState();
      expect(newState.layers).toHaveLength(1);
      expect(newState.layers[0].type).toBe('Conv2D');
    });

    it('应该清除选中状态如果移除的是选中图层', () => {
      const { addLayer, removeLayer, selectLayer } = useLayerStore.getState();
      
      addLayer('Input');
      const layerId = useLayerStore.getState().layers[0].id;
      selectLayer(layerId);
      
      removeLayer(layerId);
      
      const newState = useLayerStore.getState();
      expect(newState.selectedId).toBeNull();
    });

    it('应该重新排序剩余图层', () => {
      const { addLayer, removeLayer } = useLayerStore.getState();
      
      addLayer('Input');
      addLayer('Conv2D');
      addLayer('ReLU');
      
      const firstLayerId = useLayerStore.getState().layers[0].id;
      removeLayer(firstLayerId);
      
      const newState = useLayerStore.getState();
      expect(newState.layers[0].order).toBe(0);
      expect(newState.layers[1].order).toBe(1);
    });
  });

  describe('updateLayer', () => {
    it('应该更新图层参数', () => {
      const { addLayer, updateLayer } = useLayerStore.getState();
      
      addLayer('Conv2D');
      const layerId = useLayerStore.getState().layers[0].id;
      
      updateLayer(layerId, { params: { filters: 64 } });
      
      const newState = useLayerStore.getState();
      expect(newState.layers[0].params.filters).toBe(64);
    });

    it('应该重新计算输出形状', () => {
      const { addLayer, updateLayer } = useLayerStore.getState();
      
      addLayer('Input');
      addLayer('Conv2D');
      const layerId = useLayerStore.getState().layers[1].id;
      
      const oldShape = useLayerStore.getState().layers[1].outputShape;
      updateLayer(layerId, { params: { filters: 64 } });
      
      const newState = useLayerStore.getState();
      expect(newState.layers[1].outputShape).not.toEqual(oldShape);
    });
  });

  describe('selectLayer', () => {
    it('应该设置选中的图层 ID', () => {
      const { addLayer, selectLayer } = useLayerStore.getState();
      
      addLayer('Input');
      const layerId = useLayerStore.getState().layers[0].id;
      
      selectLayer(layerId);
      
      const newState = useLayerStore.getState();
      expect(newState.selectedId).toBe(layerId);
    });

    it('应该允许取消选择（设置为 null）', () => {
      const { addLayer, selectLayer } = useLayerStore.getState();
      
      addLayer('Input');
      const layerId = useLayerStore.getState().layers[0].id;
      selectLayer(layerId);
      
      selectLayer(null);
      
      const newState = useLayerStore.getState();
      expect(newState.selectedId).toBeNull();
    });
  });

  describe('clearAll', () => {
    it('应该清除所有图层', () => {
      const { addLayer, clearAll } = useLayerStore.getState();
      
      addLayer('Input');
      addLayer('Conv2D');
      
      clearAll();
      
      const newState = useLayerStore.getState();
      expect(newState.layers).toHaveLength(0);
      expect(newState.selectedId).toBeNull();
    });
  });

  describe('validationResult', () => {
    it('应该在添加无效序列时记录错误', () => {
      const { addLayer } = useLayerStore.getState();
      
      // 第一层不是 Input
      addLayer('Conv2D');
      
      const newState = useLayerStore.getState();
      expect(newState.validationResult.valid).toBe(false);
      expect(newState.validationResult.errors.length).toBeGreaterThan(0);
    });

    it('应该在添加有效序列时验证通过', () => {
      const { addLayer } = useLayerStore.getState();
      
      addLayer('Input');
      addLayer('Softmax');
      
      const newState = useLayerStore.getState();
      expect(newState.validationResult.valid).toBe(true);
    });
  });
});
