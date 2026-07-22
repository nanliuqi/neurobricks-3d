import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useLayerStore } from '../../stores/useLayerStore';
import { useTrainingStore } from '../../stores/useTrainingStore';
import Layer3DBlock from './Layer3DBlock';
import ConnectionLine from './ConnectionLine';
import GridFloor from './GridFloor';
import GradientOverlay from './GradientOverlay';
import ShapeTooltip from './ShapeTooltip';
import DataFlowParticles from './DataFlowParticles';
import { useRef, useEffect, useState } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

const INITIAL_CAMERA_POS = [0, 8, 12] as const;
const INITIAL_TARGET = [0, 2, 0] as const;

/** 相机控制桥接组件：监听 scene-reset / scene-lock 事件 */
function CameraControlsBridge() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const [locked, setLocked] = useState(false);

  // 监听自定义事件
  useEffect(() => {
    const handleReset = () => {
      camera.position.set(...INITIAL_CAMERA_POS);
      camera.lookAt(...INITIAL_TARGET);
      if (controlsRef.current) {
        controlsRef.current.target.set(...INITIAL_TARGET);
        controlsRef.current.update();
      }
    };

    const handleLock = (e: Event) => {
      const { locked: isLocked } = (e as CustomEvent).detail;
      setLocked(isLocked);
    };

    window.addEventListener('scene-reset', handleReset);
    window.addEventListener('scene-lock', handleLock);
    return () => {
      window.removeEventListener('scene-reset', handleReset);
      window.removeEventListener('scene-lock', handleLock);
    };
  }, [camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={!locked}
      enableRotate={!locked}
      enableZoom={!locked}
      maxPolarAngle={Math.PI * 0.85}
    />
  );
}

export default function NeuroScene() {
  const layers = useLayerStore(state => state.layers);
  const setSelectedId = useLayerStore(state => state.setSelectedId);
  const selectedId = useLayerStore(state => state.selectedId);
  const isTraining = useTrainingStore(state => state.isTraining);
  const isPaused = useTrainingStore(state => state.isPaused);
  const currentEpoch = useTrainingStore(state => state.currentEpoch);
  const prevEpochRef = useRef(0);

  // 按 order 排序层
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);

  // Epoch 变化时触发积木闪光
  useEffect(() => {
    if (currentEpoch > prevEpochRef.current) {
      useLayerStore.getState().triggerFlash();
    }
    prevEpochRef.current = currentEpoch;
  }, [currentEpoch]);

  // 全局键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const store = useLayerStore.getState();
      const currentSelectedId = store.selectedId;

      // 焦点在输入框时，所有快捷键放行
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active as HTMLElement)?.isContentEditable) {
        return;
      }

      switch (e.key) {
        case 'Backspace':
          if (currentSelectedId) {
            e.preventDefault();
            store.removeLayer(currentSelectedId);
          }
          break;
        case 'Escape':
          store.setSelectedId(null);
          break;
        case 'ArrowUp':
          if (currentSelectedId) {
            e.preventDefault();
            const currentLayer = store.layers.find(l => l.id === currentSelectedId);
            if (!currentLayer) break;
            if (e.shiftKey) {
              // Shift+↑：上移一位（换位）
              if (currentLayer.order > 0) {
                store.moveLayer(currentSelectedId, currentLayer.order - 1);
              }
            } else {
              // 普通 ↑：切换到上一层
              const sorted = [...store.layers].sort((a, b) => a.order - b.order);
              const idx = sorted.findIndex(l => l.id === currentSelectedId);
              if (idx > 0) store.setSelectedId(sorted[idx - 1].id);
            }
          }
          break;
        case 'ArrowDown':
          if (currentSelectedId) {
            e.preventDefault();
            const currentLayer = store.layers.find(l => l.id === currentSelectedId);
            if (!currentLayer) break;
            if (e.shiftKey) {
              // Shift+↓：下移一位（换位）
              if (currentLayer.order < store.layers.length - 1) {
                store.moveLayer(currentSelectedId, currentLayer.order + 1);
              }
            } else {
              // 普通 ↓：切换到下一层
              const sorted = [...store.layers].sort((a, b) => a.order - b.order);
              const idx = sorted.findIndex(l => l.id === currentSelectedId);
              if (idx >= 0 && idx < sorted.length - 1) store.setSelectedId(sorted[idx + 1].id);
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* 空场景引导 */}
      {layers.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          <div style={{
            color: '#94a3b8',
            fontSize: '18px',
            fontWeight: 600,
            marginBottom: '12px',
          }}>
            从左侧拖拽层组件到场景中
          </div>
          <div style={{
            color: '#64748b',
            fontSize: '13px',
            lineHeight: '1.8',
          }}>
            拖拽层积木到 3D 场景搭建网络<br />
            或点击经典模型一键添加
          </div>
          <div style={{
            marginTop: '16px',
            color: '#475569',
            fontSize: '11px',
          }}>
            ↑↓ 切换选中 · Shift+↑↓ 换位 · Backspace 删除 · Escape 取消选择
          </div>
        </div>
      )}

      <Canvas
        camera={{ position: [0, 8, 12], fov: 50 }}
        gl={{ antialias: true }}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onPointerMissed={() => setSelectedId(null)}
      >
      {/* 环境光 */}
      <ambientLight intensity={0.4} />

      {/* 方向光 */}
      <directionalLight position={[10, 15, 10]} intensity={0.8} />

      {/* 网格地面 */}
      <GridFloor />

      {/* 渲染所有层积木 */}
      {sortedLayers.map(layer => (
        <group key={layer.id}>
          <Layer3DBlock layer={layer} />
          <GradientOverlay layer={layer} />
          <ShapeTooltip layer={layer} visible={layer.id === selectedId} />
        </group>
      ))}

      {/* 渲染连接线（相邻层之间） */}
      {sortedLayers.map((layer, index) => {
        if (index < sortedLayers.length - 1) {
          const nextLayer = sortedLayers[index + 1];
          const hasError = layer.validationError !== null || nextLayer.validationError !== null;

          return (
            <ConnectionLine
              key={`${layer.id}-${nextLayer.id}`}
              from={layer.position}
              to={nextLayer.position}
              hasError={hasError}
            />
          );
        }
        return null;
      })}

      {/* 训练时数据流粒子动画 */}
      {isTraining && !isPaused && sortedLayers.length > 0 && (
        <DataFlowParticles maxHeight={sortedLayers.length * 1.3} />
      )}

      {/* 相机控制器 */}
      <CameraControlsBridge />
    </Canvas>
    </div>
  );
}
