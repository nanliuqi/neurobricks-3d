import { useState } from 'react';
import { usePredictCardsStore, type PredictCard } from '@/stores/usePredictCardsStore';
import { getDatasetKind, getClassLabel } from '@/utils/classLabels';

interface PredictionResult {
  success: boolean;
  predictions?: Array<{ class: number; probability: number }>;
  topClass?: number;
  topProbability?: number;
  error?: string;
}

/** 将时间戳格式化为 MM-DD HH:mm，便于区分不同训练卡片 */
function formatTrainTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PredictPanel() {
  const cards = usePredictCardsStore(state => state.cards);
  const removeCard = usePredictCardsStore(state => state.removeCard);
  const renameCard = usePredictCardsStore(state => state.renameCard);

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  // 内联重命名状态：正在编辑的卡片 id 与当前输入值
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const selectedCard: PredictCard | null = cards.find(c => c.id === selectedCardId) ?? null;
  // 数据集类型（用于类别语义化：MNIST→数字，CIFAR-10→中文名称）
  const datasetKind = getDatasetKind(selectedCard?.dataset);
  const topLabel = result && result.success && result.topClass != null
    ? getClassLabel(datasetKind, result.topClass)
    : null;

  const handleSelectCard = (id: string) => {
    setSelectedCardId(id);
    setImagePath(null);
    setResult(null);
  };

  const handleDeleteCard = (id: string) => {
    removeCard(id);
    if (selectedCardId === id) {
      setSelectedCardId(null);
      setImagePath(null);
      setResult(null);
    }
  };

  // 开始重命名：预填当前名称（默认名称）供用户修改
  const handleStartRename = (card: PredictCard) => {
    setEditingCardId(card.id);
    setEditingName(card.name);
  };

  // 确认重命名（空名称由 store 忽略，保留原名）
  const handleConfirmRename = () => {
    if (editingCardId) {
      renameCard(editingCardId, editingName);
    }
    setEditingCardId(null);
    setEditingName('');
  };

  const handleCancelRename = () => {
    setEditingCardId(null);
    setEditingName('');
  };

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
    if (!imagePath || !selectedCard) return;
    setLoading(true);
    setResult(null);

    try {
      const { invoke } = await import('@tauri-apps/api/tauri');

      // 使用选中卡片对应的独立权重文件与训练时的层配置
      const modelPath = `~/.neurobricks/models/${selectedCard.id}.pth`;
      const layersConfig = selectedCard.layers.map(l => ({ type: l.type, params: l.params }));

      const resultStr = await invoke<string>('predict_image', {
        modelPath,
        imagePath,
        layers: layersConfig,
        inputShape: selectedCard.inputShape,
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
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {/* 标题 */}
      <div style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #0f3460' }}>
        模型推理
      </div>

      {/* 无可用模型卡片 */}
      {cards.length === 0 && (
        <div style={{
          padding: '16px',
          backgroundColor: 'rgba(100, 116, 139, 0.1)',
          border: '1px solid rgba(100, 116, 139, 0.3)',
          borderRadius: '6px',
          color: '#94a3b8',
          fontSize: '13px',
          textAlign: 'center',
        }}>
          暂无可用模型<br />
          <span style={{ fontSize: '11px' }}>完成一次训练后，训练结果会以卡片形式出现在这里</span>
        </div>
      )}

      {/* 模型卡片列表 */}
      {cards.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600, marginBottom: '6px' }}>
            选择模型（{cards.length}）
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {cards.map(card => {
              const isSelected = card.id === selectedCardId;
              return (
                <div
                  key={card.id}
                  onClick={() => handleSelectCard(card.id)}
                  style={{
                    padding: '10px',
                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : '#0f3460',
                    border: isSelected ? '1px solid #3b82f6' : '1px solid #1a3a5c',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                  }}
                >
                  {/* 卡片标题：模型类型 + 数据集 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{
                      padding: '1px 6px',
                      borderRadius: '3px',
                      fontSize: '9px',
                      fontWeight: 700,
                      backgroundColor: 'rgba(59, 130, 246, 0.25)',
                      color: '#93c5fd',
                    }}>
                      {card.modelType}
                    </span>
                    {editingCardId === card.id ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={handleConfirmRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleConfirmRename();
                          else if (e.key === 'Escape') handleCancelRename();
                        }}
                        placeholder="输入卡片名称"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: 'white',
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor: '#0a1a33',
                          border: '1px solid #3b82f6',
                          borderRadius: '3px',
                          padding: '2px 6px',
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <span style={{ color: 'white', fontSize: '12px', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {card.name}
                      </span>
                    )}
                    {/* 重命名按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStartRename(card); }}
                      title="重命名此模型卡片"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#64748b',
                        cursor: 'pointer',
                        fontSize: '12px',
                        padding: '0 2px',
                        lineHeight: 1,
                      }}
                    >
                      ✏️
                    </button>
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteCard(card.id); }}
                      title="删除此模型卡片"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#64748b',
                        cursor: 'pointer',
                        fontSize: '13px',
                        padding: '0 2px',
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  {/* 卡片元信息：准确率 / 轮数 / 训练时间 */}
                  <div style={{ display: 'flex', gap: '10px', fontSize: '10px', color: '#94a3b8' }}>
                    <span>准确率 <span style={{ color: '#6ee7b7', fontFamily: 'monospace' }}>{(card.finalAccuracy * 100).toFixed(1)}%</span></span>
                    <span>{card.epochs} 轮</span>
                    <span style={{ fontFamily: 'monospace' }}>{formatTrainTime(card.timestamp)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 未选择卡片时的提示 */}
      {cards.length > 0 && !selectedCard && (
        <div style={{
          padding: '12px',
          backgroundColor: 'rgba(59, 130, 246, 0.08)',
          borderRadius: '6px',
          fontSize: '12px',
          color: '#93c5fd',
          textAlign: 'center',
        }}>
          👆 请先选择一个模型卡片，再进行预测
        </div>
      )}

      {/* 选中卡片后的推理流程 */}
      {selectedCard && (
        <>
          {/* 选中卡片信息 + 输入形状提示 */}
          <div style={{
            padding: '8px',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderRadius: '4px',
            fontSize: '11px',
            color: '#93c5fd',
            marginBottom: '12px',
          }}>
            💡 当前模型：{selectedCard.name}，期望输入 [{selectedCard.inputShape.join(', ')}]，图片将自动 resize
          </div>

          {/* 选择图片 */}
          <div style={{ marginBottom: '12px' }}>
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
                marginBottom: '12px',
              }}
            >
              {loading ? '⏳ 推理中...' : '🚀 开始预测'}
            </button>
          )}

          {/* 推理失败 */}
          {result && !result.success && (
            <div style={{
              padding: '12px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid #ef4444',
              borderRadius: '6px',
              color: '#fca5a5',
              fontSize: '12px',
              wordBreak: 'break-word',
            }}>
              ❌ {result.error}
            </div>
          )}

          {/* 推理成功 */}
          {result && result.success && result.predictions && (
            <div>
              <div style={{
                padding: '16px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid #10b981',
                borderRadius: '6px',
                textAlign: 'center',
                marginBottom: '12px',
              }}>
                <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}>预测结果</div>
                {topLabel ? (
                  datasetKind === 'mnist' ? (
                    <>
                      <div style={{ color: '#10b981', fontSize: '44px', fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.1 }}>
                        {topLabel}
                      </div>
                      <div style={{ color: '#6ee7b7', fontSize: '13px', marginTop: '2px' }}>数字 {topLabel}</div>
                    </>
                  ) : (
                    <div style={{ color: '#10b981', fontSize: '28px', fontWeight: 700 }}>
                      {topLabel}
                    </div>
                  )
                ) : (
                  <div style={{ color: '#10b981', fontSize: '28px', fontWeight: 700, fontFamily: 'monospace' }}>
                    Class {result.topClass}
                  </div>
                )}
                <div style={{ color: '#6ee7b7', fontSize: '14px' }}>
                  置信度: {(result.topProbability! * 100).toFixed(1)}%
                </div>
              </div>

              <div style={{ backgroundColor: '#0f3460', borderRadius: '6px', padding: '10px' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600, marginBottom: '8px' }}>
                  Top-5 概率分布
                </div>
                {result.predictions.map((pred, i) => {
                  const label = getClassLabel(datasetKind, pred.class);
                  const displayLabel = label
                    ? (datasetKind === 'mnist' ? `数字 ${label}` : label)
                    : `Class ${pred.class}`;
                  return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ color: '#94a3b8', fontSize: '11px', minWidth: '50px' }}>
                      {displayLabel}
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
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
