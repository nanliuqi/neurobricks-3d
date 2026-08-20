import { useEffect, useState } from 'react';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { writeChartMetricsNow } from '@/utils/chartSync';

/**
 * 训练完成结果汇总模态卡片
 * 训练完成后在 3D 场景中央弹出，展示完整结果
 */
export default function TrainResultModal() {
  const status = useTrainingStore(state => state.status);
  const finalAccuracy = useTrainingStore(state => state.finalAccuracy);
  const currentLoss = useTrainingStore(state => state.currentLoss);
  const totalEpochs = useTrainingStore(state => state.totalEpochs);
  const metrics = useTrainingStore(state => state.metrics);
  const history = useTrainingStore(state => state.history);
  const resetTraining = useTrainingStore(state => state.resetTraining);
  const totalParams = useLayerStore(state => state.totalParams);
  const layers = useLayerStore(state => state.layers);

  const [visible, setVisible] = useState(false);
  const [displayedDuration, setDisplayedDuration] = useState(0);

  // 训练完成时显示模态框
  useEffect(() => {
    if (status === 'done' && finalAccuracy !== null) {
      // 从历史记录中获取训练时长
      const latestRecord = history[0];
      let duration = latestRecord?.duration ?? 0;
      // 回退：历史记录时长无效时，从 metrics 时间戳计算
      if ((!duration || !Number.isFinite(duration)) && metrics.length > 0) {
        duration = metrics[metrics.length - 1].timestamp - metrics[0].timestamp;
      }
      setDisplayedDuration(duration > 0 ? duration : 0);
      setVisible(true);
    }
  }, [status, finalAccuracy, history, metrics]);

  if (!visible || status !== 'done') return null;

  // 计算统计信息（用 null 检查而非 falsy 检查，避免把 0 当作“无数据”）
  const accuracyPercent = finalAccuracy !== null ? (finalAccuracy * 100).toFixed(1) : '0.0';
  const finalLoss = currentLoss !== null && currentLoss !== undefined ? currentLoss.toFixed(4) : 'N/A';
  const durationSec = Math.round(displayedDuration / 1000);
  const durationStr = displayedDuration <= 0
    ? '<1秒'
    : durationSec >= 60
      ? `${Math.floor(durationSec / 60)}分${durationSec % 60}秒`
      : `${durationSec}秒`;

  // 网络结构摘要
  const networkSummary = layers.map(l => l.type).slice(0, 6).join(' → ');
  const layerCount = layers.length;

  // 最佳 epoch（从 metrics 中找最高准确率）
  let bestEpoch = 1;
  let bestAcc = 0;
  metrics.forEach(m => {
    if (m.accuracy > bestAcc) {
      bestAcc = m.accuracy;
      bestEpoch = m.epoch;
    }
  });

  const handleClose = () => {
    setVisible(false);
    resetTraining();
  };

  const handleViewChart = async () => {
    // 关闭结果卡片并打开独立曲线窗口；先强制写入数据避免窗口空白
    setVisible(false);
    writeChartMetricsNow();
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('open_chart_window');
    } catch (e) {
      console.error('Failed to open chart window:', e);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 100,
        backgroundColor: '#1a2744',
        border: '1px solid #1e40af',
        borderRadius: '12px',
        padding: '24px 32px',
        minWidth: '400px',
        maxWidth: '500px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* 标题 */}
      <div style={{
        textAlign: 'center',
        marginBottom: '20px',
        paddingBottom: '12px',
        borderBottom: '1px solid #1e3a5f',
      }}>
        <div style={{ fontSize: '24px', marginBottom: '4px' }}>🎉</div>
        <div style={{ color: '#10b981', fontSize: '16px', fontWeight: 700 }}>
          训练完成
        </div>
      </div>

      {/* 核心指标 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        marginBottom: '16px',
      }}>
        <div style={{
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderRadius: '8px',
          padding: '12px',
          textAlign: 'center',
        }}>
          <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}>最终准确率</div>
          <div style={{ color: '#10b981', fontSize: '24px', fontWeight: 700, fontFamily: 'monospace' }}>
            {accuracyPercent}%
          </div>
        </div>
        <div style={{
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderRadius: '8px',
          padding: '12px',
          textAlign: 'center',
        }}>
          <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}>最终 Loss</div>
          <div style={{ color: '#3b82f6', fontSize: '24px', fontWeight: 700, fontFamily: 'monospace' }}>
            {finalLoss}
          </div>
        </div>
      </div>

      {/* 详细信息 */}
      <div style={{
        backgroundColor: 'rgba(15, 52, 96, 0.3)',
        borderRadius: '8px',
        padding: '12px',
        marginBottom: '16px',
        fontSize: '12px',
        lineHeight: '1.8',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>训练时长</span>
          <span style={{ color: 'white' }}>{durationStr}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>训练轮数</span>
          <span style={{ color: 'white' }}>{totalEpochs} epochs</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>网络层数</span>
          <span style={{ color: 'white' }}>{layerCount} 层</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>参数总量</span>
          <span style={{ color: 'white', fontFamily: 'monospace' }}>{totalParams.toLocaleString()}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>最佳 Epoch</span>
          <span style={{ color: '#f59e0b' }}>Epoch {bestEpoch} ({(bestAcc * 100).toFixed(1)}%)</span>
        </div>
      </div>

      {/* 网络结构摘要 */}
      <div style={{
        fontSize: '11px',
        color: '#64748b',
        fontFamily: 'monospace',
        textAlign: 'center',
        marginBottom: '16px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {networkSummary}
      </div>

      {/* 按钮区域 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleViewChart}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: '#1e40af',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          📈 查看曲线
        </button>
        <button
          onClick={handleClose}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: '#475569',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          ✅ 完成
        </button>
      </div>
    </div>
  );
}
