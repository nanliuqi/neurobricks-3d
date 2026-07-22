import type { Layer3D, LayoutMode } from '@/types/layer';
import { BLOCK_HEIGHT, BLOCK_STEP } from '@/types/layer';

// 网格大小常量（本地定义）
const GRID_SIZE = 1.0;

/**
 * 吸附算法工具函数
 */

export interface SnapConfig {
  gridSize: number;
  threshold: number;
}

const DEFAULT_CONFIG: SnapConfig = {
  gridSize: GRID_SIZE,
  threshold: 0.5,
};

/**
 * 吸附到网格
 * @param value - 原始值
 * @param gridSize - 网格大小
 * @returns 吸附后的值
 */
export function snapToGrid(value: number, gridSize: number = GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * 计算吸附位置
 * @param rawY - 原始 Y 坐标
 * @param layers - 当前层列表
 * @param mode - 布局模式（vertical | free）
 * @param rawX - 原始 X 坐标（free 模式使用）
 * @param rawZ - 原始 Z 坐标（free 模式使用）
 * @returns 包含 order 和 position 的对象
 */
export function computeSnapPosition(
  rawY: number,
  layers: Layer3D[],
  mode: LayoutMode,
  rawX?: number,
  rawZ?: number
): [number, number, number] {
  // 根据 rawY 计算最近的 order 槽位
  const orderFloat = rawY / BLOCK_STEP;
  const targetOrder = Math.round(orderFloat);

  // 限制 order 范围：[0, layers.length]
  const clampedOrder = Math.max(0, Math.min(targetOrder, layers.length));

  // 计算 Y 坐标：clampedOrder * BLOCK_STEP + BLOCK_HEIGHT / 2
  const y = clampedOrder * BLOCK_STEP + BLOCK_HEIGHT / 2;

  // 根据布局模式计算 X 和 Z
  let x = 0;
  let z = 0;

  if (mode === 'free') {
    // free 模式：吸附到网格
    x = rawX !== undefined ? snapToGrid(rawX, GRID_SIZE) : 0;
    z = rawZ !== undefined ? snapToGrid(rawZ, GRID_SIZE) : 0;
  }
  // vertical 模式：X=0, Z=0（默认值）

  return [x, y, z];
}

/**
 * 重新计算所有层的位置
 * @param layers - 层列表
 * @returns 更新位置后的新数组（不修改原数组）
 */
export function recalcPositions(layers: Layer3D[]): Layer3D[] {
  if (layers.length === 0) {
    return [];
  }

  // 按 order 排序
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);

  // 为每层重新计算位置
  return sortedLayers.map((layer, i) => {
    const y = i * BLOCK_STEP + BLOCK_HEIGHT / 2;

    return {
      ...layer,
      position: [layer.position[0], y, layer.position[2]],
      order: i,
    };
  });
}

/**
 * 计算两点之间的距离
 */
export function distance3D(
  point1: [number, number, number],
  point2: [number, number, number]
): number {
  const dx = point1[0] - point2[0];
  const dy = point1[1] - point2[1];
  const dz = point1[2] - point2[2];
  
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 检查是否应该吸附
 */
export function shouldSnap(
  distance: number,
  config: Partial<SnapConfig> = {}
): boolean {
  const { threshold } = { ...DEFAULT_CONFIG, ...config };
  return distance < threshold;
}

/**
 * 找到最近的吸附点
 */
export function findNearestSnapPoint(
  currentPosition: [number, number, number],
  targetPositions: Array<[number, number, number]>,
  config: Partial<SnapConfig> = {}
): [number, number, number] | null {
  let nearestPoint: [number, number, number] | null = null;
  let minDistance = Infinity;

  for (const target of targetPositions) {
    const dist = distance3D(currentPosition, target);
    if (dist < minDistance && shouldSnap(dist, config)) {
      minDistance = dist;
      nearestPoint = target;
    }
  }

  return nearestPoint;
}
