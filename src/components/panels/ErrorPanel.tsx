import { useLayerStore } from '../../stores/useLayerStore';
import type { ShapeValidationError } from '../../types/layer';

const ErrorPanel = () => {
  const validationResult = useLayerStore(state => state.validationResult);
  const setSelectedId = useLayerStore(state => state.setSelectedId);

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
          <div style={{
            padding: '12px',
            color: '#6ee7b7',
            fontSize: '12px',
            textAlign: 'center',
          }}>
            ✓ 网络结构校验通过
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

        {/* 错误 - 形状对比模式 */}
        {validationResult.errors.map((error: ShapeValidationError, index: number) => {
          const hasShapeCompare = error.expectedInputShape && error.actualInputShape;

          return (
            <div
              key={error.layerId || index}
              onClick={() => error.layerId && setSelectedId(error.layerId)}
              style={{
                padding: '10px',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                marginBottom: '8px',
                cursor: error.layerId ? 'pointer' : 'default',
              }}
            >
              {/* 层类型 + 错误类型标签 */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                <span style={{ color: '#fca5a5', fontSize: '12px', fontWeight: 600 }}>
                  {error.layerType} {error.layerId ? `· ${error.layerId.substring(0, 6)}` : ''}
                </span>
                <span style={{
                  padding: '1px 6px',
                  borderRadius: '3px',
                  fontSize: '9px',
                  fontWeight: 600,
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                  color: '#fca5a5',
                }}>
                  {error.errorType === 'missing_flatten' ? '缺少 Flatten' :
                   error.errorType === 'shape_mismatch' ? '形状不匹配' :
                   error.errorType === 'invalid_dimension' ? '维度无效' : '参数冲突'}
                </span>
              </div>

              {/* 形状对比（如果有） */}
              {hasShapeCompare && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                }}>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(63, 185, 80, 0.15)',
                    color: '#6ee7b7',
                  }}>
                    期望: [{error.expectedInputShape!.join(', ')}]
                  </span>
                  <span style={{ color: '#64748b' }}>→</span>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    color: '#fca5a5',
                  }}>
                    实际: [{error.actualInputShape!.join(', ')}]
                  </span>
                </div>
              )}

              {/* 错误消息 */}
              <div style={{ color: '#94a3b8', fontSize: '11px', lineHeight: '1.5', marginBottom: hasShapeCompare ? '4px' : '6px' }}>
                {error.message}
              </div>

              {/* 修复建议 */}
              {error.suggestion && (
                <div style={{ color: '#60a5fa', fontSize: '10px', marginTop: '4px' }}>
                  💡 {error.suggestion}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ErrorPanel;
