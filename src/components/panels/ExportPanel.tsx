import { useState } from 'react';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { TRAIN_CONFIG_STORAGE_KEY, type TrainConfig } from '@/types/training';
import { generatePyTorchCode, generateKerasCode } from '@/utils/codeGenerator';
import {
  generateModelPy,
  generateTrainPy,
  generateRequirements,
  generateVerifyPackagePy,
  generateReadmeMd,
  generateMetricsCsv,
  selectLatestCompletedAttemptForLayers,
  type ExperimentConfig,
} from '@/utils/experimentExport';
import { toast } from '@/components/ui/Toast';
import { useExperimentStore, verifyExperimentLedgerAudit } from '@/stores/useExperimentStore';
import type { ConclusionTrust } from '@/types/experiment';
import { maxConclusionTrust, projectEffectiveClaimTrust } from '@/utils/claimProtocol';
import { redactLocalPaths } from '@/utils/exportRedaction';

/** 浏览器端下载文件 */
function browserDownload(filename: string, content: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 保存文件：Tauri 用 save dialog + fs，失败降级到浏览器下载 */
async function saveFile(filename: string, content: string, mimeType = 'text/plain') {
  try {
    const { save } = await import('@tauri-apps/api/dialog');
    const { writeTextFile } = await import('@tauri-apps/api/fs');
    const filePath = await save({
      filters: [{ name: filename.split('.').pop()!.toUpperCase(), extensions: [filename.split('.').pop()!] }],
      defaultPath: filename,
    });
    if (!filePath) return;
    await writeTextFile(filePath, content);
  } catch {
    browserDownload(filename, content, mimeType);
  }
}

export default function ExportPanel() {
  const layers = useLayerStore(state => state.layers);
  const totalParams = useLayerStore(state => state.totalParams);
  const towerName = useLayerStore(state => state.towerName);
  const metrics = useTrainingStore(state => state.metrics);
  const trainingStatus = useTrainingStore(state => state.status);
  const executionMode = useTrainingStore(state => state.executionMode);
  const logs = useTrainingStore(state => state.logs);
  const lastRunSnapshot = useTrainingStore(state => state.lastRunSnapshot);
  const trainingArtifacts = useTrainingStore(state => state.artifacts);
  const lastTrainConfig = useTrainingStore(state => state.lastTrainConfig);
  const lastAttemptId = useTrainingStore(state => state.lastAttemptId);
  const datasetInfo = useDatasetStore(state => state.datasetInfo);
  const ledger = useExperimentStore(state => state.ledger);

  // 只有已完成的原生训练指标才属于可复现实验结果。浏览器演示曲线和中断训练的
  // 局部指标仍可在界面排障，但不能进入 CSV 或实验包冒充真实结果；训练完成后若
  // 用户修改了网络，也不能把旧权重/指标错误归到当前结构名下。
  const currentArchitectureMatchesRun = lastRunSnapshot !== null
    && lastRunSnapshot.totalParams === totalParams
    && JSON.stringify(layers.map(layer => ({ type: layer.type, params: layer.params })))
      === JSON.stringify(lastRunSnapshot.layers);
  const persistedAttempt = selectLatestCompletedAttemptForLayers(ledger, layers, lastAttemptId);
  const hasLegacyCompletedMetrics = trainingStatus === 'done'
    && executionMode === 'native'
    && currentArchitectureMatchesRun
    && metrics.length > 0;
  const hasLegacyMatchingNativeResult = trainingStatus === 'done'
    && executionMode === 'native'
    && currentArchitectureMatchesRun;
  const hasMatchingNativeResult = Boolean(persistedAttempt) || hasLegacyMatchingNativeResult;
  const resultArtifacts = persistedAttempt?.artifacts ?? trainingArtifacts;
  const exportableMetrics = persistedAttempt?.metrics ?? (hasLegacyCompletedMetrics ? metrics : []);
  const hasRealCompletedMetrics = exportableMetrics.length > 0;
  const exportTrainConfig = persistedAttempt?.config ?? lastTrainConfig;
  const exportAttemptId = persistedAttempt?.id ?? (hasLegacyMatchingNativeResult ? lastAttemptId : null);
  // 产物按 Attempt 隔离持久化；关闭训练卡片或完成后续训练，都不应覆盖历史权重。
  const canExportWeights = Boolean(exportAttemptId) && resultArtifacts?.weights === true;
  const canExportFullModel = Boolean(exportAttemptId) && resultArtifacts?.fullModel === true;
  const canExportNumpy = Boolean(exportAttemptId) && resultArtifacts?.numpy === true;
  const resultMode = hasRealCompletedMetrics
      ? 'native' as const
      : trainingStatus === 'done' && executionMode === 'simulation' && metrics.length > 0
        ? 'simulation' as const
      : 'none' as const;

  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [previewLang, setPreviewLang] = useState<'python' | 'keras' | null>(null);
  const [exportingPkg, setExportingPkg] = useState(false);

  /** 清理文件名中 Windows 不允许的字符（提前声明避免 TDZ） */
  const sanitizeFilename = (name: string): string => {
    const cleaned = name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[.\s]+$/, '')
      .replace(/^(con|prn|aux|nul|com\d|lpt\d)$/i, '$&_');
    return cleaned || 'untitled';
  };

  /** 从 localStorage 读用户当前训练配置（QuickTrain 持久化的 9 字段）作为实验包默认超参 */
  const readCurrentTrainConfig = (): ExperimentConfig => {
    const defaults: ExperimentConfig = {
      epochs: 5,
      batchSize: 32,
      learningRate: 0.001,
      optimizer: 'adam',
      momentum: 0.9,
      lrScheduler: 'none',
      seed: 42,
      valSplit: 0.2,
      weightDecay: 0,
      dataset: 'mnist',
    };
    // 实验包包含本次真实指标时，超参数与数据集也必须来自同一次运行快照，
    // 不能读取用户训练后可能改动的当前控件/数据集。
    if (hasMatchingNativeResult && exportTrainConfig) {
      return {
        epochs: exportTrainConfig.epochs,
        batchSize: exportTrainConfig.batchSize,
        learningRate: exportTrainConfig.learningRate,
        optimizer: exportTrainConfig.optimizer ?? defaults.optimizer,
        momentum: exportTrainConfig.momentum ?? defaults.momentum,
        lrScheduler: exportTrainConfig.lrScheduler ?? defaults.lrScheduler,
        seed: exportTrainConfig.seed ?? defaults.seed,
        valSplit: exportTrainConfig.valSplit ?? defaults.valSplit,
        weightDecay: exportTrainConfig.weightDecay ?? defaults.weightDecay,
        dataset: exportTrainConfig.dataset,
      };
    }
    try {
      const raw = localStorage.getItem(TRAIN_CONFIG_STORAGE_KEY);
      if (!raw) return defaults;
      const s = JSON.parse(raw) as Record<string, unknown>;
      const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
      const lrExponent = clamp(num(s.lrExponent, -3), -6, 0);
      return {
        epochs: Math.floor(clamp(num(s.epochs, defaults.epochs), 1, 50)),
        batchSize: Math.floor(clamp(num(s.batchSize, defaults.batchSize), 1, 512)),
        learningRate: Math.pow(10, lrExponent),
        optimizer: s.optimizer === 'sgd' || s.optimizer === 'adamw' || s.optimizer === 'adam' ? s.optimizer : defaults.optimizer,
        momentum: clamp(num(s.momentum, defaults.momentum), 0, 0.99),
        lrScheduler: s.lrScheduler === 'multistep' || s.lrScheduler === 'cosine' || s.lrScheduler === 'none' ? s.lrScheduler : defaults.lrScheduler,
        seed: Math.max(0, Math.floor(num(s.seed, defaults.seed))),
        valSplit: (() => {
          const value = clamp(num(s.valSplit, defaults.valSplit), 0, 0.5);
          return value > 0 ? value : defaults.valSplit;
        })(),
        weightDecay: clamp(num(s.weightDecay, defaults.weightDecay), 0, 1),
        dataset: datasetInfo?.type === 'cifar10' ? 'cifar10' : 'mnist',
      };
    } catch {
      return defaults;
    }
  };

  const handleExportExperiment = async () => {
    if (layers.length === 0) return;
    if (!persistedAttempt) {
      toast.warning('实验复现包必须绑定已完成的受控 Attempt；仅导出网络代码请使用下方 PyTorch/Keras 代码导出。');
      return;
    }
    if (!persistedAttempt.artifacts?.weights || !persistedAttempt.provenance.preprocessingParameters) {
      toast.warning('该 Attempt 缺少原始权重或冻结预处理协议，不能生成可核验的复现包。');
      return;
    }
    const packageDataset = hasMatchingNativeResult
      ? exportTrainConfig?.dataset
      : datasetInfo?.type;
    if (packageDataset && packageDataset !== 'mnist' && packageDataset !== 'cifar10') {
      toast.warning('独立实验包当前仅支持 MNIST / CIFAR-10；自定义数据集请导出模型代码并自行接入数据加载。');
      return;
    }
    setExportingPkg(true);
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');

      const safeName = sanitizeFilename(towerName || 'neurobricks-experiment');
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const dirPath = await open({
        directory: true,
        title: '选择实验包保存位置（将创建子目录）',
      });
      if (!dirPath || Array.isArray(dirPath)) return;

      const config = readCurrentTrainConfig();
      if (!(config.valSplit > 0 && config.valSplit <= 0.5)) {
        toast.warning('该历史配置没有独立验证集，导出脚本将触碰封存测试集；已拒绝生成伪复现实验包。');
        return;
      }
      useExperimentStore.getState().appendEvent('attempt', exportAttemptId ?? 'legacy-export', 'experiment_package_export_requested', {
        format: 'neurobricks-experiment-package-v1',
      });
      await verifyExperimentLedgerAudit();
      const currentLedger = useExperimentStore.getState().ledger;
      const auditPersistence = useExperimentStore.getState().auditPersistence;
      const attempt = currentLedger.attempts.find(item => item.id === exportAttemptId) ?? null;
      const experiment = attempt
        ? currentLedger.experiments.find(item => item.id === attempt.experimentId) ?? null
        : null;
      const study = experiment
        ? currentLedger.studies.find(item => item.id === experiment.studyId) ?? null
        : null;
       const claims = attempt ? currentLedger.claims.filter(item => item.attemptId === attempt.id) : [];
       // 统一投影：实验包最高等级只从 effectiveTrust 中选择（协议层安全排序），
       // 本地不再维护 trustRank；未知枚举与不一致存档绝不进入等级比较。
       const claimProjections = claims.map(claim => (study
         ? projectEffectiveClaimTrust({ study, claim, attempt, events: currentLedger.events, auditPersistence })
         : null));
       const projectedClaims = claims.map((claim, index) => ({
         ...claim,
         archivedConclusionTrust: claim.conclusionTrust,
         conclusionTrust: claimProjections[index]?.effectiveTrust ?? ('not_evaluated' as ConclusionTrust),
       }));
       const conclusionTrust = claimProjections.reduce<ConclusionTrust>(
         (best, projection) => (projection ? maxConclusionTrust(best, projection.effectiveTrust) : best),
         'not_evaluated',
       );
       // 异常/阻断计数：合法未裁决（not_adjudicated）不算异常；档案阻断单独计数。
       const isStructural = (reasons: readonly string[]) => reasons.some(
         reason => reason !== 'not_adjudicated' && reason !== 'audit_persistence_not_healthy' && reason !== 'post_hoc',
       );
       const claimAnomalyCount = claimProjections.filter(
         projection => projection !== null && isStructural(projection.reasons),
       ).length;
       const claimPersistenceBlockedCount = claimProjections.filter(
         projection => projection !== null
           && !isStructural(projection.reasons)
           && projection.reasons.includes('audit_persistence_not_healthy'),
       ).length;
      const trustContext = {
        attemptId: attempt?.id ?? null,
        executionTrust: attempt?.provenance.executionTrust ?? ('unverified' as const),
        conclusionTrust,
        modelWeightsHash: attempt?.provenance.modelWeightsHash ?? null,
        auditPersistence,
        claimCount: claims.length,
        claimAnomalyCount,
        claimPersistenceBlockedCount,
      };
      const modelPy = generateModelPy(layers, towerName || '未命名网络');
      const trainPy = generateTrainPy(config);
      const requirements = generateRequirements();
      const verifyPackagePy = generateVerifyPackagePy();
      const readme = generateReadmeMd(
        towerName || '未命名网络',
        layers,
        totalParams,
        config,
        exportableMetrics,
        resultMode,
        trustContext,
      );
      const metricsCsv = generateMetricsCsv(exportableMetrics);
      const redactConfig = (value: TrainConfig) => {
        const { dataPath: _privatePath, ...safe } = value;
        return { ...safe, dataPathIncluded: false };
      };
      const relatedIds = new Set([attempt?.id, experiment?.id, study?.id, ...claims.map(claim => claim.id)].filter(Boolean));
      const manifestJson = JSON.stringify({
        protocolVersion: 1,
        ledgerId: currentLedger.ledgerId,
        manifestType: 'neurobricks-experiment-package-v1',
        exportedAt: new Date().toISOString(),
        auditPersistence,
        threatModel: 'export is a one-way delivery format; reruns outside NeuroBricks are external/unverified',
        study,
        experiment: experiment ? { ...experiment, config: redactConfig(experiment.config) } : null,
        attempt: attempt ? { ...attempt, artifacts: undefined, config: redactConfig(attempt.config) } : null,
        sourceRunArtifacts: attempt?.artifacts ?? null,
         claims: projectedClaims,
        events: redactLocalPaths(
          currentLedger.events.filter(event => relatedIds.has(event.entityId)),
          [attempt?.config.dataPath, experiment?.config.dataPath].filter((value): value is string => Boolean(value)),
        ),
        trust: trustContext,
      }, null, 2);
      const preprocessingJson = JSON.stringify({
        protocolVersion: 1,
        attemptId: attempt!.id,
        fittedPreprocessingHash: attempt!.provenance.preprocessingHash,
        parameters: attempt!.provenance.preprocessingParameters,
      }, null, 2);

      await invoke('export_experiment_package', {
        dirPath: `${dirPath}${dirPath.toString().endsWith('\\') ? '' : '\\'}${safeName}_${ts}`,
        modelPy,
        trainPy,
        requirementsTxt: requirements,
        readmeMd: readme,
        metricsCsv,
        manifestJson,
        attemptId: attempt!.id,
        preprocessingJson,
        verifyPackagePy,
      });

      useExperimentStore.getState().appendEvent('attempt', attempt?.id ?? 'legacy-export', 'experiment_package_export_completed', {
        format: 'neurobricks-experiment-package-v1',
        auditPersistence,
      });
      await verifyExperimentLedgerAudit();

      toast.success(`实验复现包导出成功\n\n目录：${safeName}_${ts}\n包含代码、原始权重、冻结预处理、清单与${metricsCsv ? '已完成指标' : '空指标说明'}`);
    } catch (error) {
      console.error('Failed to export experiment package:', error);
      useExperimentStore.getState().appendEvent('attempt', exportAttemptId ?? 'legacy-export', 'experiment_package_export_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      toast.error('实验包导出失败：' + (error as Error).message);
    } finally {
      setExportingPkg(false);
    }
  };

  const handlePreviewPyTorch = () => {
    const code = generatePyTorchCode(layers);
    setPreviewCode(code);
    setPreviewLang('python');
  };

  const handlePreviewKeras = () => {
    const code = generateKerasCode(layers);
    setPreviewCode(code);
    setPreviewLang('keras');
  };

  const handleSavePyTorch = async () => {
    if (!previewCode) return;
    try {
      await saveFile('model.py', previewCode, 'text/x-python');
    } catch (error) {
      toast.error('导出失败：' + (error as Error).message);
    }
  };

  const handleSaveKeras = async () => {
    if (!previewCode) return;
    try {
      await saveFile('model_keras.py', previewCode, 'text/x-python');
    } catch (error) {
      toast.error('导出失败：' + (error as Error).message);
    }
  };

  const handleExportWeights = async () => {
    try {
      if (!canExportWeights) {
        toast.warning('当前网络没有可用的 PyTorch 权重产物');
        return;
      }
      const { save } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');
      const filePath = await save({
        filters: [{ name: 'PyTorch Weights', extensions: ['pth'] }],
        defaultPath: 'model_weights.pth',
      });
      if (!filePath) return;
      await invoke('export_model_weights', { path: filePath, attemptId: exportAttemptId });
      toast.success('PyTorch 权重导出成功\n\n使用方法：\nmodel.load_state_dict(torch.load("model_weights.pth"))');
    } catch (error) {
      console.error('Failed to export weights:', error);
      toast.error('导出失败：' + (error as Error).message);
    }
  };

  const handleExportFullModel = async () => {
    try {
      if (!canExportFullModel) {
        toast.warning('当前网络没有可用的完整模型产物');
        return;
      }
      const { save } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');
      const filePath = await save({
        filters: [{ name: 'PyTorch Full Model', extensions: ['pt'] }],
        defaultPath: 'model_full.pt',
      });
      if (!filePath) return;
      await invoke('export_full_model', { path: filePath, attemptId: exportAttemptId });
      toast.success('完整模型导出成功\n\n使用方法：\nmodel = torch.load("model_full.pt")\nmodel.eval()');
    } catch (error) {
      console.error('Failed to export full model:', error);
      toast.error('导出失败：' + (error as Error).message);
    }
  };

  const handleExportNumpy = async () => {
    try {
      if (!canExportNumpy) {
        toast.warning('当前训练没有成功生成 NumPy 权重');
        return;
      }
      const { save } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');
      const filePath = await save({
        filters: [{ name: 'NumPy Weights', extensions: ['npz'] }],
        defaultPath: 'model_weights.npz',
      });
      if (!filePath) return;
      await invoke('export_numpy_weights', { path: filePath, attemptId: exportAttemptId });
      toast.success('NumPy 权重导出成功\n\n使用方法：\nimport numpy as np\ndata = np.load("model_weights.npz")\nfor key in data.files:\n    print(key, data[key].shape)');
    } catch (error) {
      console.error('Failed to export numpy weights:', error);
      toast.error('导出失败：' + (error as Error).message);
    }
  };

  const handleExportLogs = async () => {
    try {
      if (!hasRealCompletedMetrics) {
        toast.warning(executionMode === 'simulation'
          ? '浏览器演示指标不能作为真实训练日志导出'
          : '暂无已完成的真实训练指标可导出');
        return;
      }
      const headers = Object.keys(exportableMetrics[0]).join(',');
      const rows = exportableMetrics.map(m => Object.values(m).join(','));
      const csv = [headers, ...rows].join('\n');
      await saveFile('training_log.csv', csv, 'text/csv');
    } catch (error) {
      console.error('Failed to export training logs:', error);
      toast.error('导出失败：' + (error as Error).message);
    }
  };

  const handleExportLogsTxt = async () => {
    try {
      if (!logs || logs.length === 0) {
        toast.warning('暂无训练日志可导出');
        return;
      }
      const lines = logs.map(log => {
        const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
        return `[${time}] [${log.level.toUpperCase()}] ${log.message}`;
      });
      const content = `NeuroBricks 3D 训练日志\n导出时间: ${new Date().toLocaleString('zh-CN')}\n共 ${logs.length} 条日志\n${'='.repeat(50)}\n\n${lines.join('\n')}`;
      await saveFile('training_log.txt', content, 'text/plain');
    } catch (error) {
      console.error('Failed to export logs:', error);
      toast.error('导出失败：' + (error as Error).message);
    }
  };

  // --- 项目保存 / 加载 ---

  // sanitizeFilename 已提前到组件顶部声明

  const handleSaveProject = async () => {
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');

      const projectData = {
        version: '1.0',
        tower: {
          id: 'default',
          name: useLayerStore.getState().towerName,
          layers: useLayerStore.getState().layers,
          layoutMode: useLayerStore.getState().layoutMode,
          totalParams: useLayerStore.getState().totalParams,
          hasShapeError: useLayerStore.getState().hasShapeError,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };

      const safeName = sanitizeFilename(useLayerStore.getState().towerName || 'untitled');
      const filePath = await save({
        filters: [{ name: 'NeuroBricks Project', extensions: ['nbproj'] }],
        defaultPath: `${safeName}.nbproj`,
      });
      if (!filePath) return;

      await invoke('save_project', { data: JSON.stringify(projectData, null, 2), path: filePath });
      toast.success('项目保存成功');
    } catch (error) {
      console.error('Failed to save project:', error);
      toast.error('保存失败：' + (error as Error).message);
    }
  };

  const handleLoadProject = async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');

      const filePath = await open({
        filters: [{ name: 'NeuroBricks Project', extensions: ['nbproj'] }],
        multiple: false,
        title: '加载 NeuroBricks 项目',
      });
      if (!filePath || Array.isArray(filePath)) return;

      const jsonStr = await invoke<string>('load_project', { path: filePath });

      // 大文件保护：超过 10MB 拒绝解析，避免冻结 UI
      if (jsonStr.length > 10 * 1024 * 1024) {
        toast.error('文件过大（超过 10MB），不是有效的项目文件');
        return;
      }

      const data = JSON.parse(jsonStr);

      // 结构完整性检查
      if (!data.version || !data.tower || !Array.isArray(data.tower.layers)) {
        toast.error('无效的项目文件：缺少必要字段（version / tower.layers）');
        return;
      }

      // 层数据完整性修复：确保 recalcAll 依赖的字段存在（order/position/params），
      // 防止损坏文件中缺失字段导致排序 NaN 或形状推导崩溃
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repairedLayers = (data.tower.layers as any[]).map((layer, index) => ({
        id: layer.id || `layer-${Date.now()}-${index}`,
        type: layer.type,
        params: layer.params || {},
        order: typeof layer.order === 'number' ? layer.order : index,
        position: Array.isArray(layer.position) && layer.position.length === 3
          ? layer.position
          : [0, 0, 0],
        outputShape: layer.outputShape ?? null,
        paramCount: typeof layer.paramCount === 'number' ? layer.paramCount : 0,
        validationError: layer.validationError ?? null,
      }));

      // 过滤缺少 type 的无效层（type 无法修复，无它则无法构建任何组件）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const validLayers = repairedLayers.filter((l: any) => typeof l.type === 'string' && l.type.length > 0);
      if (validLayers.length === 0) {
        toast.error('无效的项目文件：未找到有效的网络层');
        return;
      }

      // layoutMode 只接受已知值，防止非法字符串传入 store
      const layoutMode = data.tower.layoutMode === 'free' ? 'free' : 'vertical';

      useLayerStore.getState().loadProject({ layers: validLayers, layoutMode });

      const skipped = data.tower.layers.length - validLayers.length;
      toast.success(`项目加载成功（${validLayers.length} 层${skipped > 0 ? `，跳过 ${skipped} 个无效层` : ''}）`);
    } catch (error) {
      console.error('Failed to load project:', error);
      toast.error('加载失败：' + (error as Error).message);
    }
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '16px', paddingBottom: '8px', borderBottom: '1px solid #0f3460' }}>
        导出选项
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* 项目管理 */}
        <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, marginBottom: '6px' }}>
          项目管理
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <button
            type="button"
            onClick={handleSaveProject}
            disabled={layers.length === 0}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: layers.length === 0 ? '#475569' : '#0891b2',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: layers.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            💾 保存项目
          </button>
          <button
            type="button"
            onClick={handleLoadProject}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#0e7490',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            📂 加载项目
          </button>
        </div>

        <button type="button" onClick={handleExportExperiment} disabled={!persistedAttempt || exportingPkg}
          data-testid="export-experiment-btn"
          title={!persistedAttempt ? '请先完成一次受控训练；仅导出代码请使用下方按钮' : undefined}
          style={{ padding: '12px', backgroundColor: !persistedAttempt || exportingPkg ? '#475569' : '#be185d', color: 'white', border: 'none', borderRadius: '6px', cursor: !persistedAttempt || exportingPkg ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          onMouseEnter={e => { if (persistedAttempt && !exportingPkg) e.currentTarget.style.backgroundColor = '#9d174d'; }}
          onMouseLeave={e => { if (layers.length > 0 && !exportingPkg) e.currentTarget.style.backgroundColor = '#be185d'; }}
        >
          <span style={{ fontSize: '16px' }}>🎓</span>
          <div>
            <div>{exportingPkg ? '导出中...' : '导出实验复现包'}</div>
            <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7 }}>代码 + 原始权重 + 预处理 + 哈希；外部重跑单独留档</div>
          </div>
        </button>

        <button type="button" onClick={handlePreviewPyTorch} disabled={layers.length === 0}
          style={{ padding: '12px', backgroundColor: layers.length === 0 ? '#475569' : '#1e40af', color: 'white', border: 'none', borderRadius: '6px', cursor: layers.length === 0 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          onMouseEnter={e => { if (layers.length > 0) e.currentTarget.style.backgroundColor = '#1e3a8a'; }}
          onMouseLeave={e => { if (layers.length > 0) e.currentTarget.style.backgroundColor = '#1e40af'; }}
        >
          <span style={{ fontSize: '16px' }}>🐍</span><span>导出 PyTorch 代码</span>
        </button>

        <button type="button" onClick={handlePreviewKeras} disabled={layers.length === 0}
          style={{ padding: '12px', backgroundColor: layers.length === 0 ? '#475569' : '#047857', color: 'white', border: 'none', borderRadius: '6px', cursor: layers.length === 0 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          onMouseEnter={e => { if (layers.length > 0) e.currentTarget.style.backgroundColor = '#065f46'; }}
          onMouseLeave={e => { if (layers.length > 0) e.currentTarget.style.backgroundColor = '#047857'; }}
        >
          <span style={{ fontSize: '16px' }}>🔧</span><span>导出 Keras 代码</span>
        </button>

        <button type="button" onClick={handleExportWeights} disabled={!canExportWeights}
          title={!canExportWeights ? '请先完成当前网络的真实训练并确认权重保存成功' : undefined}
          style={{ padding: '10px 12px', backgroundColor: !canExportWeights ? '#475569' : '#7c3aed', color: 'white', border: 'none', borderRadius: '6px', cursor: !canExportWeights ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ fontSize: '14px' }}>⚖️</span>
          <div>
            <div>PyTorch 权重 (.pth)</div>
            <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7 }}>仅权重，需配合模型代码使用</div>
          </div>
        </button>

        <button type="button" onClick={handleExportFullModel} disabled={!canExportFullModel}
          title={!canExportFullModel ? '请先完成当前网络的真实训练并确认完整模型保存成功' : undefined}
          style={{ padding: '10px 12px', backgroundColor: !canExportFullModel ? '#475569' : '#6d28d9', color: 'white', border: 'none', borderRadius: '6px', cursor: !canExportFullModel ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ fontSize: '14px' }}>📦</span>
          <div>
            <div>完整模型 (.pt)</div>
            <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7 }}>结构+权重，torch.load 直接加载</div>
          </div>
        </button>

        <button type="button" onClick={handleExportNumpy} disabled={!canExportNumpy}
          title={!canExportNumpy ? '请先完成当前网络的真实训练并确认 NumPy 权重保存成功' : undefined}
          style={{ padding: '10px 12px', backgroundColor: !canExportNumpy ? '#475569' : '#5b21b6', color: 'white', border: 'none', borderRadius: '6px', cursor: !canExportNumpy ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ fontSize: '14px' }}>🔢</span>
          <div>
            <div>NumPy 权重 (.npz)</div>
            <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7 }}>不依赖 PyTorch，通用格式</div>
          </div>
        </button>

        <button type="button" onClick={handleExportLogs} disabled={!hasRealCompletedMetrics}
          title={!hasRealCompletedMetrics && executionMode === 'simulation' ? '浏览器演示指标不可作为真实实验数据导出' : undefined}
          style={{ padding: '12px', backgroundColor: !hasRealCompletedMetrics ? '#475569' : '#ea580c', color: 'white', border: 'none', borderRadius: '6px', cursor: !hasRealCompletedMetrics ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          onMouseEnter={e => { if (hasRealCompletedMetrics) e.currentTarget.style.backgroundColor = '#c2410c'; }}
          onMouseLeave={e => { if (hasRealCompletedMetrics) e.currentTarget.style.backgroundColor = '#ea580c'; }}
        >
          <span style={{ fontSize: '16px' }}>📊</span><span>导出训练日志</span>
        </button>

        <button type="button" onClick={handleExportLogsTxt} disabled={logs.length === 0}
          style={{ padding: '12px', backgroundColor: logs.length === 0 ? '#475569' : '#d97706', color: 'white', border: 'none', borderRadius: '6px', cursor: logs.length === 0 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          onMouseEnter={e => { if (logs.length > 0) e.currentTarget.style.backgroundColor = '#b45309'; }}
          onMouseLeave={e => { if (logs.length > 0) e.currentTarget.style.backgroundColor = '#d97706'; }}
        >
          <span style={{ fontSize: '16px' }}>📄</span><span>导出训练日志 (.txt)</span>
        </button>

      </div>

      {/* 代码预览区域 */}
      {previewCode && (
        <div style={{ marginBottom: '12px', marginTop: '12px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
          }}>
            <span style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600 }}>
              代码预览 ({previewLang === 'python' ? 'PyTorch' : 'Keras'})
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={previewLang === 'python' ? handleSavePyTorch : handleSaveKeras}
                style={{
                  padding: '4px 12px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                保存到文件
              </button>
              <button
                type="button"
                onClick={() => { setPreviewCode(null); setPreviewLang(null); }}
                style={{
                  padding: '4px 12px',
                  backgroundColor: '#475569',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                }}
              >
                关闭
              </button>
            </div>
          </div>
          <pre style={{
            backgroundColor: '#0f172a',
            border: '1px solid #1a3a5c',
            borderRadius: '6px',
            padding: '10px',
            maxHeight: '300px',
            overflow: 'auto',
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#e2e8f0',
            lineHeight: '1.5',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}>
            {previewCode}
          </pre>
        </div>
      )}

      <div style={{ marginTop: '12px', padding: '10px', backgroundColor: '#0f3460', borderRadius: '6px', fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>
        💡 提示：<br />
        • 代码导出需要至少一个层组件<br />
        • 权重导出需要完成一次训练<br />
        • .pth 需配合模型代码：model.load_state_dict(torch.load(...))<br />
        • .pt 可直接加载：model = torch.load(...)<br />
        • .npz 用 NumPy 读取：np.load(...)<br />
        • 如果 .pth 被压缩软件打开，改用 .pt 或 .npz 格式<br />
        • 项目文件格式为 .nbproj（JSON），可保存/加载网络结构
      </div>
    </div>
  );
}
