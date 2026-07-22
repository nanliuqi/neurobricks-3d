import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BLOCK_HEIGHT } from '@/types/layer'; 

interface ConnectionLineProps {
  from: [number, number, number];
  to: [number, number, number];
  hasError?: boolean;
  isTraining?: boolean;
}

export default function ConnectionLine({ from, to, hasError = false, isTraining = false }: ConnectionLineProps) {
  const dotRef = useRef<THREE.Mesh>(null);

  // 计算曲线几何体
  const { geometry, curve } = useMemo(() => {
    // 将元组转换为 Vector3，并偏移到积木边缘
    const fromVec = new THREE.Vector3(from[0], from[1] - BLOCK_HEIGHT / 2, from[2]);
    const toVec = new THREE.Vector3(to[0], to[1] + BLOCK_HEIGHT / 2, to[2]);

    // 创建二次贝塞尔曲线，控制点向上拱起
    const midPoint = new THREE.Vector3().addVectors(fromVec, toVec).multiplyScalar(0.5);
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

    return { geometry: bufferGeometry, curve };
  }, [from, to]);

  // 训练时光点沿曲线流动
  useFrame((state) => {
    if (!isTraining || !dotRef.current) return;
    const t = (state.clock.elapsedTime * 0.5) % 1; // 2 秒走完一条线
    const point = curve.getPoint(t);
    dotRef.current.position.set(point.x, point.y, point.z);
  });

  // 线条颜色
  const color = hasError ? '#ff6666' : '#66aaff';

  return (
    <group>
      <line>
        <primitive object={geometry} attach="geometry" />
        <lineBasicMaterial
          attach="material"
          color={color}
          linewidth={1}
          transparent
          opacity={0.8}
        />
      </line>
      {/* 训练时流动光点 */}
      {isTraining && !hasError && (
        <mesh ref={dotRef}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshBasicMaterial color="#7dd3fc" transparent opacity={0.9} />
        </mesh>
      )}
    </group>
  );
}
