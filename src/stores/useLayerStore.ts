import { create } from 'zustand';
import type { Layer3D, LayerType, LayerParams, LayoutMode, ValidationResult, TensorShape } from '@/types/layer';
import { BLOCK_STEP, LAYER_META_LIST, DEFAULT_INPUT_SHAPE } from '@/types/layer';
import { validateNetwork, inferOutputShape, computeParamCount } from '@/utils/shapeInference';
import { recalcPositions } from '@/utils/snapAlgorithm';

/**
 * 重新计算每个层的 outputShape、paramCount、validationError
 * 依赖 validateNetwork 的错误信息 + inferOutputShape/computeParamCount
 */
function recomputeLayerStats(layers: Layer3D[], defaultInputShape: TensorShape = DEFAULT_INPUT_SHAPE): Layer3D[] {
  const sorted = [...layers].sort((a, b) => a.order - b.order);

  // 确定输入形状：如果第一层是 Input 层且有自定义形状，优先使用
  let inputShape: TensorShape | null = defaultInputShape;
  if (sorted.length > 0 && sorted[0].type === 'Input') {
    const p = sorted[0].params;
    if (p.inChannels != null && p.inputHeight != null && p.inputWidth != null) {
      inputShape = [p.inChannels, p.inputHeight, p.inputWidth];
    }
  }

  let currentShape: TensorShape | null = inputShape;
  const errorMap = new Map<string, string | null>();

  // 先跑 validateNetwork 拿到错误
  const validationResult = validateNetwork(layers, inputShape);
  for (const err of validationResult.errors) {
    if (!errorMap.has(err.layerId)) {
      errorMap.set(err.layerId, err.message);
    }
  }

  // 逐层推导
  const result: Layer3D[] = [];
  for (const layer of sorted) {
    const outputShape = inferOutputShape(layer.type, layer.params, currentShape);
    const paramCount = computeParamCount(layer.type, layer.params, currentShape);
    const validationError = errorMap.get(layer.id) ?? null;

    result.push({
      ...layer,
      outputShape,
      paramCount,
      validationError,
    });

    currentShape = outputShape;
  }

  return result;
}

interface DragPreviewData {
  layerType: LayerType;
  position: [number, number, number];
}

interface LayerState {
  layers: Layer3D[];
  selectedId: string | null;
  validationResult: ValidationResult;
  layoutMode: LayoutMode;
  towerName: string;
  totalParams: number;
  hasShapeError: boolean;
  dragPreview: DragPreviewData | null;
  flashTrigger: number;

  // Actions
  addLayer: (type: LayerType, position: [number, number, number]) => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, newOrder: number) => void;
  updateLayerParam: (id: string, key: string, value: number) => void;
  setSelectedId: (id: string | null) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setDragPreview: (data: DragPreviewData | null) => void;
  setLayers: (layers: Layer3D[]) => void;
  addClassicModel: (layers: Array<{ type: LayerType; params?: Partial<LayerParams> }>) => void;
  clearAllLayers: () => void;
  recalcAll: () => void;
  recomputeLayerStats: () => void;
  triggerFlash: () => void;
  loadProject: (config: { layers: Layer3D[]; layoutMode: LayoutMode }) => void;
  setValidationResult: (result: ValidationResult) => void;
}

export const useLayerStore = create<LayerState>()((set, get) => ({
  // Initial State
  layers: [],
  selectedId: null,
  validationResult: { isValid: true, errors: [], warnings: [] },
  layoutMode: 'vertical',
  towerName: '未命名网络',
  totalParams: 0,
  hasShapeError: false,
  dragPreview: null,
  flashTrigger: 0,

  // Add Layer
  addLayer: (type, position) => {
    const meta = LAYER_META_LIST.find(m => m.type === type);
    if (!meta) {
      console.warn(`Unknown layer type: ${type}`);
      return;
    }

    const targetOrder = Math.round(position[1] / BLOCK_STEP);
    const clampedOrder = Math.max(0, Math.min(targetOrder, get().layers.length));

    const newLayer: Layer3D = {
      id: crypto.randomUUID(),
      type,
      params: { ...meta.defaultParams },
      order: clampedOrder,
      position,
      outputShape: null,
      paramCount: 0,
      validationError: null,
    };

    set(state => {
      const adjustedLayers = state.layers.map(layer =>
        layer.order >= clampedOrder ? { ...layer, order: layer.order + 1 } : layer
      );
      const newLayers = [...adjustedLayers, newLayer];
      const sortedLayers = [...newLayers].sort((a, b) => a.order - b.order);
      const recalculatedLayers = recalcPositions(sortedLayers);
      const computedLayers = recomputeLayerStats(recalculatedLayers);
      const validationResult = validateNetwork(computedLayers);
      const totalParams = computedLayers.reduce((sum, l) => sum + l.paramCount, 0);
      const hasShapeError = validationResult.errors.length > 0 || computedLayers.some(l => l.validationError !== null);

      return { layers: computedLayers, validationResult, totalParams, hasShapeError };
    });
  },

  // Remove Layer
  removeLayer: (id) => {
    set(state => {
      const filteredLayers = state.layers.filter(layer => layer.id !== id);
      const sortedLayers = [...filteredLayers].sort((a, b) => a.order - b.order);
      const reindexedLayers = sortedLayers.map((layer, i) => ({ ...layer, order: i }));
      const recalculatedLayers = recalcPositions(reindexedLayers);
      const computedLayers = recomputeLayerStats(recalculatedLayers);
      const validationResult = validateNetwork(computedLayers);
      const totalParams = computedLayers.reduce((sum, l) => sum + l.paramCount, 0);
      const hasShapeError = validationResult.errors.length > 0 || computedLayers.some(l => l.validationError !== null);

      return {
        layers: computedLayers,
        selectedId: state.selectedId === id ? null : state.selectedId,
        validationResult,
        totalParams,
        hasShapeError,
      };
    });
  },

  // Move Layer (Change Order)
  moveLayer: (id, newOrder) => {
    set(state => {
      const layerIndex = state.layers.findIndex(layer => layer.id === id);
      if (layerIndex === -1) return state;

      const oldOrder = state.layers[layerIndex].order;
      const clampedNewOrder = Math.max(0, Math.min(newOrder, state.layers.length - 1));

      const adjustedLayers = state.layers.map(layer => {
        if (layer.id === id) return { ...layer, order: clampedNewOrder };
        if (oldOrder < clampedNewOrder) {
          if (layer.order > oldOrder && layer.order <= clampedNewOrder) return { ...layer, order: layer.order - 1 };
        } else if (oldOrder > clampedNewOrder) {
          if (layer.order >= clampedNewOrder && layer.order < oldOrder) return { ...layer, order: layer.order + 1 };
        }
        return layer;
      });

      const sortedLayers = [...adjustedLayers].sort((a, b) => a.order - b.order);
      const recalculatedLayers = recalcPositions(sortedLayers);
      const computedLayers = recomputeLayerStats(recalculatedLayers);
      const validationResult = validateNetwork(computedLayers);
      const totalParams = computedLayers.reduce((sum, l) => sum + l.paramCount, 0);
      const hasShapeError = validationResult.errors.length > 0 || computedLayers.some(l => l.validationError !== null);

      return { layers: computedLayers, validationResult, totalParams, hasShapeError };
    });
  },

  // Update Layer Parameter
  updateLayerParam: (id, key, value) => {
    set(state => {
      const updatedLayers = state.layers.map(layer => {
        if (layer.id === id) {
          return { ...layer, params: { ...layer.params, [key]: value } };
        }
        return layer;
      });

      const computedLayers = recomputeLayerStats(updatedLayers);
      const validationResult = validateNetwork(computedLayers);
      const totalParams = computedLayers.reduce((sum, l) => sum + l.paramCount, 0);
      const hasShapeError = validationResult.errors.length > 0 || computedLayers.some(l => l.validationError !== null);

      return { layers: computedLayers, validationResult, totalParams, hasShapeError };
    });
  },

  // Set Selected ID
  setSelectedId: (id) => {
    set({ selectedId: id });
  },

  // Set Drag Preview
  setDragPreview: (data) => {
    set({ dragPreview: data });
  },

  // Set Layers (for direct order swaps, triggers full recalc)
  setLayers: (layers) => {
    const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
    const reindexedLayers = sortedLayers.map((l, i) => ({ ...l, order: i }));
    const recalculatedLayers = recalcPositions(reindexedLayers);
    const computedLayers = recomputeLayerStats(recalculatedLayers);
    const validationResult = validateNetwork(computedLayers);
    const totalParams = computedLayers.reduce((sum, l) => sum + l.paramCount, 0);
    const hasShapeError = validationResult.errors.length > 0 || computedLayers.some(l => l.validationError !== null);

    set({ layers: computedLayers, validationResult, totalParams, hasShapeError });
  },

  // Add Classic Model (batch add layers)
  addClassicModel: (templateLayers) => {
    set(state => {
      const startOrder = state.layers.length;
      const newLayers: Layer3D[] = templateLayers.map((t, i) => {
        const meta = LAYER_META_LIST.find(m => m.type === t.type);
        return {
          id: crypto.randomUUID(),
          type: t.type,
          params: { ...(meta?.defaultParams ?? {}), ...(t.params ?? {}) },
          order: startOrder + i,
          position: [0, 0, 0] as [number, number, number],
          outputShape: null,
          paramCount: 0,
          validationError: null,
        };
      });

      const allLayers = [...state.layers, ...newLayers];
      const sortedLayers = [...allLayers].sort((a, b) => a.order - b.order);
      const recalculatedLayers = recalcPositions(sortedLayers);
      const computedLayers = recomputeLayerStats(recalculatedLayers);
      const validationResult = validateNetwork(computedLayers);
      const totalParams = computedLayers.reduce((sum, l) => sum + l.paramCount, 0);
      const hasShapeError = validationResult.errors.length > 0 || computedLayers.some(l => l.validationError !== null);

      return { layers: computedLayers, validationResult, totalParams, hasShapeError };
    });
  },

  // Clear All Layers
  clearAllLayers: () => {
    set({
      layers: [],
      selectedId: null,
      validationResult: { isValid: true, errors: [], warnings: [] },
      totalParams: 0,
      hasShapeError: false,
    });
  },

  // Set Layout Mode
  setLayoutMode: (mode) => {
    set(state => {
      let updatedLayers = state.layers;
      if (state.layoutMode === 'free' && mode === 'vertical') {
        updatedLayers = state.layers.map(layer => ({
          ...layer,
          position: [0, layer.position[1], 0] as [number, number, number],
        }));
      }

      const recalculatedLayers = recalcPositions(updatedLayers);
      const computedLayers = recomputeLayerStats(recalculatedLayers);
      const validationResult = validateNetwork(computedLayers);
      const totalParams = computedLayers.reduce((sum, l) => sum + l.paramCount, 0);
      const hasShapeError = validationResult.errors.length > 0 || computedLayers.some(l => l.validationError !== null);

      return { layers: computedLayers, layoutMode: mode, validationResult, totalParams, hasShapeError };
    });
  },

  // Recalculate All (Positions, Validation, Stats)
  recalcAll: () => {
    set(state => {
      const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);
      const recalculatedLayers = recalcPositions(sortedLayers);
      const computedLayers = recomputeLayerStats(recalculatedLayers);
      const validationResult = validateNetwork(computedLayers);
      const totalParams = computedLayers.reduce((sum, l) => sum + l.paramCount, 0);
      const hasShapeError = validationResult.errors.length > 0 || computedLayers.some(l => l.validationError !== null);

      return { layers: computedLayers, validationResult, totalParams, hasShapeError };
    });
  },

  // Recompute Layer Stats only
  recomputeLayerStats: () => {
    set(state => {
      const computedLayers = recomputeLayerStats(state.layers);
      const validationResult = validateNetwork(computedLayers);
      const totalParams = computedLayers.reduce((sum, l) => sum + l.paramCount, 0);
      const hasShapeError = validationResult.errors.length > 0 || computedLayers.some(l => l.validationError !== null);

      return { layers: computedLayers, validationResult, totalParams, hasShapeError };
    });
  },

  // 触发积木闪光（epoch 完成时调用）
  triggerFlash: () => {
    set(state => ({ flashTrigger: state.flashTrigger + 1 }));
  },

  // Load Project
  loadProject: (config: { layers: Layer3D[]; layoutMode: LayoutMode }) => {
    set({
      layers: config.layers,
      layoutMode: config.layoutMode,
      selectedId: null,
    });
    get().recalcAll();
    get().recomputeLayerStats();
  },

  // Set Validation Result manually if needed
  setValidationResult: (result) => {
    set({ validationResult: result });
  },
}));
