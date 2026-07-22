import { useMemo } from 'react';
import * as THREE from 'three';
import { BLOCK_HEIGHT } from '@/types/layer'; 

interface ConnectionLineProps {
  from: [number, number, number];
  to: [number, number, number];
  hasError?: boolean;
}

export default function ConnectionLine({ from, to, hasError = false }: ConnectionLineProps) {
  // 计算曲线几何体
  const geometry = useMemo(() => {
    // 将元组转换为 Vector3，并偏移到积木边缘
    // from 是起点，通常是从下方积木顶部出发，或者根据具体业务逻辑调整偏移
    // to 是终点，通常是到达上方积木底部
    const fromVec = new THREE.Vector3(from[0], from[1] - BLOCK_HEIGHT / 2, from[2]);
    const toVec = new THREE.Vector3(to[0], to[1] + BLOCK_HEIGHT / 2, to[2]);

    // 创建二次贝塞尔曲线
    // 计算控制点，使曲线向上拱起
    const midPoint = new THREE.Vector3().addVectors(fromVec, toVec).multiplyScalar(0.5);
    // 增加 Y 轴高度以形成拱形
    midPoint.y += Math.max(Math.abs(fromVec.y - toVec.y) * 0.5, 0.5); 
    
    const curve = new THREE.QuadraticBezierCurve3(fromVec, midPoint, toVec);

    // 采样曲线生成点数组（30 段）
    const points = curve.getPoints(30);

    // 构建 BufferGeometry
    const positions = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
    });

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    return bufferGeometry;
  }, [from, to]);

  // 线条颜色
  const color = hasError ? '#ff6666' : '#66aaff';

  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial
        attach="material"
        color={color}
        linewidth={1} // 注意：WebGLRenderer 对 linewidth > 1 的支持有限，通常取决于平台
        transparent
        opacity={0.8}
      />
    </line>
  );
}
