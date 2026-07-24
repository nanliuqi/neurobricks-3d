import { memo, useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useLayerStore } from '../../stores/useLayerStore';
import type { Layer3D, LayerType } from '../../types/layer';
import { BLOCK_HEIGHT, LAYER_META_LIST } from '../../types/layer';

interface Layer3DBlockProps {
  layer: Layer3D;
}

const Layer3DBlock = memo(function Layer3DBlock({ layer }: Layer3DBlockProps) {
  const selectedId = useLayerStore(state => state.selectedId);
  const setSelectedId = useLayerStore(state => state.setSelectedId);
  const flashTrigger = useLayerStore(state => state.flashTrigger);
  const meshRef = useRef<THREE.Mesh>(null);
  const flashIntensity = useRef(0);
  const prevFlashTrigger = useRef(0);

  const isSelected = selectedId === layer.id;

  // 监听 flashTrigger 变化，触发闪光
  useEffect(() => {
    if (flashTrigger > prevFlashTrigger.current) {
      flashIntensity.current = 1.0;
    }
    prevFlashTrigger.current = flashTrigger;
  }, [flashTrigger]);

  // 参数量映射宽度（参数量越大积木越宽）
  const width = Math.max(1, Math.log2(layer.paramCount + 1) * 0.3 + 1);

  // 计算积木深度（基于层类型）
  const depth = useMemo(() => {
    switch (layer.type as LayerType) {
      case 'Input':
        return 1.2;
      case 'Conv2D':
        return 1.2;
      case 'MaxPool2D':
      case 'AvgPool2D':
        return 1.0;
      case 'Linear':
        return 0.8;
      case 'ReLU':
      case 'Sigmoid':
      case 'Tanh':
        return 0.9;
      case 'BatchNorm2d':
      case 'LayerNorm':
        return 1.1;
      case 'Dropout':
        return 0.9;
      case 'Flatten':
        return 0.7;
      default:
        return 1.0;
    }
  }, [layer.type]);

  // 选中脉冲动画 + 闪光衰减（只操作 ref，不用 setState）
  useFrame((state, delta) => {
    if (!meshRef.current) return;

    // 没有选中且没有闪光时，确保 material 状态正确后跳过
    if (!isSelected && flashIntensity.current <= 0) {
      const material = meshRef.current.material as THREE.MeshStandardMaterial;
      if (material.emissiveIntensity !== 0) {
        material.emissive.set('#000000');
        material.emissiveIntensity = 0;
      }
      return;
    }

    const material = meshRef.current.material as THREE.MeshStandardMaterial;

    // 闪光衰减（0.5秒内衰减完）
    if (flashIntensity.current > 0) {
      flashIntensity.current = Math.max(0, flashIntensity.current - delta * 2);
      material.emissive.set('#44aaff');
      material.emissiveIntensity = flashIntensity.current;
    } else if (isSelected) {
      // 选中脉冲
      material.emissive.set('#4488ff');
      material.emissiveIntensity = 0.4 + Math.sin(state.clock.elapsedTime * 3) * 0.2;
    }
  });

  // 获取层颜色
  const color = useMemo(() => {
    if (layer.validationError) {
      return '#ff4444';
    }
    const meta = LAYER_META_LIST.find(m => m.type === layer.type);
    return meta?.color ?? '#888888';
  }, [layer.type, layer.validationError]);

  // 获取层标签
  const label = useMemo(() => {
    const meta = LAYER_META_LIST.find(m => m.type === layer.type);
    return meta?.label ?? layer.type;
  }, [layer.type]);

  // 生成参数摘要文本
  const paramSummary = useMemo(() => {
    const params = layer.params;

    switch (layer.type as LayerType) {
      case 'Conv2D':
        return `${params.kernelSize ?? 3}×${params.kernelSize ?? 3}, ${params.outChannels ?? 32}ch`;
      case 'MaxPool2D':
      case 'AvgPool2D':
        return `${params.poolKernelSize ?? 2}×${params.poolKernelSize ?? 2}`;
      case 'Linear':
        return `${params.inFeatures ?? 784}→${params.outFeatures ?? 128}`;
      case 'BatchNorm2d':
        return `${params.numFeatures ?? 64} feat`;
      case 'Dropout':
        return `p=${params.dropRate ?? 0.5}`;
      case 'Flatten':
        return 'flat';
      case 'ReLU':
      case 'Sigmoid':
      case 'Tanh':
        return 'act';
      case 'Input':
        return 'in';
      case 'LayerNorm':
        return 'norm';
      default:
        return layer.type.toLowerCase();
    }
  }, [layer.type, layer.params]);


  // 格式化输出形状文本
  const shapeText = useMemo(() => {
    if (!layer.outputShape || layer.outputShape.length === 0) return null;
    return layer.outputShape.join('×');
  }, [layer.outputShape]);

  return (
    <group position={layer.position}>
      {/* 积木主体 */}
      <RoundedBox
        ref={meshRef}
        args={[width, BLOCK_HEIGHT, depth]}
        radius={0.05}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedId(layer.id);
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          e.nativeEvent.preventDefault();
          setSelectedId(layer.id);
          // 通过自定义事件通知 NeuroScene 显示右键菜单
          window.dispatchEvent(new CustomEvent('layer-context-menu', {
            detail: { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, layerId: layer.id }
          }));
        }}
      >
        <meshStandardMaterial
          color={color}
          emissive={isSelected ? '#4488ff' : '#000000'}
          emissiveIntensity={isSelected ? 0.4 : 0}
          transparent
          opacity={0.85}
        />
      </RoundedBox>

      {/* 顶部标签 */}
      <Text
        position={[0, BLOCK_HEIGHT / 2 + 0.15, 0]}
        fontSize={0.2}
        color="white"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>

      {/* 侧面参数摘要 */}
      <Text
        position={[0, 0, depth / 2 + 0.01]}
        fontSize={0.12}
        color="#aaa"
        anchorX="center"
        anchorY="middle"
      >
        {paramSummary}
      </Text>

      {/* 正面输出形状 */}
      {shapeText && (
        <Text
          position={[0, -BLOCK_HEIGHT / 4, depth / 2 + 0.02]}
          fontSize={0.15}
          color="rgba(255,255,255,0.7)"
          anchorX="center"
          anchorY="middle"
        >
          {shapeText}
        </Text>
      )}
    </group>
  );
});

export default Layer3DBlock;
