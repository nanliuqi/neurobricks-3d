import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import type { Layer3D, LayerType } from '@/types/layer';
import { BLOCK_HEIGHT } from '@/types/layer';
import type { MeshStandardMaterial } from 'three';

interface GradientOverlayProps {
  layer: Layer3D;
}

export default function GradientOverlay({ layer }: GradientOverlayProps) {
  const materialRef = useRef<MeshStandardMaterial>(null);

  // 计算积木尺寸（与 Layer3DBlock 保持一致）
  const { width, depth } = useMemo(() => {
    const p = layer.params;
    switch (layer.type as LayerType) {
      case 'Input':
        return { width: 1.8, depth: 1.2 };
      case 'Conv2D': {
        const ch = (p.outChannels ?? 32);
        return { width: Math.max(1.2, Math.min(3, ch / 64 + 0.8)), depth: 1.2 };
      }
      case 'MaxPool2D':
      case 'AvgPool2D':
        return { width: 1.0, depth: 1.0 };
      case 'Linear': {
        const feat = (p.outFeatures ?? 128);
        return { width: Math.max(1.0, Math.min(3, feat / 512 + 0.6)), depth: 0.8 };
      }
      case 'ReLU':
      case 'Sigmoid':
      case 'Tanh':
        return { width: 0.9, depth: 0.9 };
      case 'BatchNorm2d':
      case 'LayerNorm':
        return { width: 1.1, depth: 1.1 };
      case 'Dropout':
        return { width: 0.9, depth: 0.9 };
      case 'Flatten':
        return { width: 0.7, depth: 0.7 };
      default:
        return { width: 1.0, depth: 1.0 };
    }
  }, [layer.type, layer.params]);

  // 根据梯度值确定颜色和基础透明度
  const { color, baseOpacity } = useMemo(() => {
    if (layer.gradientHealth == null) {
      return { color: '#44ff44', baseOpacity: 0 };
    }
    const health = layer.gradientHealth as number;
    if (health < 0.01) {
      return { color: '#ff4444', baseOpacity: 0.25 };
    } else if (health > 100) {
      return { color: '#ffffff', baseOpacity: 0.3 };
    } else {
      return { color: '#44ff44', baseOpacity: 0.15 };
    }
  }, [layer.gradientHealth]);

  // 脉冲动画
  useFrame(({ clock }) => {
    if (materialRef.current && baseOpacity > 0) {
      const time = clock.getElapsedTime();
      const pulse = Math.sin(time * 2) * 0.05;
      materialRef.current.opacity = baseOpacity + pulse;
    }
  });

  // 梯度健康度未定义时不显示
  if (layer.gradientHealth == null) {
    return null;
  }

  return (
    <RoundedBox
      args={[width + 0.01, BLOCK_HEIGHT + 0.01, depth + 0.01]}
      radius={0.05}
      position={layer.position}
    >
      <meshStandardMaterial
        ref={materialRef}
        color={color}
        transparent
        opacity={baseOpacity}
        depthWrite={false}
      />
    </RoundedBox>
  );
}
