import { useState } from 'react';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';

interface PredictionResult {
  success: boolean;
  predictions?: Array<{ class: number; probability: number }>;
  topClass?: number;
  topProbability?: number;
  error?: string;
}

export default function PredictPanel() {
  const layers = useLayerStore(state => state.layers);
  const finalAccuracy = useTrainingStore(state => state.finalAccuracy);

  const [imagePath, setImagePath] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);

  const hasModel = finalAccuracy !== null;
  const inputLayer = layers.find(l => l.type === 'Input');
  const inputShape = inputLayer
    ? [inputLayer.params.inChannels || 1, inputLayer.params.inputHeight || 28, inputLayer.params.inputWidth || 28]
    : [1, 28, 28];

  const handleSelectImage = async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const filePath = await open({
        multiple: false,
        filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp'] }],
        title: '选择要预测的图片',
      });
      if (!filePath || Array.isArray(filePath)) return;
      setImagePath(filePath as string);
      setResult(null);
    } catch (e) {
      console.error('Failed to select image:', e);
    }
  };

  const handlePredict = async () => {
    if (!imagePath) return;
    setLoading(true);
    setResult(null);

    try {
      const { invoke } = await import('@tauri-apps/api/tauri');

      // Rust 侧 resolve_model_path 会搜索多个已知位置
      const modelPath = '~/.neurobricks/model_weights.pth';

      const layersConfig = layers.map(l => ({ type: l.type, params: l.params }));

      const resultStr = await invoke<string>('predict_image', {
        modelPath,
        imagePath,
        layers: layersConfig,
        inputShape: inputShape,
      });

      const parsed = JSON.parse(resultStr) as PredictionResult;
      setResult(parsed);
    } catch (error) {
      setResult({ success: false, error: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 标题 */}
      <div style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '16px', paddingBottom: '8px', borderBottom: '1px solid #0f3460' }}>
        模型推理
      </div>

      {/* 未训练提示 */}
      {!hasModel && (
        <div style={{
          padding: '16px',
          backgroundColor: 'rgba(100, 116, 139, 0.1)',
          border: '1px solid rgba(100, 116, 139, 0.3)',
          borderRadius: '6px',
          color: '#94a3b8',
          fontSize: '13px',
          textAlign: 'center',
        }}>
          请先完成一次训练<br />
          <span style={{ fontSize: '11px' }}>训练完成后即可使用模型进行预测</span>
        </div>
      )}

      {hasModel && (
        <>
          {/* 选择图片 */}
          <div style={{ marginBottom: '16px' }}>
            <button
              onClick={handleSelectImage}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#1e40af',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              📷 选择图片
            </button>
            {imagePath && (
              <div style={{
                marginTop: '8px',
                padding: '8px',
                backgroundColor: '#0f3460',
                borderRadius: '4px',
                fontSize: '11px',
                color: '#94a3b8',
                wordBreak: 'break-all',
              }}>
                {imagePath}
              </div>
            )}
          </div>

          {/* 推理按钮 */}
          {imagePath && (
            <button
              onClick={handlePredict}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: loading ? '#475569' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: 600,
                marginBottom: '16px',
              }}
            >
              {loading ? '⏳ 推理中...' : '🚀 开始预测'}
            </button>
          )}

          {/* 推理结果 */}
          {result && !result.success && (
            <div style={{
              padding: '12px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid #ef4444',
              borderRadius: '6px',
              color: '#fca5a5',
              fontSize: '12px',
            }}>
              ❌ {result.error}
            </div>
          )}

          {result && result.success && result.predictions && (
            <div>
              {/* Top-1 结果 */}
              <div style={{
                padding: '16px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid #10b981',
                borderRadius: '6px',
                textAlign: 'center',
                marginBottom: '12px',
              }}>
                <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}>预测结果</div>
                <div style={{ color: '#10b981', fontSize: '28px', fontWeight: 700, fontFamily: 'monospace' }}>
                  Class {result.topClass}
                </div>
                <div style={{ color: '#6ee7b7', fontSize: '14px' }}>
                  置信度: {(result.topProbability! * 100).toFixed(1)}%
                </div>
              </div>

              {/* Top-5 概率分布 */}
              <div style={{
                backgroundColor: '#0f3460',
                borderRadius: '6px',
                padding: '10px',
              }}>
                <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600, marginBottom: '8px' }}>
                  Top-5 概率分布
                </div>
                {result.predictions.map((pred, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ color: '#94a3b8', fontSize: '11px', minWidth: '50px' }}>
                      Class {pred.class}
                    </span>
                    <div style={{ flex: 1, height: '16px', backgroundColor: '#1a3a5c', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${pred.probability * 100}%`,
                        height: '100%',
                        backgroundColor: i === 0 ? '#10b981' : '#3b82f6',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <span style={{ color: 'white', fontSize: '11px', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}>
                      {(pred.probability * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 输入形状提示 */}
          <div style={{
            marginTop: 'auto',
            padding: '8px',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderRadius: '4px',
            fontSize: '11px',
            color: '#93c5fd',
          }}>
            💡 模型期望输入: [{inputShape.join(', ')}]
            <br />
            图片会自动 resize 到此尺寸
          </div>
        </>
      )}
    </div>
  );
}
