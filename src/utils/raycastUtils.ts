import { Raycaster, Vector3, Camera, Vector2, Plane, PerspectiveCamera } from 'three';

/**
 * 射线检测工具函数
 */

export interface RaycastResult {
  intersected: boolean;
  point?: Vector3;
  distance?: number;
}

// 积木相关常量
export const BLOCK_HEIGHT = 1;
export const BLOCK_STEP = 1;

export interface Layer3D {
  order: number;
  [key: string]: any;
}

/**
 * 执行射线检测
 */
export function raycast(
  raycaster: Raycaster,
  _camera: Camera,
  objects: any[]
): RaycastResult {
  const intersects = raycaster.intersectObjects(objects, true);

  if (intersects.length > 0) {
    return {
      intersected: true,
      point: intersects[0].point,
      distance: intersects[0].distance,
    };
  }

  return {
    intersected: false,
  };
}

/**
 * 从鼠标位置创建射线
 */
export function createRayFromMouse(
  mouseX: number,
  mouseY: number,
  camera: Camera,
  canvas: HTMLCanvasElement
): Raycaster {
  const raycaster = new Raycaster();
  
  // 归一化设备坐标
  const x = ((mouseX - canvas.offsetLeft) / canvas.width) * 2 - 1;
  const y = -((mouseY - canvas.offsetTop) / canvas.height) * 2 + 1;

  // ✅ 正确：setFromCamera 接收 Vector2，不是 Vector3
  raycaster.setFromCamera(new Vector2(x, y), camera);
  
  return raycaster;
}

/**
 * 将 2D 屏幕坐标转换为 3D 世界坐标（与 Y=0 水平面求交）
 * @param mouseX - 鼠标 X 坐标（相对于 Canvas）
 * @param mouseY - 鼠标 Y 坐标（相对于 Canvas）
 * @param canvas - Canvas HTML 元素
 * @param camera - Three.js 相机对象（可选，不提供时使用默认透视相机）
 * @returns 3D 世界坐标 [x, y, z]，如果无交点返回 null
 */
export function screenTo3D(
  mouseX: number,
  mouseY: number,
  canvas: HTMLCanvasElement,
  camera?: Camera
): [number, number, number] | null {
  // 获取 Canvas 边界矩形
  const rect = canvas.getBoundingClientRect();
  
  // 计算归一化设备坐标 (NDC)
  const ndcX = ((mouseX) / rect.width) * 2 - 1;
  const ndcY = -((mouseY) / rect.height) * 2 + 1;

  // 如果没有提供相机，创建默认透视相机（匹配 NeuroScene 的配置）
  const activeCamera = camera || (() => {
    const defaultCam = new PerspectiveCamera(50, rect.width / rect.height, 0.1, 1000);
    defaultCam.position.set(0, 8, 12);
    defaultCam.lookAt(0, 0, 0);
    defaultCam.updateMatrixWorld(true);
    return defaultCam;
  })();

  // 创建射线投射器
  const raycaster = new Raycaster();
  const mouseVector = new Vector2(ndcX, ndcY);

  // 从相机发射射线
  raycaster.setFromCamera(mouseVector, activeCamera);

  // ✅ 正确：与 Y=0 的水平面求交（地面）
  const plane = new Plane(new Vector3(0, 1, 0), 0);
  const target = new Vector3();

  const intersected = raycaster.ray.intersectPlane(plane, target);

  if (!intersected) {
    return null;
  }

  // 转换为元组格式返回
  return [target.x, target.y, target.z];
}

/**
 * 获取新积木的放置 Y 坐标
 * @param existingLayers - 现有的层列表
 * @returns 新积木的 Y 坐标
 */
export function getPlacementY(existingLayers: Layer3D[]): number {
  // 如果没有现有层，返回初始位置 0
  if (existingLayers.length === 0) {
    return 0;
  }

  // 找到最大的 order 值
  const maxOrder = Math.max(...existingLayers.map(layer => layer.order));

  // 计算新积木的 Y 坐标：(maxOrder + 1) * BLOCK_STEP + BLOCK_HEIGHT / 2
  const newY = (maxOrder + 1) * BLOCK_STEP + BLOCK_HEIGHT / 2;

  return newY;
}
