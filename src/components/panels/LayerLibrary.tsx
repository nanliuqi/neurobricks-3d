import { useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import LayerCard from './LayerCard';
import { LAYER_META_LIST, type LayerMeta, type LayerType } from '@/types/layer';
import { CLASSIC_MODELS, type ClassicModel } from '@/types/classicModels';
import { useLayerStore } from '@/stores/useLayerStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { adaptLayersForCsvRegression, adaptLayersToInputShape } from '@/utils/shapeInference';
import { deriveCsvFeatureFields } from '@/utils/datasetContract';
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

/**
 * 经典模型列表只在 LayerLibrary（左栏唯一实例）内渲染一次，
 * 用固定 ID 让 aria-controls 指向真实的展开目标，不引入动态 ID。
 */
const CLASSIC_MODELS_LIST_ID = 'layer-library-classic-models';

/** 同上：层列表容器由「层组件库」总标题控制展开。 */
const LAYER_LIST_ID = 'layer-library-layer-list';

export default function LayerLibrary() {
  const [collapsed, setCollapsed] = useState(false);
  const [classicExpanded, setClassicExpanded] = useState(false);
  const addLayer = useLayerStore(state => state.addLayer);
  const addClassicModel = useLayerStore(state => state.addClassicModel);
  const datasetInfo = useDatasetStore(state => state.datasetInfo);
  const splitStrategy = useDatasetStore(state => state.splitStrategy);
  const groupField = useDatasetStore(state => state.groupField);
  const timeField = useDatasetStore(state => state.timeField);
  const targetField = useDatasetStore(state => state.targetField);

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

  /**
   * 预设添加的唯一实现：整张卡片的鼠标点击与卡片上的「+ 添加」按钮都调用这里，
   * 不写第二套业务规则。逻辑与原 inline handler 逐行一致。
   */
  const addClassicPreset = (model: ClassicModel) => {
    // 根据当前数据集适配整个模型：
    // Input 层形状 + 下游 Conv2D.inChannels / Linear.inFeatures 自动修正
    let layersToAdd = model.layers;
    if (datasetInfo?.type === 'csv') {
      // CSV 是单目标表格回归：以 1×1×特征数编码输入，并把最后一个
      // Linear 自动改为单值输出。特征列推导共用 datasetContract 单一来源，
      // 不在此处猜测末列即目标：未选目标列时不预适配，
      // 由数据集面板选目标后的适配确认与统一 Preflight 接管。
      const featureCount = deriveCsvFeatureFields(datasetInfo, {
        splitStrategy,
        groupField,
        timeField,
        targetField,
      })?.length ?? 0;
      if (featureCount > 0) {
        layersToAdd = adaptLayersForCsvRegression(model.layers, featureCount);
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
        data-testid="block-library"
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#16213e',
        }}
      >
        {/* 面板标题 */}
        {/*
          原生 button 负责键盘激活：Enter / Space 由浏览器合成一次 click，
          这里不另写 keydown，否则一次按键会先收起又展开。
          border 必须先归零再补回分隔线，否则原生 button 的 UA 边框会改变标题高度。
        */}
        <button
          type="button"
          onClick={() => setCollapsed(value => !value)}
          aria-expanded={!collapsed}
          aria-controls={LAYER_LIST_ID}
          style={{
            width: '100%',
            padding: '12px',
            border: 'none',
            borderBottom: '1px solid #0f3460',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            userSelect: 'none',
            textAlign: 'left',
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
        </button>

        {/* 层列表 */}
        {!collapsed && (
          <div
            id={LAYER_LIST_ID}
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '8px',
            }}
          >
            {/* ===== 经典模型 ===== */}
            <div style={{ marginBottom: '16px' }} data-testid="classic-models-section">
              {/*
                原生 button 负责键盘激活：Enter / Space 由浏览器合成一次 click，
                这里不再绑定 keydown，否则一次按键会先展开又收起。
                样式必须显式抵消原生 button 的边框与背景，否则标题尺寸会变。
              */}
              <button
                type="button"
                onClick={() => setClassicExpanded(value => !value)}
                aria-expanded={classicExpanded}
                aria-controls={CLASSIC_MODELS_LIST_ID}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  color: classicExpanded ? '#60a5fa' : '#94a3b8',
                  fontSize: '11px',
                  fontWeight: 600,
                  marginBottom: '8px',
                  paddingLeft: '4px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>经典模型</span>
                <span style={{ fontSize: '10px' }}>{classicExpanded ? '▼' : '▶'}</span>
              </button>

              {classicExpanded && (
                <div
                  id={CLASSIC_MODELS_LIST_ID}
                  style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
                >
                  {CLASSIC_MODELS.map(model => {
                    const isCompatible = !datasetInfo || !model.compatibleDatasets ||
                      model.compatibleDatasets.includes(datasetInfo.type);
                    return (
                    <div
                      key={model.id}
                      data-testid={`model-card-${model.id}`}
                      onClick={() => addClassicPreset(model)}
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
                        {/*
                          键盘可用的添加入口：可见文案仍是「+ 添加」，可访问名称带模型名。
                          必须阻止冒泡，否则父卡片的 onClick 会再添加一套同样的预设。
                        */}
                        <button
                          type="button"
                          aria-label={`添加 ${model.name} 预设`}
                          onClick={event => {
                            event.stopPropagation();
                            addClassicPreset(model);
                          }}
                          style={{
                            color: '#3b82f6',
                            fontSize: '10px',
                            fontWeight: 600,
                            backgroundColor: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          + 添加
                        </button>
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
