import { Html } from '@react-three/drei';
import { Layer3D, LAYER_META_LIST } from '../../types/layer';

interface ShapeTooltipProps {
  layer: Layer3D;
  visible: boolean;
}

export default function ShapeTooltip({ layer, visible }: ShapeTooltipProps) {
  // 如果不可见，返回 null
  if (!visible) {
    return null;
  }

  // 获取层类型标签
  const label = LAYER_META_LIST.find(m => m.type === layer.type)?.label ?? layer.type;

  // 格式化输出形状
  const formatOutputShape = (shape: number[] | null | undefined): string => {
    if (!shape || shape.length === 0) {
      return '未计算';
    }
    return `[${shape.join(', ')}]`;
  };

  return (
    <Html
      position={[0, 1, 0]}
      style={{ pointerEvents: 'none' }}
      transform={false}
    >
      <div
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          color: 'white',
          padding: '6px 10px',
          borderRadius: '6px',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          transform: 'translateY(-20px)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
        }}
      >
        {/* 层类型名 */}
        <div style={{ fontWeight: 600, marginBottom: '4px' }}>
          {label}
        </div>

        {/* 输出形状 */}
        <div style={{ marginBottom: '2px' }}>
          <span style={{ color: '#94a3b8' }}>输出形状：</span>
          <span style={{ fontFamily: 'monospace' }}>
            {formatOutputShape(layer.outputShape)}
          </span>
        </div>

        {/* 参数量 */}
        <div style={{ marginBottom: layer.validationError ? '4px' : '0' }}>
          <span style={{ color: '#94a3b8' }}>参数量：</span>
          <span>{layer.paramCount.toLocaleString()}</span>
        </div>

        {/* 校验错误（如有） */}
        {layer.validationError && (
          <div style={{ color: '#ef4444', marginTop: '4px', fontStyle: 'italic' }}>
            ⚠ {layer.validationError}
          </div>
        )}
      </div>
    </Html>
  );
}
