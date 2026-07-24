import { useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import LayerCard from './LayerCard';
import { LAYER_META_LIST, type LayerMeta, type LayerType } from '@/types/layer';
import { CLASSIC_MODELS } from '@/types/classicModels';
import { useLayerStore } from '@/stores/useLayerStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { adaptLayersToInputShape } from '@/utils/shapeInference';
import { BLOCK_STEP, BLOCK_HEIGHT } from '@/types/layer';

const CATEGORY_LABELS: Record<string, string> = {
  conv: '卷积',
  pool: '池化',
  linear: '全连接',
  activation: '激活',
  norm: '归一化',
  utility: '工具',
};

const CATEGORY_ORDER = ['conv', 'pool', 'activation', 'norm', 'linear', 'utility'];

export default function LayerLibrary() {
  const [collapsed, setCollapsed] = useState(false);
  const [classicExpanded, setClassicExpanded] = useState(false);
  const addLayer = useLayerStore(state => state.addLayer);
  const addClassicModel = useLayerStore(state => state.addClassicModel);
  const datasetInfo = useDatasetStore(state => state.datasetInfo);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active } = event;

    if (!active.data.current) {
      return;
    }

    const layerType = active.data.current.layerType as LayerType;
    if (!layerType) {
      console.warn('Missing layerType in drag data:', active.data.current);
      return;
    }

    // 垂直模式：直接追加到栈顶，x=0, z=0，Y 由 store 的 recalcPositions 自动计算
    const currentLayers = useLayerStore.getState().layers;
    const nextY = currentLayers.length * BLOCK_STEP + BLOCK_HEIGHT / 2;
    addLayer(layerType, [0, nextY, 0]);
  };

  // 按分类分组
  const groupedLayers: Record<string, LayerMeta[]> = {};
  LAYER_META_LIST.forEach(layer => {
    const category = layer.category;
    if (!groupedLayers[category]) {
      groupedLayers[category] = [];
    }
    groupedLayers[category].push(layer);
  });

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#16213e',
        }}
      >
        {/* 面板标题 */}
        <div
          onClick={() => setCollapsed(!collapsed)}
          style={{
            padding: '12px',
            borderBottom: '1px solid #0f3460',
            cursor: 'pointer',
            userSelect: 'none',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ color: 'white', fontSize: '14px', fontWeight: 600 }}>
            层组件库
          </span>
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>
            {collapsed ? '▶' : '▼'}
          </span>
        </div>

        {/* 层列表 */}
        {!collapsed && (
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '8px',
            }}
          >
            {/* ===== 经典模型 ===== */}
            <div style={{ marginBottom: '16px' }}>
              <div
                onClick={() => setClassicExpanded(!classicExpanded)}
                style={{
                  color: classicExpanded ? '#60a5fa' : '#94a3b8',
                  fontSize: '11px',
                  fontWeight: 600,
                  marginBottom: '8px',
                  paddingLeft: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>经典模型</span>
                <span style={{ fontSize: '10px' }}>{classicExpanded ? '▼' : '▶'}</span>
              </div>

              {classicExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {CLASSIC_MODELS.map(model => {
                    const isCompatible = !datasetInfo || !model.compatibleDatasets ||
                      model.compatibleDatasets.includes(datasetInfo.type);
                    return (
                    <div
                      key={model.id}
                      onClick={() => {
                        // 根据当前数据集适配整个模型：
                        // Input 层形状 + 下游 Conv2D.inChannels / Linear.inFeatures 自动修正
                        let layersToAdd = model.layers;
                        if (datasetInfo?.type === 'csv') {
                          // CSV 是表格数据：以 1×1×特征数 编码适配（Flatten 输出 = 特征数）；
                          // 卷积模型无法完整适配（形状链在卷积层断开），由校验错误面板引导用户
                          const featureCount = (datasetInfo.columns?.length ?? 0) - 1;
                          if (featureCount > 0) {
                            layersToAdd = adaptLayersToInputShape(model.layers, [1, 1, featureCount]);
                          }
                        } else if (
                          datasetInfo &&
                          datasetInfo.channels != null &&
                          datasetInfo.imageHeight != null &&
                          datasetInfo.imageWidth != null
                        ) {
                          layersToAdd = adaptLayersToInputShape(model.layers, [
                            datasetInfo.channels,
                            datasetInfo.imageHeight,
                            datasetInfo.imageWidth,
                          ]);
                        }
                        addClassicModel(layersToAdd);
                      }}
                      style={{
                        padding: '10px',
                        backgroundColor: '#0f3460',
                        border: '1px solid #1a3a5c',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.backgroundColor = '#1a3a5c'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a3a5c'; e.currentTarget.style.backgroundColor = '#0f3460'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ color: 'white', fontSize: '12px', fontWeight: 600 }}>{model.name}</span>
                        <span style={{ color: '#64748b', fontSize: '10px' }}>{model.year}</span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '10px', lineHeight: '1.4', marginBottom: '6px' }}>
                        {model.description}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <span style={{
                            padding: '1px 6px',
                            backgroundColor: 'rgba(59, 130, 246, 0.15)',
                            borderRadius: '3px',
                            fontSize: '9px',
                            color: '#60a5fa',
                            fontWeight: 600,
                          }}>
                            {model.layers.length} 层
                          </span>
                          {datasetInfo && (
                            <span style={{
                              padding: '1px 6px',
                              backgroundColor: isCompatible ? 'rgba(63, 185, 80, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                              borderRadius: '3px',
                              fontSize: '9px',
                              color: isCompatible ? '#6ee7b7' : '#fcd34d',
                              fontWeight: 600,
                            }}>
                              {isCompatible ? '✓ 适配' : '⚠ 需调整'}
                            </span>
                          )}
                        </div>
                        <span style={{ color: '#3b82f6', fontSize: '10px', fontWeight: 600 }}>+ 添加</span>
                      </div>
                    </div>
                    );
                  })}
                  <div style={{ fontSize: '10px', color: '#64748b', padding: '4px 4px 0 4px', lineHeight: '1.5' }}>
                    💡 添加模型时会自动适配当前数据集（Input 形状、卷积通道数、全连接特征数）。
                  </div>
                </div>
              )}
            </div>

            {CATEGORY_ORDER.map(category => {
              const layers = groupedLayers[category];
              if (!layers || layers.length === 0) {
                return null;
              }

              return (
                <div key={category} style={{ marginBottom: '16px' }}>
                  {/* 分类标题 */}
                  <div
                    style={{
                      color: '#94a3b8',
                      fontSize: '11px',
                      fontWeight: 600,
                      marginBottom: '8px',
                      paddingLeft: '4px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {CATEGORY_LABELS[category]}
                  </div>

                  {/* 层卡片列表 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {layers.map(layer => (
                      <LayerCard key={layer.type} layer={layer} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DndContext>
  );
}
