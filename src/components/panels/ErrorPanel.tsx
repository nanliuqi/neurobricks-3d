import { useLayerStore } from '../../stores/useLayerStore';
import type { ShapeValidationError } from '../../types/layer';
import { LAYER_META_LIST } from '../../types/layer';

const ErrorPanel = () => {
  const validationResult = useLayerStore(state => state.validationResult);
  const setSelectedId = useLayerStore(state => state.setSelectedId);

  const getLayerLabel = (layerType: string): string => {
    const meta = LAYER_META_LIST.find(m => m.type === layerType);
    return meta ? meta.label : layerType;
  };

  const errorCount = validationResult.errors.length;
  const warningCount = validationResult.warnings?.length || 0;

  return (
    <div style={{
      maxHeight: '180px',
      display: 'flex',
      flexDirection: 'column',
      borderBottom: '1px solid #0f3460',
    }}>
      {/* 标题 */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #0f3460',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{ color: 'white', fontSize: '12px', fontWeight: 600 }}>校验结果</span>
        {errorCount > 0 && (
          <span style={{
            backgroundColor: '#ef4444',
            color: 'white',
            fontSize: '10px',
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: '10px',
            minWidth: '18px',
            textAlign: 'center',
          }}>
            {errorCount}
          </span>
        )}
      </div>

      {/* 内容 - 固定高度可滚动 */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '8px 12px',
        maxHeight: '140px',
      }}>
        {/* 无错误 */}
        {errorCount === 0 && warningCount === 0 && (
          <div style={{ color: '#10b981', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0' }}>
            <span>✓</span>
            <span>网络结构正确</span>
          </div>
        )}

        {/* 警告 */}
        {validationResult.warnings?.map((warning, index) => (
          <div key={`w-${index}`} style={{
            padding: '4px 8px',
            marginBottom: '4px',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            borderLeft: '3px solid #f59e0b',
            borderRadius: '3px',
            fontSize: '10px',
            color: '#f59e0b',
          }}>
            ⚠ {warning}
          </div>
        ))}

        {/* 错误 - 紧凑模式 */}
        {validationResult.errors.map((error: ShapeValidationError, index: number) => (
          <div
            key={error.layerId || index}
            onClick={() => error.layerId && setSelectedId(error.layerId)}
            style={{
              padding: '4px 8px',
              marginBottom: '3px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderLeft: '3px solid #ef4444',
              borderRadius: '3px',
              cursor: error.layerId ? 'pointer' : 'default',
              fontSize: '10px',
            }}
          >
            <div style={{ color: '#fca5a5', fontWeight: 600, marginBottom: '1px' }}>
              {getLayerLabel(error.layerType)} {error.layerId ? `·${error.layerId.substring(0, 6)}` : ''}
            </div>
            <div style={{ color: '#f87171' }}>
              {error.message}
            </div>
            {error.suggestion && (
              <div style={{ color: '#fbbf24', fontStyle: 'italic', marginTop: '1px' }}>
                💡 {error.suggestion}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ErrorPanel;
