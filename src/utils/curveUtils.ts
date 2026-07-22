import * as THREE from 'three';
import { BLOCK_HEIGHT } from '@/types/layer';

/**
 * 创建连接两个积木的贝塞尔曲线
 * @param from - 起点坐标 [x, y, z]（积木中心位置）
 * @param to - 终点坐标 [x, y, z]（积木中心位置）
 * @returns Three.js 三次贝塞尔曲线对象
 */
export function createConnectionCurve(
  from: [number, number, number],
  to: [number, number, number]
): THREE.CubicBezierCurve3 {
  // 将元组转换为 Vector3，并调整 Y 坐标到积木边缘
  const fromVec = new THREE.Vector3(from[0], from[1] - BLOCK_HEIGHT / 2, from[2]);
  const toVec = new THREE.Vector3(to[0], to[1] + BLOCK_HEIGHT / 2, to[2]);

  // 计算控制点：在起点和终点的中间高度，保持各自的 X/Z 坐标
  const midY = (from[1] + to[1]) / 2;
  const controlPoint1 = new THREE.Vector3(from[0], midY, from[2]);
  const controlPoint2 = new THREE.Vector3(to[0], midY, to[2]);

  // 创建三次贝塞尔曲线
  return new THREE.CubicBezierCurve3(fromVec, controlPoint1, controlPoint2, toVec);
}

/**
 * 从贝塞尔曲线获取采样点
 * @param curve - 贝塞尔曲线对象
 * @param segments - 采样段数，默认 30
 * @returns 采样点数组
 */
export function getCurvePoints(
  curve: THREE.CubicBezierCurve3,
  segments?: number
): THREE.Vector3[] {
  return curve.getPoints(segments ?? 30);
}

/**
 * 创建连接线的几何体
 * @param from - 起点坐标 [x, y, z]
 * @param to - 终点坐标 [x, y, z]
 * @param segments - 采样段数，默认 30
 * @returns Three.js 缓冲几何体
 */
export function createLineGeometry(
  from: [number, number, number],
  to: [number, number, number],
  segments?: number
): THREE.BufferGeometry {
  // 创建贝塞尔曲线
  const curve = createConnectionCurve(from, to);

  // 获取采样点
  const points = getCurvePoints(curve, segments);

  // 创建缓冲几何体
  const geometry = new THREE.BufferGeometry().setFromPoints(points);

  return geometry;
}
