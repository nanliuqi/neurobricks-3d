import { useState } from 'react';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useGPUStore } from '@/stores/useGPUStore';
import type { TrainConfig, OptimizerType } from '@/types/training';

const STORAGE_KEY = 'neurobricks_train_config';

interface SavedConfig {
  epochs: number;
  batchSize: number;
  lrExponent: number;
  optimizer: OptimizerType;
  weightDecay: number;
}

function loadSavedConfig(): Partial<SavedConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveConfig(config: SavedConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

// 模拟训练的 interval ID，存在模块级别以便暂停/恢复
let simulationIntervalId: ReturnType<typeof setInterval> | null = null;

/** 浏览器模式下的模拟训练（支持暂停/恢复） */
function simulateTraining(config: TrainConfig) {
  const totalEpochs = config.epochs;
  let epoch = 0;

  // 清除旧的 interval
  if (simulationIntervalId !== null) {
    clearInterval(simulationIntervalId);
    simulationIntervalId = null;
  }

  simulationIntervalId = setInterval(() => {
    const s = useTrainingStore.getState();
    if (!s.isTraining || epoch >= totalEpochs) {
      if (simulationIntervalId !== null) {
        clearInterval(simulationIntervalId);
        simulationIntervalId = null;
      }
      if (epoch >= totalEpochs) {
        const finalAcc = Math.min(0.95, 0.6 + Math.random() * 0.35);
        useTrainingStore.getState().finishTraining(finalAcc);
      }
      return;
    }
    // 暂停时不更新
    if (s.isPaused) {
      return;
    }
    epoch++;
    const loss = Math.max(0.01, 2.0 * Math.exp(-epoch * 0.3) + Math.random() * 0.1);
    const accuracy = Math.min(0.99, 0.3 + 0.6 * (1 - Math.exp(-epoch * 0.3)) + Math.random() * 0.05);
    useTrainingStore.getState().updateProgress({
      epoch,
      step: epoch * 10,
      loss,
      accuracy,
      timestamp: Date.now(),
    });
  }, 800);
}

/** 停止模拟训练 */
export function stopSimulation() {
  if (simulationIntervalId !== null) {
    clearInterval(simulationIntervalId);
    simulationIntervalId = null;
  }
}

/** 检查是否在模拟模式 */
export function isSimulating(): boolean {
  return simulationIntervalId !== null;
}

export default function QuickTrain() {
  const layers = useLayerStore(state => state.layers);
  const totalParams = useLayerStore(state => state.totalParams);
  const isTraining = useTrainingStore(state => state.isTraining);
  const startTraining = useTrainingStore(state => state.startTraining);
  const datasetInfo = useDatasetStore(state => state.datasetInfo);
  const datasetPath = useDatasetStore(state => state.datasetPath);
  const trainRatio = useDatasetStore(state => state.trainRatio);

  // 训练配置状态（从 localStorage 恢复）
  const saved = loadSavedConfig();

  const [epochs, setEpochs] = useState(saved.epochs ?? 5);
  const [batchSize, setBatchSize] = useState(saved.batchSize ?? 32);
  const [lrExponent, setLrExponent] = useState(saved.lrExponent ?? -3); // 10^-3 = 0.001
  const [optimizer, setOptimizer] = useState<OptimizerType>(saved.optimizer ?? 'adam');
  const [weightDecay, setWeightDecay] = useState(saved.weightDecay ?? 0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const learningRate = Math.pow(10, lrExponent);

  // 如果正在训练，返回 null（由 TrainProgress 接管）
  if (isTraining) {
    return null;
  }

  // 开始训练处理
  const handleStartTraining = async () => {
    if (layers.length === 0) {
      setHint('请先添加网络层');
      setTimeout(() => setHint(null), 3000);
      return;
    }

    if (!datasetInfo) {
      setHint('请先在数据集面板中选择数据集');
      setTimeout(() => setHint(null), 3000);
      return;
    }

    // 网络结构存在形状错误时拦截：Python 端 validate_model 对此类配置必然失败，
    // 直接报错比启动一个注定失败的训练进程更清晰
    if (useLayerStore.getState().hasShapeError) {
      setHint('❌ 网络结构存在形状错误，请查看错误面板修复后再训练');
      setTimeout(() => setHint(null), 5000);
      return;
    }

    // CSV 是一维表格数据：卷积/池化层需要二维图像输入，
    // 且 validate_model 的三维虚拟输入会通过校验、第一个真实批次才崩溃，错误晦涩，故提前拦截
    if (
      datasetInfo.type === 'csv' &&
      layers.some(l => l.type === 'Conv2D' || l.type === 'MaxPool2D' || l.type === 'AvgPool2D')
    ) {
      setHint('❌ CSV 是表格数据，不支持卷积/池化层，请改用全连接结构');
      setTimeout(() => setHint(null), 5000);
      return;
    }

    // 从 Input 层派生输入形状：Python 端 local_image 数据集据此 Resize / 灰度化，
    // 保证数据与模型输入一致（否则回退 3×224×224，与非 224 输入的网络必然不匹配）
    const inputLayer = layers.find(l => l.type === 'Input');
    const inputShape =
      inputLayer &&
      inputLayer.params.inChannels != null &&
      inputLayer.params.inputHeight != null &&
      inputLayer.params.inputWidth != null
        ? [inputLayer.params.inChannels, inputLayer.params.inputHeight, inputLayer.params.inputWidth]
        : undefined;

    // 构建训练配置
    const config: TrainConfig = {
      epochs,
      learningRate,
      batchSize,
      dataset: datasetInfo.type,
      device: 'cuda',
      layers: layers.map(layer => ({
        type: layer.type,
        params: layer.params,
      })),
      optimizer,
      weightDecay,
      dataPath: datasetPath || undefined,
      trainRatio,
      inputShape,
    };

    try {
      // 保存当前配置到 localStorage
      saveConfig({
        epochs,
        batchSize,
        lrExponent,
        optimizer,
        weightDecay,
      });

      // 更新 Store 状态
      startTraining(config);

      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        await invoke('start_training', { config });
        console.log('[NeuroBricks] ✅ 真实训练已启动（Python sidecar）');
      } catch (e) {
        // Tauri 后端不可用时浏览器模拟训练
        console.warn('[NeuroBricks] ⚠️ Tauri 后端不可用，使用模拟训练:', e);
        simulateTraining(config);
      }
    } catch (error) {
      console.error('Failed to start training:', error);
      setHint('启动训练失败：' + (error as Error).message);
      setTimeout(() => setHint(null), 5000);
    }
  };

  // 粗略预估每 epoch 时间
  const gpus = useGPUStore(state => state.devices);
  const hasDiscreteGPU = gpus.some(g => g.category === 'discrete' && g.available);
  const throughput = hasDiscreteGPU ? 50000 : 5000;
  const estimatedSecondsPerEpoch = totalParams > 0 ? Math.ceil(totalParams * batchSize / throughput) : 0;

  return (
    <div style={{ position: 'relative' }}>
      {/* 高级设置展开面板 */}
      {showAdvanced && (
        <div
          style={{
            position: 'absolute',
            bottom: '80px',
            left: 0,
            right: 0,
            backgroundColor: '#1a2744',
            borderTop: '1px solid #0f3460',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap',
            zIndex: 10,
          }}
        >
          {/* 优化器选择 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ color: '#94a3b8', fontSize: '10px' }}>优化器</label>
            <select
              value={optimizer}
              onChange={(e) => setOptimizer(e.target.value as OptimizerType)}
              style={{
                padding: '4px 8px',
                backgroundColor: '#0f3460',
                border: '1px solid #1a3a5c',
                borderRadius: '4px',
                color: 'white',
                fontSize: '11px',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="adam">Adam</option>
              <option value="adamw">AdamW</option>
              <option value="sgd">SGD</option>
            </select>
          </div>

          {/* Weight Decay */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ color: '#94a3b8', fontSize: '10px' }}>Weight Decay</label>
            <input
              type="number"
              value={weightDecay}
              onChange={(e) => setWeightDecay(Number(e.target.value))}
              step={0.0001}
              min={0}
              max={0.1}
              style={{
                width: '80px',
                padding: '4px 8px',
                backgroundColor: '#0f3460',
                border: '1px solid #1a3a5c',
                borderRadius: '4px',
                color: 'white',
                fontSize: '11px',
              }}
            />
          </div>

          {/* 学习率对数滑块 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '160px' }}>
            <label style={{ color: '#94a3b8', fontSize: '10px' }}>
              学习率：{learningRate.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}
            </label>
            <input
              type="range"
              min={-4}
              max={-1}
              step={0.1}
              value={lrExponent}
              onChange={(e) => setLrExponent(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>

          {/* 参数量 + 预估 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginLeft: 'auto' }}>
            <span style={{ color: '#94a3b8', fontSize: '10px' }}>
              参数量：<span style={{ color: '#6ee7b7' }}>{totalParams.toLocaleString()}</span>
            </span>
            {estimatedSecondsPerEpoch > 0 && (
              <span style={{ color: '#64748b', fontSize: '10px' }}>
                ~{estimatedSecondsPerEpoch}秒/epoch（粗略估计）
              </span>
            )}
          </div>
        </div>
      )}

      {/* 底部训练栏 */}
      <div
        style={{
          height: '80px',
          backgroundColor: '#16213e',
          borderTop: '1px solid #0f3460',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: '12px',
        }}
      >
        {/* 数据集状态 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ color: '#94a3b8', fontSize: '11px' }}>数据集</label>
          <div style={{
            padding: '6px 8px',
            backgroundColor: '#0f3460',
            border: '1px solid #1a3a5c',
            borderRadius: '4px',
            color: datasetInfo ? '#6ee7b7' : '#ef4444',
            fontSize: '12px',
            whiteSpace: 'nowrap',
          }}>
            {datasetInfo ? datasetInfo.name : '未选择'}
          </div>
        </div>

        {/* Epochs 输入 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ color: '#94a3b8', fontSize: '11px' }}>Epochs</label>
          <input
            type="number"
            value={epochs}
            onChange={(e) => setEpochs(Number(e.target.value))}
            min={1}
            max={50}
            style={{
              width: '70px',
              padding: '6px 8px',
              backgroundColor: '#0f3460',
              border: '1px solid #1a3a5c',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
            }}
          />
        </div>

        {/* Batch Size 输入 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ color: '#94a3b8', fontSize: '11px' }}>Batch</label>
          <input
            type="number"
            value={batchSize}
            onChange={(e) => setBatchSize(Number(e.target.value))}
            min={1}
            max={512}
            step={16}
            style={{
              width: '70px',
              padding: '6px 8px',
              backgroundColor: '#0f3460',
              border: '1px solid #1a3a5c',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
            }}
          />
        </div>

        {/* 高级设置按钮 */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            padding: '6px 12px',
            backgroundColor: showAdvanced ? '#1e3a8a' : '#0f3460',
            border: '1px solid #1a3a5c',
            borderRadius: '4px',
            color: showAdvanced ? '#93c5fd' : '#94a3b8',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          ⚙ 高级
        </button>

        {hint && (
          <span style={{
            color: '#fcd34d',
            fontSize: '12px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}>
            {hint}
          </span>
        )}

        {/* 开始训练按钮 */}
        <button
          onClick={handleStartTraining}
          disabled={layers.length === 0 || !datasetInfo}
          style={{
            marginLeft: 'auto',
            padding: '10px 24px',
            backgroundColor: layers.length === 0 || !datasetInfo ? '#475569' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: layers.length === 0 || !datasetInfo ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: 600,
            transition: 'background-color 0.2s',
          }}
        >
          🚀 开始训练
        </button>
      </div>
    </div>
  );
}
