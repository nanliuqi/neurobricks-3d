import { useState, useEffect } from 'react';
import { useTrainingStore } from '../../stores/useTrainingStore';

export default function TrainProgress() {
  const currentEpoch = useTrainingStore(state => state.currentEpoch);
  const totalEpochs = useTrainingStore(state => state.totalEpochs);
  const currentLoss = useTrainingStore(state => state.currentLoss);
  const currentAccuracy = useTrainingStore(state => state.currentAccuracy);
  const isTraining = useTrainingStore(state => state.isTraining);
  const finalAccuracy = useTrainingStore(state => state.finalAccuracy);
  const error = useTrainingStore(state => state.error);
  const trainStartTime = useTrainingStore(state => state.trainStartTime);
  const resetTraining = useTrainingStore(state => state.resetTraining);

  // 时间追踪状态
  const [now, setNow] = useState(Date.now());

  // 训练中每秒刷新时间
  useEffect(() => {
    if (!isTraining) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isTraining]);

  // 计算进度百分比
  const progressPercent = totalEpochs > 0 ? (currentEpoch / totalEpochs) * 100 : 0;

  // 计算已用时间和预计剩余时间
  const elapsed = trainStartTime ? now - trainStartTime : 0;
  const estimatedTotal = progressPercent > 5 ? elapsed / (progressPercent / 100) : 0;
  const remaining = estimatedTotal > 0 ? estimatedTotal - elapsed : 0;

  // 格式化时间
  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}分${secs}秒`;
  };

  // 如果不在训练中且无最终结果且无错误，返回 null
  if (!isTraining && finalAccuracy === null && !error) {
    return null;
  }

  // 停止训练处理
  const handleStopTraining = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('stop_training');
    } catch {
      // Tauri 不可用，直接重置
    }
    resetTraining();
  };

  // 重置训练状态
  const handleReset = () => {
    resetTraining();
  };

  return (
    <div
      style={{
        height: '80px',
        backgroundColor: '#16213e',
        borderTop: '1px solid #0f3460',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: '16px',
      }}
    >
      {/* 错误信息 */}
      {error && (
        <div
          style={{
            flex: 1,
            backgroundColor: '#7f1d1d',
            color: '#fecaca',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            border: '1px solid #ef4444',
          }}
        >
          ❌ {error}
        </div>
      )}

      {/* 训练中状态 */}
      {isTraining && !error && (
        <>
          {/* 进度条容器 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* 进度文本 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#94a3b8' }}>
                Epoch {currentEpoch} / {totalEpochs}
              </span>
              <span style={{ color: 'white', fontWeight: 600 }}>
                {progressPercent.toFixed(1)}%
              </span>
            </div>

            {/* 进度条 */}
            <div
              style={{
                height: '8px',
                backgroundColor: '#0f3460',
                borderRadius: '4px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  backgroundColor: '#3b82f6',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            {/* 指标显示 */}
            <div style={{ display: 'flex', gap: '16px', fontSize: '11px' }}>
              <div>
                <span style={{ color: '#94a3b8' }}>Loss: </span>
                <span style={{ color: 'white', fontFamily: 'monospace' }}>
                  {currentLoss !== null ? currentLoss.toFixed(4) : '-'}
                </span>
              </div>
              <div>
                <span style={{ color: '#94a3b8' }}>Acc: </span>
                <span style={{ color: '#10b981', fontFamily: 'monospace' }}>
                  {currentAccuracy !== null ? (currentAccuracy * 100).toFixed(1) + '%' : '-'}
                </span>
              </div>
            </div>

            {/* 时间信息 */}
            {trainStartTime && (
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', marginTop: '2px' }}>
                <div>
                  <span style={{ color: '#94a3b8' }}>已用：</span>
                  <span style={{ color: 'white' }}>{formatTime(elapsed)}</span>
                </div>
                {progressPercent > 5 && remaining > 0 && (
                  <div>
                    <span style={{ color: '#94a3b8' }}>预计剩余：</span>
                    <span style={{ color: '#f59e0b' }}>{formatTime(remaining)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 停止按钮 */}
          <button
            onClick={handleStopTraining}
            style={{
              padding: '10px 20px',
              backgroundColor: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#dc2626';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ef4444';
            }}
          >
            ⏹ 停止训练
          </button>
        </>
      )}

      {/* 训练完成状态 */}
      {!isTraining && finalAccuracy !== null && !error && (
        <>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#10b981', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
              ✅ 训练完成！
            </div>
            <div style={{ color: 'white', fontSize: '13px' }}>
              最终准确率：<span style={{ fontWeight: 600, fontFamily: 'monospace' }}>
                {(finalAccuracy * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* 重置按钮 */}
          <button
            onClick={handleReset}
            style={{
              padding: '10px 20px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
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
            🔄 重置
          </button>
        </>
      )}
    </div>
  );
}
