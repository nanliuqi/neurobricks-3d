import { useState, useRef, useEffect } from 'react';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { stopSimulation, isSimulating } from './QuickTrain';
import LossChart from './LossChart';
import { writeChartMetricsNow } from '@/utils/chartSync';

export default function TrainMonitor() {
  const isTraining = useTrainingStore(state => state.isTraining);
  const isPaused = useTrainingStore(state => state.isPaused);
  const error = useTrainingStore(state => state.error);
  const logs = useTrainingStore(state => state.logs);
  const history = useTrainingStore(state => state.history);
  const [gradientMsg, setGradientMsg] = useState<string | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // 日志自动滚动到最新
  useEffect(() => {
    if (logsExpanded && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, logsExpanded]);

  const handleResume = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('step_training');
    } catch {
      // Tauri 不可用（模拟模式）
    }
    useTrainingStore.getState().resumeTraining();
  };

  const handlePause = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('pause_training');
    } catch {
      // Tauri 不可用（模拟模式）
    }
    useTrainingStore.getState().pauseTraining();
  };

  const handleStop = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('stop_training');
    } catch {
      // Tauri 不可用
    }
    stopSimulation();
    useTrainingStore.getState().resetTraining();
  };

  const handleReset = () => {
    stopSimulation();
    useTrainingStore.getState().resetTraining();
  };

  const handleGradientDiagnosis = async () => {
    setGradientMsg('梯度诊断功能尚未实现，将在后续版本中支持');
    setTimeout(() => setGradientMsg(null), 3000);
  };

  // 打开独立曲线窗口（独立系统窗口，可移出应用/缩放/关闭）
  const handleOpenChart = async () => {
    // 先强制写入最新曲线数据，确保窗口首次轮询即可读到并立即绘制（避免空白竞态）
    writeChartMetricsNow();
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('open_chart_window');
    } catch (e) {
      console.error('Failed to open chart window:', e);
    }
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 面板标题 */}
      <div style={{
        color: 'white',
        fontSize: '14px',
        fontWeight: 600,
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '1px solid #0f3460',
      }}>
        训练监控
      </div>

      {/* 训练错误提示 — 最醒目 */}
      {error && (
        <div style={{
          padding: '12px',
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid #ef4444',
          borderRadius: '6px',
          marginBottom: '12px',
        }}>
          <div style={{
            color: '#fca5a5',
            fontSize: '13px',
            fontWeight: 700,
            marginBottom: '6px',
          }}>
            ❌ 训练出错
          </div>
          <div style={{
            color: '#fecaca',
            fontSize: '11px',
            lineHeight: '1.5',
            wordBreak: 'break-word',
          }}>
            {error}
          </div>
          <button
            onClick={handleReset}
            style={{
              marginTop: '8px',
              padding: '6px 16px',
              backgroundColor: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            🔄 重置
          </button>
        </div>
      )}

      {/* 未训练提示 */}
      {!isTraining && !error && (
        <div style={{
          padding: '16px',
          backgroundColor: 'rgba(100, 116, 139, 0.1)',
          border: '1px solid rgba(100, 116, 139, 0.3)',
          borderRadius: '6px',
          color: '#94a3b8',
          fontSize: '13px',
          textAlign: 'center',
          marginBottom: '12px',
        }}>
          当前没有训练任务<br />
          <span style={{ fontSize: '11px' }}>
            请先在底部点击"🚀 开始训练"
          </span>
        </div>
      )}

      {/* 模拟训练提示 */}
      {isTraining && isSimulating() && (
        <div style={{
          padding: '8px 10px',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#f59e0b',
          marginBottom: '8px',
          textAlign: 'center',
        }}>
          ⚠️ 模拟训练模式（Python 进程未启动）
        </div>
      )}

      {/* Loss/Accuracy 曲线图 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600 }}>训练曲线</span>
        <button
          onClick={handleOpenChart}
          title="在独立窗口中查看训练曲线（可移出应用/缩放）"
          style={{
            padding: '2px 8px',
            backgroundColor: '#1a3a5c',
            color: '#93c5fd',
            border: '1px solid #2a4a6c',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '10px',
          }}
        >
          ⧉ 放大查看
        </button>
      </div>
      <div style={{ flex: 1, minHeight: '200px', marginBottom: '12px' }}>
        <LossChart />
      </div>

      {/* 可折叠训练日志 */}
      <div style={{ marginBottom: '12px' }}>
        <button
          onClick={() => setLogsExpanded(!logsExpanded)}
          style={{
            width: '100%',
            padding: '6px 10px',
            backgroundColor: 'rgba(30, 58, 138, 0.3)',
            border: '1px solid #1e3a8a',
            borderRadius: '4px',
            color: '#93c5fd',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>📋 训练日志 ({logs.length})</span>
          <span>{logsExpanded ? '▲' : '▼'}</span>
        </button>
        {logsExpanded && (
          <div
            ref={logContainerRef}
            style={{
              maxHeight: '150px',
              overflow: 'auto',
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              borderRadius: '0 0 4px 4px',
              padding: '6px 8px',
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: '#475569', fontSize: '11px', fontFamily: 'monospace' }}>
                暂无日志
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i} style={{ fontSize: '11px', fontFamily: 'monospace', marginBottom: '2px', lineHeight: '1.4' }}>
                  <span style={{ color: '#475569' }}>
                    {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                  </span>
                  {' '}
                  <span style={{ color: log.level === 'error' ? '#fca5a5' : log.level === 'warn' ? '#fcd34d' : '#cbd5e1' }}>
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 暂停状态提示 */}
      {isTraining && isPaused && (
        <div style={{
          color: '#f59e0b',
          fontSize: '12px',
          fontWeight: 600,
          textAlign: 'center',
          padding: '4px 0',
          marginBottom: '8px',
        }}>
          ⏸ 训练已暂停
        </div>
      )}

      {/* 训练控制按钮：恢复 / 暂停 / 停止 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <button
          onClick={handleResume}
          disabled={!isTraining || !isPaused}
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: (!isTraining || !isPaused) ? '#475569' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: (!isTraining || !isPaused) ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          ▶ 恢复
        </button>

        <button
          onClick={handlePause}
          disabled={!isTraining || isPaused}
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: (!isTraining || isPaused) ? '#475569' : '#f59e0b',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: (!isTraining || isPaused) ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          ⏸ 暂停
        </button>

        <button
          onClick={handleStop}
          disabled={!isTraining}
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: !isTraining ? '#475569' : '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: !isTraining ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          ⏹ 停止
        </button>
      </div>

      {/* 梯度诊断按钮 */}
      <button
        onClick={handleGradientDiagnosis}
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: '#8b5cf6',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 600,
        }}
      >
        🔍 梯度诊断
      </button>

      {/* 梯度诊断提示 */}
      {gradientMsg && (
        <div style={{
          marginTop: '8px',
          padding: '8px 12px',
          backgroundColor: 'rgba(139, 92, 246, 0.15)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: '4px',
          color: '#c4b5fd',
          fontSize: '12px',
          textAlign: 'center',
        }}>
          {gradientMsg}
        </div>
      )}

      {/* 训练历史记录 */}
      {history.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <button
            onClick={() => setHistoryExpanded(!historyExpanded)}
            style={{
              width: '100%',
              padding: '6px 10px',
              backgroundColor: 'rgba(30, 58, 138, 0.3)',
              border: '1px solid #1e3a8a',
              borderRadius: '4px',
              color: '#93c5fd',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>📊 训练历史 ({history.length})</span>
            <span>{historyExpanded ? '▲' : '▼'}</span>
          </button>
          {historyExpanded && (
            <div style={{
              maxHeight: '200px',
              overflow: 'auto',
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              borderRadius: '0 0 4px 4px',
              padding: '6px 8px',
            }}>
              {history.map((record) => (
                <div
                  key={record.id}
                  style={{
                    padding: '6px 8px',
                    marginBottom: '6px',
                    backgroundColor: 'rgba(30, 58, 138, 0.2)',
                    borderRadius: '4px',
                    border: '1px solid rgba(30, 58, 138, 0.4)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                    <span style={{ color: '#6ee7b7', fontSize: '12px', fontWeight: 700 }}>
                      {(record.finalAccuracy * 100).toFixed(1)}%
                    </span>
                    <span style={{ color: '#64748b', fontSize: '10px' }}>
                      {record.totalParams.toLocaleString()} params
                    </span>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '10px', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {record.networkSummary}
                  </div>
                  <div style={{ color: '#475569', fontSize: '10px' }}>
                    {record.epochs} epochs · {Math.round(record.duration / 1000)}秒
                    {record.dataset && ` · ${record.dataset}`}
                    {' · '}
                    {new Date(record.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
