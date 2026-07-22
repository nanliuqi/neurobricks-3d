import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface DataFlowParticlesProps {
  /** 粒子流动的最大高度 */
  maxHeight: number;
}

const PARTICLE_COUNT = 80;

/**
 * 数据流粒子动画
 * 训练时从底部向顶部流动的蓝色粒子，表示数据在网络中传播
 */
export default function DataFlowParticles({ maxHeight }: DataFlowParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const maxHeightRef = useRef(maxHeight);

  // maxHeight 变化时更新 ref，不重新初始化粒子
  maxHeightRef.current = maxHeight;

  // 初始化粒子位置和速度（只在 mount 时执行一次）
  const { positions, speeds } = useMemo(() => {
    const initialMaxHeight = Math.max(maxHeight, 1);
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const spd = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 2.5;
      pos[i * 3 + 1] = Math.random() * initialMaxHeight;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 2.5;
      spd[i] = 0.5 + Math.random() * 1.5;
    }

    return { positions: pos, speeds: spd };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每帧更新粒子位置（只操作 attribute，不用 setState）
  useFrame((_, delta) => {
    if (!pointsRef.current) return;

    const posAttr = pointsRef.current.geometry.attributes.position;
    const arr = posAttr.array as Float32Array;
    const currentMaxHeight = maxHeightRef.current;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      arr[i * 3 + 1] += speeds[i] * delta;

      // 到达顶部后重置到底部
      if (arr[i * 3 + 1] > currentMaxHeight) {
        arr[i * 3 + 1] = 0;
        arr[i * 3] = (Math.random() - 0.5) * 2.5;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 2.5;
      }
    }

    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#4488ff"
        size={0.08}
        transparent
        opacity={0.6}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}
