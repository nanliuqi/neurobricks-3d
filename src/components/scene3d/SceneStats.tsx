import { useLayerStore } from '../../stores/useLayerStore';
import { LAYER_META_LIST } from '../../types/layer';

// Tauri API 动态导入（不使用 isTauri 守卫，直接 try/catch）

export default function SceneStats() {
  const layers = useLayerStore(state => state.layers);
  const layoutMode = useLayerStore(state => state.layoutMode);
  const totalParams = useLayerStore(state => state.totalParams);
  const hasShapeError = useLayerStore(state => state.hasShapeError);
  const setLayoutMode = useLayerStore(state => state.setLayoutMode);

  // 按 order 排序层
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);

  // 保存项目
  const handleSave = async () => {
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');

      const config = {
        layers: layers.map(layer => ({
          id: layer.id,
          type: layer.type,
          params: layer.params,
          position: layer.position,
          order: layer.order,
        })),
        layoutMode,
      };

      const filePath = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: 'project.json',
      });

      if (!filePath) return;

      await invoke('save_project', { data: JSON.stringify(config), path: filePath });
      alert('项目保存成功');
    } catch (error) {
      console.error('Failed to save project:', error);
      alert('保存失败：' + (error as Error).message);
    }
  };

  // 加载项目
  const handleLoad = async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');

      const filePath = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        title: '选择项目文件',
      });

      if (!filePath) return;

      const data = await invoke<string>('load_project', { path: filePath });
      const config = JSON.parse(data);

      // 恢复 Store 状态
      useLayerStore.getState().loadProject({
        layers: config.layers,
        layoutMode: config.layoutMode,
      });

      alert('项目加载成功');
    } catch (error) {
      console.error('Failed to load project:', error);
      alert('加载失败：' + (error as Error).message);
    }
  };

  // 格式化输出形状
  const formatOutputShape = (shape: number[] | null | undefined): string => {
    if (!shape || shape.length === 0) {
      return '?';
    }
    return `[${shape.join(', ')}]`;
  };

  // 获取层类型标签
  const getLayerLabel = (type: string): string => {
    const meta = LAYER_META_LIST.find(m => m.type === type);
    return meta?.label ?? type;
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {/* 面板标题 */}
      <div
        style={{
          color: 'white',
          fontSize: '14px',
          fontWeight: 600,
          marginBottom: '16px',
          paddingBottom: '8px',
          borderBottom: '1px solid #0f3460',
        }}
      >
        场景统计
      </div>

      {/* 统计信息 */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ marginBottom: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>总层数：</span>
          <span style={{ color: 'white', fontSize: '13px', fontWeight: 600 }}>{layers.length}</span>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>总参数量：</span>
          <span style={{ color: 'white', fontSize: '13px', fontWeight: 600 }}>{totalParams.toLocaleString()}</span>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>网络状态：</span>
          <span
            style={{
              color: hasShapeError ? '#ef4444' : '#10b981',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            {hasShapeError ? '❌ 存在错误' : '✓ 结构正确'}
          </span>
        </div>
      </div>

      {/* 网络形状摘要 */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px', fontWeight: 600 }}>
          网络形状
        </div>
        <div
          style={{
            backgroundColor: '#0f3460',
            borderRadius: '6px',
            padding: '10px',
            fontSize: '11px',
            fontFamily: 'monospace',
            lineHeight: '1.8',
          }}
        >
          {sortedLayers.length === 0 ? (
            <div style={{ color: '#64748b', textAlign: 'center' }}>暂无层</div>
          ) : (
            sortedLayers.map((layer, index) => (
              <div key={layer.id}>
                <span style={{ color: '#60a5fa' }}>{getLayerLabel(layer.type)}</span>
                <span style={{ color: '#94a3b8' }}> → </span>
                <span style={{ color: 'white' }}>{formatOutputShape(layer.outputShape)}</span>
                {index < sortedLayers.length - 1 && (
                  <div style={{ color: '#475569', textAlign: 'center', margin: '2px 0' }}>↓</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 布局模式切换 */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px', fontWeight: 600 }}>
          布局模式
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setLayoutMode('vertical')}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: layoutMode === 'vertical' ? '#1e40af' : '#0f3460',
              color: layoutMode === 'vertical' ? 'white' : '#94a3b8',
              border: layoutMode === 'vertical' ? '2px solid #3b82f6' : '1px solid #1a3a5c',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              transition: 'all 0.2s',
            }}
          >
            垂直模式
          </button>
          <button
            onClick={() => setLayoutMode('free')}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: layoutMode === 'free' ? '#1e40af' : '#0f3460',
              color: layoutMode === 'free' ? 'white' : '#94a3b8',
              border: layoutMode === 'free' ? '2px solid #3b82f6' : '1px solid #1a3a5c',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              transition: 'all 0.2s',
            }}
          >
            自由模式
          </button>
        </div>
      </div>

      {/* 保存/加载按钮 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleSave}
          disabled={layers.length === 0}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: layers.length === 0 ? '#475569' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: layers.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => {
            if (layers.length > 0) e.currentTarget.style.backgroundColor = '#059669';
          }}
          onMouseLeave={(e) => {
            if (layers.length > 0) e.currentTarget.style.backgroundColor = '#10b981';
          }}
        >
          💾 保存
        </button>
        <button
          onClick={handleLoad}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#2563eb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#3b82f6';
          }}
        >
          📂 加载
        </button>
      </div>
    </div>
  );
}
