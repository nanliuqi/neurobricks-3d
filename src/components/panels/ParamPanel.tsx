import { useState, useRef, useEffect } from 'react';
import { useLayerStore } from '@/stores/useLayerStore';
import type { LayerType } from '@/types/layer';
import { LAYER_META_LIST } from '@/types/layer';

const PARAM_LABELS: Record<string, string> = {
  inChannels: 'inChannels (输入通道)',
  outChannels: 'outChannels (输出通道)',
  kernelSize: 'kernelSize (卷积核大小)',
  stride: 'stride (步长)',
  padding: 'padding (填充)',
  inFeatures: 'inFeatures (输入特征)',
  outFeatures: 'outFeatures (输出特征)',
  poolKernelSize: 'poolKernelSize (池化核大小)',
  poolStride: 'poolStride (池化步长)',
  dropRate: 'dropRate (丢弃率)',
  numFeatures: 'numFeatures (特征数)',
};

export default function ParamPanel() {
  const selectedId = useLayerStore(state => state.selectedId);
  const layer = useLayerStore(state => state.layers.find(l => l.id === state.selectedId));
  const layerCount = useLayerStore(state => state.layers.length);
  const updateLayerParam = useLayerStore(state => state.updateLayerParam);
  const removeLayer = useLayerStore(state => state.removeLayer);
  const setSelectedId = useLayerStore(state => state.setSelectedId);
  const moveLayer = useLayerStore(state => state.moveLayer);

  // 视觉反馈状态
  const [savedField, setSavedField] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!selectedId || !layer) {
    return (
      <div style={{ padding: '16px', color: '#94a3b8', textAlign: 'center' }}>
        {!selectedId ? '请选择一个层' : '层不存在'}
      </div>
    );
  }

  // 获取层的中文名称
  const layerMeta = LAYER_META_LIST.find(m => m.type === layer.type);
  const shortId = layer.id.substring(0, 8);

  // 统一的参数修改回调（带视觉反馈）
  const handleParamChange = (fieldName: string, value: number) => {
    updateLayerParam(selectedId, fieldName, value);

    // 视觉反馈
    setSavedField(fieldName);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedField(null), 800);
  };

  // 渲染参数字段
  const renderParams = () => {
    const params = layer.params;

    switch (layer.type as LayerType) {
      case 'Conv2D':
        return (
          <>
            <ParamField
              label={PARAM_LABELS.inChannels}
              value={params.inChannels || 1}
              onChange={(v) => handleParamChange('inChannels', v)}
              min={1}
              savedField={savedField}
              fieldName="inChannels"
            />
            <ParamField
              label={PARAM_LABELS.outChannels}
              value={params.outChannels || 32}
              onChange={(v) => handleParamChange('outChannels', v)}
              min={1}
              savedField={savedField}
              fieldName="outChannels"
            />
            <ParamField
              label={PARAM_LABELS.kernelSize}
              value={params.kernelSize || 3}
              onChange={(v) => handleParamChange('kernelSize', v)}
              min={1}
              savedField={savedField}
              fieldName="kernelSize"
            />
            <ParamField
              label={PARAM_LABELS.stride}
              value={params.stride || 1}
              onChange={(v) => handleParamChange('stride', v)}
              min={1}
              savedField={savedField}
              fieldName="stride"
            />
            <ParamField
              label={PARAM_LABELS.padding}
              value={params.padding || 0}
              onChange={(v) => handleParamChange('padding', v)}
              min={0}
              savedField={savedField}
              fieldName="padding"
            />
          </>
        );

      case 'MaxPool2D':
        return (
          <>
            <ParamField
              label={PARAM_LABELS.poolKernelSize}
              value={params.poolKernelSize ?? 2}
              onChange={(v) => handleParamChange('poolKernelSize', v)}
              min={1}
              savedField={savedField}
              fieldName="poolKernelSize"
            />
            <ParamField
              label={PARAM_LABELS.poolStride}
              value={params.poolStride ?? 2}
              onChange={(v) => handleParamChange('poolStride', v)}
              min={1}
              savedField={savedField}
              fieldName="poolStride"
            />
          </>
        );

      case 'AvgPool2D':
        return (
          <>
            <ParamField
              label={PARAM_LABELS.poolKernelSize}
              value={params.poolKernelSize ?? 2}
              onChange={(v) => handleParamChange('poolKernelSize', v)}
              min={1}
              savedField={savedField}
              fieldName="poolKernelSize"
            />
            <ParamField
              label={PARAM_LABELS.poolStride}
              value={params.poolStride ?? 2}
              onChange={(v) => handleParamChange('poolStride', v)}
              min={1}
              savedField={savedField}
              fieldName="poolStride"
            />
          </>
        );

      case 'Linear':
        return (
          <>
            <ParamField
              label={PARAM_LABELS.inFeatures}
              value={params.inFeatures || 784}
              onChange={(v) => handleParamChange('inFeatures', v)}
              min={1}
              savedField={savedField}
              fieldName="inFeatures"
            />
            <ParamField
              label={PARAM_LABELS.outFeatures}
              value={params.outFeatures || 128}
              onChange={(v) => handleParamChange('outFeatures', v)}
              min={1}
              savedField={savedField}
              fieldName="outFeatures"
            />
          </>
        );

      case 'BatchNorm2d':
        return (
          <ParamField
            label={PARAM_LABELS.numFeatures}
            value={params.numFeatures || 64}
            onChange={(v) => handleParamChange('numFeatures', v)}
            min={1}
            savedField={savedField}
            fieldName="numFeatures"
          />
        );

      case 'Dropout':
        return (
          <ParamField
            label={PARAM_LABELS.dropRate}
            value={params.dropRate || 0.5}
            onChange={(v) => handleParamChange('dropRate', v)}
            min={0}
            max={1}
            step={0.1}
            savedField={savedField}
            fieldName="dropRate"
          />
        );

      case 'Sigmoid':
      case 'Tanh':
        return (
          <div style={{ color: '#94a3b8', fontSize: '12px', padding: '8px 0' }}>
            此层无可配置参数
          </div>
        );

      case 'LayerNorm':
        return (
          <ParamField
            label="normalizedShape (归一化维度)"
            value={params.normalizedShape ?? 64}
            onChange={(v) => handleParamChange('normalizedShape', v)}
            min={1}
            savedField={savedField}
            fieldName="normalizedShape"
          />
        );

      case 'Input':
        return (
          <>
            <ParamField
              label="inChannels (输入通道)"
              value={params.inChannels ?? 1}
              onChange={(v) => handleParamChange('inChannels', v)}
              min={1}
              savedField={savedField}
              fieldName="inChannels"
            />
            <ParamField
              label="inputHeight (输入高度)"
              value={params.inputHeight ?? 28}
              onChange={(v) => handleParamChange('inputHeight', v)}
              min={1}
              savedField={savedField}
              fieldName="inputHeight"
            />
            <ParamField
              label="inputWidth (输入宽度)"
              value={params.inputWidth ?? 28}
              onChange={(v) => handleParamChange('inputWidth', v)}
              min={1}
              savedField={savedField}
              fieldName="inputWidth"
            />
          </>
        );

      case 'ReLU':
      case 'Flatten':
        return (
          <div style={{ color: '#94a3b8', fontSize: '12px', padding: '8px 0' }}>
            此层无可配置参数
          </div>
        );

      default:
        return null;
    }
  };

  // 格式化输出形状
  const formatOutputShape = (shape: number[] | null) => {
    if (!shape) return '未计算';
    if (shape.length === 1) return `[${shape[0]}]`;
    if (shape.length === 3) return `[${shape[2]}, ${shape[0]}, ${shape[1]}]`; // [H, W, C] -> [C, H, W]
    return `[${shape.join(', ')}]`;
  };

  return (
    <div style={{ padding: '12px' }}>
      {/* 面板标题 */}
      <div style={{ marginBottom: '16px', borderBottom: '1px solid #0f3460', paddingBottom: '8px' }}>
        <div style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>
          {layer.type} · {layerMeta?.label}
        </div>
        <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '2px' }}>
          {layerMeta?.description}
        </div>
        <div style={{ color: '#64748b', fontSize: '10px' }}>
          ID: {shortId}
        </div>
      </div>

      {/* 参数表单 */}
      <div style={{ marginBottom: '16px' }}>
        {renderParams()}
      </div>

      {/* 层信息 */}
      <div
        style={{
          borderTop: '1px solid #0f3460',
          paddingTop: '12px',
          marginBottom: '12px',
        }}
      >
        <div style={{ marginBottom: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '11px' }}>输出形状：</span>
          <span style={{ color: 'white', fontSize: '12px', fontFamily: 'monospace' }}>
            {formatOutputShape(layer.outputShape)}
          </span>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '11px' }}>参数量：</span>
          <span style={{ color: 'white', fontSize: '12px' }}>
            {layer.paramCount.toLocaleString()}
          </span>
        </div>
        {layer.validationError && (
          <div style={{ color: '#ef4444', fontSize: '11px', marginTop: '8px' }}>
            ⚠ {layer.validationError}
          </div>
        )}
      </div>

      {/* 层级信息 */}
      <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#94a3b8', fontSize: '12px' }}>
          第 <span style={{ color: 'white', fontWeight: 600 }}>{layer.order + 1}</span> 层 / 共 {layerCount} 层
        </span>
        <span style={{
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: 600,
          backgroundColor: layer.validationError ? '#7f1d1d' : '#065f46',
          color: layer.validationError ? '#fecaca' : '#6ee7b7',
        }}>
          {layer.validationError ? '⚠ 错误' : '✓ 正常'}
        </span>
      </div>

      <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }}>
        换位：Shift+↑↓ 快捷键 或 点击下方按钮
      </div>

      {/* 换位按钮 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <button
          onClick={() => moveLayer(selectedId, layer.order - 1)}
          disabled={layer.order === 0}
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: layer.order === 0 ? '#475569' : '#7c3aed',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: layer.order === 0 ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          ⇈ 上移
        </button>
        <button
          onClick={() => moveLayer(selectedId, layer.order + 1)}
          disabled={layer.order === layerCount - 1}
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: layer.order === layerCount - 1 ? '#475569' : '#7c3aed',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: layer.order === layerCount - 1 ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          ⇩ 下移
        </button>
      </div>

      {/* 切换选中层按钮 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button
          onClick={() => {
            const allLayers = useLayerStore.getState().layers;
            const above = allLayers.find(l => l.order === layer.order - 1);
            if (above) setSelectedId(above.id);
          }}
          disabled={layer.order === 0}
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: layer.order === 0 ? '#475569' : '#1e40af',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: layer.order === 0 ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          ↑ 上一层
        </button>
        <button
          onClick={() => {
            const allLayers = useLayerStore.getState().layers;
            const below = allLayers.find(l => l.order === layer.order + 1);
            if (below) setSelectedId(below.id);
          }}
          disabled={layer.order === layerCount - 1}
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: layer.order === layerCount - 1 ? '#475569' : '#1e40af',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: layer.order === layerCount - 1 ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          ↓ 下一层
        </button>
      </div>

      {/* 删除按钮 */}
      <button
        onClick={() => removeLayer(selectedId)}
        style={{
          width: '100%',
          padding: '8px',
          backgroundColor: '#dc2626',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 600,
          transition: 'background-color 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#b91c1c';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = '#dc2626';
        }}
      >
        删除此层
      </button>
    </div>
  );
}

// 参数输入字段组件
interface ParamFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  savedField?: string | null;
  fieldName?: string;
}

function ParamField({ label, value, onChange, min, max, step, savedField, fieldName }: ParamFieldProps) {
  const isSaved = savedField === fieldName;
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 同步外部变化（如加载项目 / 适配数据集时 store 直接修改 params）
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (newValue: number) => {
    setLocalValue(newValue);
    // 防抖 300ms：停止输入后才触发全网络重算
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onChange(newValue);
    }, 300);
  };

  // 卸载时清理 timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{ display: 'block', color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}>
        {label}
      </label>
      <input
        type="number"
        value={localValue}
        onChange={(e) => handleChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step || 1}
        style={{
          width: '100%',
          padding: '6px 8px',
          backgroundColor: '#0f3460',
          border: isSaved ? '1px solid #10b981' : '1px solid #1a3a5c',
          borderRadius: '4px',
          color: 'white',
          fontSize: '12px',
          outline: 'none',
          transition: 'border-color 0.3s ease',
        }}
        onFocus={(e) => {
          if (!isSaved) e.currentTarget.style.borderColor = '#3b82f6';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = isSaved ? '#10b981' : '#1a3a5c';
          // 失焦时立即同步（不等防抖）
          if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
          }
          onChange(localValue);
        }}
      />
    </div>
  );
}
