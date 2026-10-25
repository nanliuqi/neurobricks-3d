import { useEffect, useMemo, useRef, useState } from 'react';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useGPUStore } from '@/stores/useGPUStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import {
  TRAIN_CONFIG_STORAGE_KEY,
  type TrainConfig,
  type OptimizerType,
  type LrSchedulerType,
} from '@/types/training';
import type { RightPanelId } from '@/types/workspace';
import { startTrainingRun } from '@/trainingRuntime';
import {
  evaluateTrainingPreflight,
  type TrainingPreflightInput,
  type TrainingPreflightResult,
  type TrainingPreflightTarget,
  type TrainFieldId,
} from '@/utils/trainingPreflight';
import {
  isNativeDesktopRuntime,
  queryNativeTrainingEnvironment,
  selectedTrainingDevice,
} from '@/utils/trainingDevice';
import {
  estimateEpochSecondsPerEpoch,
  projectTotalParamCount,
} from '@/utils/parameterCountPresentation';
import TrainingPreflightPanel, { type TrainingPreflightPanelHandle } from './TrainingPreflightPanel';

interface SavedConfig {
  epochs: number;
  batchSize: number;
  lrExponent: number;
  optimizer: OptimizerType;
  weightDecay: number;
  momentum: number;
  lrScheduler: LrSchedulerType;
  seed: number;
  valSplit: number;
}

function loadSavedConfig(): Partial<SavedConfig> {
  try {
    const raw = localStorage.getItem(TRAIN_CONFIG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<SavedConfig>;
    // 对抗性校验：localStorage 可能被手改或存入旧版/脏数据，逐字段把关
    const clampNum = (v: unknown, min: number, max: number): number | undefined => {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return undefined;
      return Math.min(max, Math.max(min, n));
    };
    const lrExp = clampNum(parsed.lrExponent, -6, 0);
    const wd = clampNum(parsed.weightDecay, 0, 1);
    const mom = clampNum(parsed.momentum, 0, 0.99);
    const seedRaw = clampNum(parsed.seed, 0, Number.MAX_SAFE_INTEGER);
    const vs = clampNum(parsed.valSplit, 0.05, 0.5);
    const savedEpochs = clampNum(parsed.epochs, 1, 50);
    const savedBatchSize = clampNum(parsed.batchSize, 1, 512);
    return {
      ...(savedEpochs !== undefined ? { epochs: Math.floor(savedEpochs) } : {}),
      ...(savedBatchSize !== undefined ? { batchSize: Math.floor(savedBatchSize) } : {}),
      ...(lrExp !== undefined ? { lrExponent: lrExp } : {}),
      ...(parsed.optimizer === 'adam' || parsed.optimizer === 'adamw' || parsed.optimizer === 'sgd' ? { optimizer: parsed.optimizer } : {}),
      ...(wd !== undefined ? { weightDecay: wd } : {}),
      ...(mom !== undefined ? { momentum: mom } : {}),
      ...(parsed.lrScheduler === 'none' || parsed.lrScheduler === 'multistep' || parsed.lrScheduler === 'cosine' ? { lrScheduler: parsed.lrScheduler } : {}),
      ...(seedRaw !== undefined ? { seed: Math.floor(seedRaw) } : {}),
      ...(vs !== undefined ? { valSplit: vs } : {}),
    };
  } catch {
    return {};
  }
}

function saveConfig(config: SavedConfig) {
  try {
    localStorage.setItem(TRAIN_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

interface QuickTrainProps {
  /** 复用模块 02 工作区唯一面板导航回调（不新建第二套面板状态）。 */
  onNavigatePanel?: (panelId: RightPanelId) => void;
}

export default function QuickTrain({ onNavigatePanel }: QuickTrainProps) {
  const layers = useLayerStore(state => state.layers);
  const totalParams = useLayerStore(state => state.totalParams);
  const validationResult = useLayerStore(state => state.validationResult);
  const isTraining = useTrainingStore(state => state.isTraining);
  const trainingError = useTrainingStore(state => state.error);
  const trainingErrorKind = useTrainingStore(state => state.errorKind);
  const datasetInfo = useDatasetStore(state => state.datasetInfo);
  const datasetPath = useDatasetStore(state => state.datasetPath);
  const trainRatio = useDatasetStore(state => state.trainRatio);
  const splitStrategy = useDatasetStore(state => state.splitStrategy);
  const groupField = useDatasetStore(state => state.groupField);
  const timeField = useDatasetStore(state => state.timeField);
  const targetField = useDatasetStore(state => state.targetField);
  const devices = useGPUStore(state => state.devices);
  const selectedDeviceName = useGPUStore(state => state.selectedDevice);
  const runtimeInfo = useGPUStore(state => state.runtimeInfo);
  const runtimeChecking = useGPUStore(state => state.runtimeChecking);
  const runtimeError = useGPUStore(state => state.runtimeError);
  const auditPersistence = useExperimentStore(state => state.auditPersistence);
  const setDevices = useGPUStore(state => state.setDevices);
  const selectDevice = useGPUStore(state => state.selectDevice);
  const setRuntimeChecking = useGPUStore(state => state.setRuntimeChecking);
  const setRuntimeInfo = useGPUStore(state => state.setRuntimeInfo);
  const setRuntimeError = useGPUStore(state => state.setRuntimeError);

  useEffect(() => {
    if (!isNativeDesktopRuntime() || runtimeInfo || runtimeChecking) return;
    let cancelled = false;
    setRuntimeChecking(true);
    void queryNativeTrainingEnvironment()
      .then(result => {
        if (cancelled) return;
        setDevices(result.devices);
        setRuntimeInfo(result.runtimeInfo);
        const cudaDevice = result.runtimeInfo.cudaAvailable
          ? result.devices.find(device => device.category === 'discrete' && /nvidia|geforce|rtx|gtx/i.test(device.deviceName))
          : undefined;
        const cpuDevice = result.devices.find(device => device.category === 'cpu' || device.deviceName.startsWith('CPU'));
        selectDevice((cudaDevice ?? cpuDevice ?? result.devices[0])?.deviceName ?? 'cpu');
      })
      .catch(error => {
        if (!cancelled) setRuntimeError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [
    selectDevice,
    setDevices,
    setRuntimeChecking,
    setRuntimeError,
    setRuntimeInfo,
  ]);

  // 训练配置状态（从 localStorage 恢复）
  const saved = loadSavedConfig();

  const [epochs, setEpochs] = useState(saved.epochs ?? 5);
  const [batchSize, setBatchSize] = useState(saved.batchSize ?? 32);
  const [lrExponent, setLrExponent] = useState(saved.lrExponent ?? -3); // 10^-3 = 0.001
  const [optimizer, setOptimizer] = useState<OptimizerType>(saved.optimizer ?? 'adam');
  const [weightDecay, setWeightDecay] = useState(saved.weightDecay ?? 0);
  // SGD 动量（仅 optimizer=sgd 时显示与生效，后端默认 0.9）
  const [momentum, setMomentum] = useState(saved.momentum ?? 0.9);
  // 学习率调度器：none / multistep / cosine（后端默认 none）
  const [lrScheduler, setLrScheduler] = useState<LrSchedulerType>(saved.lrScheduler ?? 'none');
  // 随机种子：固定后同配置同结果（后端默认 42）
  const [seed, setSeed] = useState(saved.seed ?? 42);
  // 默认从开发集切出验证集，避免每次调参都直接窥视测试集。
  const [valSplit, setValSplit] = useState(saved.valSplit ?? 0.2);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // 高级参数定位：先展开高级区，下一次提交后再聚焦真实字段（不用 setTimeout 猜测 DOM）
  const [pendingField, setPendingField] = useState<TrainFieldId | null>(null);

  const preflightPanelRef = useRef<TrainingPreflightPanelHandle>(null);
  // 同步重入锁：快速双击 / prepareTrainingAttempt 异步未返回期间的第二次点击都必须被阻断；
  // 不能只依赖 useTrainingStore.isTraining（它在异步准备成功后才进入活动态）。
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const epochsRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLInputElement>(null);
  const lrRef = useRef<HTMLInputElement>(null);
  const weightDecayRef = useRef<HTMLInputElement>(null);
  const valSplitRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const learningRate = Math.pow(10, lrExponent);

  // 统一 Preflight：实时预览与点击启动共用同一纯函数；输入为值快照，不含 store/组件。
  const preflightSnapshot = useMemo<TrainingPreflightInput>(() => ({
    layers,
    validationErrors: validationResult.errors,
    validationWarnings: validationResult.warnings,
    dataset: datasetInfo,
    splitStrategy,
    groupField,
    timeField,
    targetField,
    epochs,
    batchSize,
    learningRate,
    weightDecay,
    valSplit,
    isNativeRuntime: isNativeDesktopRuntime(),
    runtimeChecking,
    runtimeError,
    runtimeInfo,
    auditPersistence,
  }), [
    layers, validationResult, datasetInfo, splitStrategy, groupField, timeField, targetField,
    epochs, batchSize, learningRate, weightDecay, valSplit,
    runtimeChecking, runtimeError, runtimeInfo, auditPersistence,
  ]);
  const preflight = useMemo<TrainingPreflightResult>(
    () => evaluateTrainingPreflight(preflightSnapshot),
    [preflightSnapshot],
  );

  // 高级区展开提交后聚焦对应字段（受控定位请求，不猜测 DOM 时机）。
  // 必须位于早退 return 之前，保证 Hooks 调用顺序稳定。
  useEffect(() => {
    if (!pendingField || !showAdvanced) return;
    const target = pendingField === 'learningRate'
      ? lrRef
      : pendingField === 'weightDecay'
        ? weightDecayRef
        : pendingField === 'valSplit'
          ? valSplitRef
          : null;
    target?.current?.focus();
    setPendingField(null);
  }, [pendingField, showAdvanced]);

  // 如果正在训练，返回 null（由 TrainProgress 接管）
  if (isTraining) {
    return null;
  }

  // 启动阶段最终检查的真实错误（与训练监控同源：均来自 useTrainingStore.error）；
  // 历史错误不影响实时 canStart；标题明确写“上一次”，避免误认为当前实时检查结果。
  // 用户重新启动成功后，训练状态机会自然清除旧错误。
  const authoritativeError = trainingErrorKind === 'preflight' && trainingError
    ? { title: '上一次启动阶段最终检查未通过', detail: trainingError }
    : trainingErrorKind === 'startup' && trainingError
      ? { title: '上一次训练进程启动失败', detail: trainingError }
      : null;

  // 定位训练参数字段：可见字段直接聚焦；高级字段先展开再聚焦。
  const focusField = (fieldId: TrainFieldId) => {
    if (fieldId === 'epochs') {
      epochsRef.current?.focus();
      return;
    }
    if (fieldId === 'batchSize') {
      batchRef.current?.focus();
      return;
    }
    setPendingField(fieldId);
    setShowAdvanced(true);
  };

  // 结构化导航：只导航/聚焦/选择层，绝不修改任何配置；失败时保持稳定不抛异常。
  const handleNavigateTarget = (target: TrainingPreflightTarget) => {
    try {
      if (target.kind === 'panel') {
        onNavigatePanel?.(target.panelId);
      } else if (target.kind === 'monitor') {
        onNavigatePanel?.('trainMonitor');
      } else if (target.kind === 'layer') {
        // 调用现有选择层 action，不改层参数；MainLayout 会自动切换到参数面板。
        useLayerStore.getState().setSelectedId(target.layerId);
        onNavigatePanel?.('param');
      } else if (target.kind === 'field') {
        focusField(target.fieldId);
      }
    } catch (error) {
      console.warn('Preflight navigation failed:', error);
    }
  };

  // 开始训练处理：统一检查 → 用检查派生结果构建配置 → startTrainingRun →
  // prepareTrainingAttempt 做最终权威检查；失败时展示同源真实错误。
  const handleStartTraining = async () => {
    // 同步重入锁：快速双击只启动一次；异步准备期间 isTraining 尚为 false，必须用组件级锁兼底。
    if (startingRef.current || isTraining || preparing) return;

    // 点击时以同一纯函数重新评估最新快照（与实时预览同源同规则）
    const result = evaluateTrainingPreflight(preflightSnapshot);
    if (!result.canStart) {
      // 被阻断：不启动训练，展开检查面板并聚焦首个阻断项；
      // 不把实时阻断写入训练 store，避免历史错误污染后续重试。
      preflightPanelRef.current?.expandAndFocusFirst();
      return;
    }
    if (!datasetInfo) return; // data_missing 已阻断；双保险，不进入启动路径

    startingRef.current = true;
    setPreparing(true);
    try {
      // 保存当前配置到 localStorage（key 与脏数据校验均不变）
      saveConfig({
        epochs,
        batchSize,
        lrExponent,
        optimizer,
        weightDecay,
        momentum,
        lrScheduler,
        seed,
        valSplit,
      });

      // 构建训练配置：特征列/输入形状复用检查的 derived 结果，不得另行重算；
      // 默认超参、localStorage key、selectedTrainingDevice 规则、modelId 每次新建语义均不变。
      const config: TrainConfig = {
        epochs,
        learningRate,
        batchSize,
        dataset: datasetInfo.type,
        device: selectedTrainingDevice(devices, selectedDeviceName, runtimeInfo),
        layers: layers.map(layer => ({
          id: layer.id,
          type: layer.type,
          params: layer.params,
        })),
        optimizer,
        // SGD 动量仅在选择 sgd 时传递（其他优化器后端忽略此参数）
        ...(optimizer === 'sgd' ? { momentum } : {}),
        lrScheduler,
        seed,
        valSplit,
        splitStrategy: datasetInfo.type === 'mnist' || datasetInfo.type === 'cifar10' ? 'predefined' : splitStrategy,
        groupField: groupField ?? undefined,
        timeField: timeField ?? undefined,
        targetField: datasetInfo.type === 'csv' ? targetField ?? undefined : undefined,
        featureFields: datasetInfo.type === 'csv' ? result.derived.featureFields : undefined,
        weightDecay,
        dataPath: datasetPath || undefined,
        trainRatio,
        inputShape: result.derived.inputShape,
        modelId: crypto.randomUUID(),
      };

      const started = await startTrainingRun(config);
      if (!started) {
        // 真实错误已由运行时写入训练 store（errorKind='preflight'/'startup'）：
        // 统一面板与训练监控展示同源信息，不再制造第二份变体；展开面板使其可见。
        preflightPanelRef.current?.expandAndFocusFirst();
      }
    } catch (error) {
      console.error('Failed to start training:', error);
      // 统一错误通道：意外启动异常写入训练 store（既有入口，不新建错误 store），
      // Preflight 面板与训练监控同源展示；保留原始错误原因，
      // 不使用本地自动消失提示作为错误反馈通道。
      useTrainingStore.getState().setPreflightError(
        `启动训练时发生意外错误：${error instanceof Error ? error.message : String(error)}`,
      );
      preflightPanelRef.current?.expandAndFocusFirst();
    } finally {
      // 成功或失败后都必须释放锁；组件卸载后不再 setState。
      startingRef.current = false;
      if (mountedRef.current) setPreparing(false);
    }
  };

  // 粗略预估每 epoch 时间：数值一律取原始记录参与运算（不从千分位展示文字反解析）。
  // 参数量不可用或结果不可精确表示时得到 null → 显示「无法估算」，不伪装成 0 秒。
  const hasDiscreteGPU = selectedTrainingDevice(devices, selectedDeviceName, runtimeInfo) === 'cuda';
  const throughput = hasDiscreteGPU ? 50000 : 5000;
  const totalParamCount = projectTotalParamCount({ totalParams, layers });
  // 耗时预估必须采信同一个总量资格结论：总量既然不能宣称完整，
  // 就不能拿它的数字去算一个看起来可信的秒数（两者要么一起可用，要么一起不可用）。
  const estimatedSecondsPerEpoch =
    totalParamCount.kind === 'available'
      ? estimateEpochSecondsPerEpoch({ totalParams, batchSize, throughput })
      : null;

  return (
    <div className="quick-train">
      {/* 高级设置展开面板 */}
      {showAdvanced && (
        <div className="quick-train__advanced">
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

          {/* SGD 动量（仅 optimizer=sgd 时显示与生效） */}
          {optimizer === 'sgd' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <label style={{ color: '#94a3b8', fontSize: '10px' }}>动量</label>
              <input
                type="number"
                value={momentum}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  // clamp 到 [0, 0.99]：手动键入可绕过 HTML min/max，后端 momentum≥1 会发散
                  setMomentum(Number.isFinite(v) ? Math.min(0.99, Math.max(0, v)) : 0.9);
                }}
                step={0.05}
                min={0}
                max={0.99}
                data-testid="momentum-input"
                style={{
                  width: '70px',
                  padding: '4px 8px',
                  backgroundColor: '#0f3460',
                  border: '1px solid #1a3a5c',
                  borderRadius: '4px',
                  color: 'white',
                  fontSize: '11px',
                }}
              />
            </div>
          )}

          {/* 学习率调度器 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ color: '#94a3b8', fontSize: '10px' }}>LR 调度</label>
            <select
              value={lrScheduler}
              onChange={(e) => setLrScheduler(e.target.value as LrSchedulerType)}
              data-testid="scheduler-select"
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
              <option value="none">无</option>
              <option value="multistep">MultiStep</option>
              <option value="cosine">Cosine</option>
            </select>
          </div>

          {/* 随机种子 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ color: '#94a3b8', fontSize: '10px' }}>随机种子</label>
            <input
              type="number"
              value={seed}
              onChange={(e) => {
                const v = e.target.value === '' ? 42 : Number(e.target.value);
                setSeed(Number.isFinite(v)
                  ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(v)))
                  : 42);
              }}
              min={0}
              data-testid="seed-input"
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

          {/* Weight Decay */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ color: '#94a3b8', fontSize: '10px' }}>Weight Decay</label>
            <input
              type="number"
              value={weightDecay}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setWeightDecay(Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
                }}
              step={0.0001}
              min={0}
              max={0.1}
              ref={weightDecayRef}
              data-testid="weight-decay-input"
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
          <div className="quick-train__range" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
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
              ref={lrRef}
              data-testid="lr-slider"
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>

          {/* 验证集比例始终大于 0；封存测试集不进入训练循环。 */}
          <div className="quick-train__range" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ color: '#94a3b8', fontSize: '10px' }}>
              验证集：{Math.round(valSplit * 100)}%
            </label>
            <input
              type="range"
              min={0.05}
              max={0.5}
              step={0.05}
              value={valSplit}
              onChange={(e) => setValSplit(Number(e.target.value))}
              ref={valSplitRef}
              data-testid="valsplit-slider"
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>

          {/* 恢复默认 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <button
              type="button"
              onClick={() => {
                setLrExponent(-3);
                setOptimizer('adam');
                setWeightDecay(0);
                setMomentum(0.9);
                setLrScheduler('none');
                setSeed(42);
                setValSplit(0.2);
              }}
              data-testid="reset-defaults-btn"
              style={{
                padding: '4px 10px',
                backgroundColor: '#0f3460',
                color: '#94a3b8',
                border: '1px solid #1a3a5c',
                borderRadius: '4px',
                fontSize: '10px',
                cursor: 'pointer',
              }}
            >
              恢复默认
            </button>
          </div>

          {/* 参数量 + 预估 */}
          <div className="quick-train__estimate" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ color: '#94a3b8', fontSize: '10px' }}>
              参数量：
              <span
                style={{ color: '#6ee7b7' }}
                data-testid="qt-param-count"
                title={totalParamCount.kind === 'unavailable' ? totalParamCount.hint : undefined}
              >{totalParamCount.text}</span>
            </span>
            {estimatedSecondsPerEpoch === null ? (
              <span style={{ color: '#64748b', fontSize: '10px' }} data-testid="qt-epoch-estimate">
                每 epoch 耗时：无法估算
              </span>
            ) : (
              estimatedSecondsPerEpoch > 0 && (
                <span style={{ color: '#64748b', fontSize: '10px' }} data-testid="qt-epoch-estimate">
                  ~{estimatedSecondsPerEpoch}秒/epoch（粗略估计）
                </span>
              )
            )}
          </div>
        </div>
      )}

      {/* 统一训练前检查：实时预览与点击启动共用同一套规则 */}
      <TrainingPreflightPanel
        ref={preflightPanelRef}
        result={preflight}
        authoritativeError={authoritativeError}
        onNavigateTarget={handleNavigateTarget}
      />

      {/* 底部训练栏 */}
      <div className="quick-train__bar">
        {/* 数据集状态 */}
        <div className="quick-train__field quick-train__dataset" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ color: '#94a3b8', fontSize: '11px' }}>数据集</label>
          <div className="quick-train__dataset-value" style={{
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
        <div className="quick-train__field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ color: '#94a3b8', fontSize: '11px' }}>Epochs</label>
          <input
            type="number"
            value={epochs}
            onChange={(e) => setEpochs(Number(e.target.value))}
            min={1}
            max={50}
            ref={epochsRef}
            data-testid="epoch-input"
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
        <div className="quick-train__field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ color: '#94a3b8', fontSize: '11px' }}>Batch</label>
          <input
            type="number"
            value={batchSize}
            onChange={(e) => setBatchSize(Number(e.target.value))}
            min={1}
            max={512}
            step={16}
            ref={batchRef}
            data-testid="batch-input"
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
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          data-testid="advanced-btn"
          className="quick-train__advanced-toggle"
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

        {/* 启动错误不再用本地 hint 旁路：统一由训练 store 同源展示于检查面板与训练监控 */}

        {/* 开始训练按钮：被阻断时仍可点击（展开检查面板）；仅准备中禁用（原生语义） */}
        <button
          type="button"
          onClick={handleStartTraining}
          disabled={preparing}
          data-testid="start-train-btn"
          className="quick-train__start"
          style={{
            padding: '10px 24px',
            backgroundColor: preparing ? '#475569' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: preparing ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: 600,
            transition: 'background-color 0.2s',
          }}
        >
          {preparing ? '正在准备训练…' : '🚀 开始训练'}
        </button>
      </div>
    </div>
  );
}
