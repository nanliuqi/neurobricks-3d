import { useState, useCallback } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { useLayerStore } from '../stores/useLayerStore';
import { screenTo3D } from '../utils/raycastUtils';
import { computeSnapPosition } from '../utils/snapAlgorithm';
import type { LayerType } from '../types/layer';

interface DragToSceneResult {
  isDragging: boolean;
  ghostPosition: [number, number, number] | null;
  ghostLayerType: LayerType | null;
  handleDragEnd: (event: DragEndEvent) => void;
}

export function useDragToScene(): DragToSceneResult {
  const [isDragging, setIsDragging] = useState(false);
  const [ghostPosition, setGhostPosition] = useState<[number, number, number] | null>(null);
  const [ghostLayerType, setGhostLayerType] = useState<LayerType | null>(null);

  const addLayer = useLayerStore(state => state.addLayer);
  const layers = useLayerStore(state => state.layers);
  const layoutMode = useLayerStore(state => state.layoutMode);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const layerType = event.active.data.current?.layerType as LayerType | undefined;

    if (!layerType) {
      console.warn('Drag end event missing layerType');
      setIsDragging(false);
      setGhostPosition(null);
      setGhostLayerType(null);
      return;
    }

    // 获取触发事件（鼠标或触摸事件）
    const activatorEvent = event.activatorEvent as MouseEvent | undefined;

    if (!activatorEvent || !('clientX' in activatorEvent)) {
      console.warn('Drag end event missing client coordinates');
      setIsDragging(false);
      setGhostPosition(null);
      setGhostLayerType(null);
      return;
    }

    const clientX = activatorEvent.clientX;
    const clientY = activatorEvent.clientY;

    // 获取 Canvas DOM 元素
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      console.warn('Canvas element not found');
      setIsDragging(false);
      setGhostPosition(null);
      setGhostLayerType(null);
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();

    // 计算相对于 Canvas 的鼠标坐标
    const mouseX = clientX - canvasRect.left;
    const mouseY = clientY - canvasRect.top;

    // 检查鼠标是否在 Canvas 范围内
    if (mouseX < 0 || mouseX > canvasRect.width || mouseY < 0 || mouseY > canvasRect.height) {
      console.warn('Mouse position outside canvas bounds');
      setIsDragging(false);
      setGhostPosition(null);
      setGhostLayerType(null);
      return;
    }

    // 将 2D 屏幕坐标转换为 3D 世界坐标
    const rawPosition = screenTo3D(mouseX, mouseY, canvas);

    if (!rawPosition) {
      console.warn('Failed to convert screen coordinates to 3D');
      setIsDragging(false);
      setGhostPosition(null);
      setGhostLayerType(null);
      return;
    }

    const [rawX, rawY, rawZ] = rawPosition;

    // 计算吸附位置
    const snappedPosition = computeSnapPosition(rawY, layers, layoutMode, rawX, rawZ);

    // 添加层到场景（addLayer 只接受 type 和 position）
    addLayer(layerType, snappedPosition);

    // 重置拖拽状态
    setIsDragging(false);
    setGhostPosition(null);
    setGhostLayerType(null);
  }, [addLayer, layers, layoutMode]);

  return {
    isDragging,
    ghostPosition,
    ghostLayerType,
    handleDragEnd,
  };
}
