/**
 * 训练前检查（Preflight）：训练启动条件的唯一同步解释层。
 * - 纯函数：无 React、无 DOM、无 store.getState、无 localStorage、无异步副作用；
 * - QuickTrain 的实时预览与点击启动必须调用同一个 evaluateTrainingPreflight；
 * - prepareTrainingAttempt / Python sidecar 仍是启动阶段的最终权威检查，
 *   本层不能替代，也不得把它们的复杂规则提前复制。
 */
import type { DatasetInfo } from '@/types/dataset';
import type { Layer3D, ShapeValidationError } from '@/types/layer';
import type { TrainingRuntimeInfo } from '@/types/gpu';
import type { RightPanelId } from '@/types/workspace';
import { deriveCsvFeatureFieldsFromColumns } from '@/utils/datasetContract';

/**
 * 校验模型最后一层与当前监督任务的输出契约。
 * 形状引擎只知道相邻张量，数据集类别数/回归目标属于任务语义，必须单独校验。
 */
export function datasetOutputContractErrors(
  layers: Layer3D[],
  dataset: DatasetInfo | null,
): ShapeValidationError[] {
  if (!dataset || layers.length === 0 || dataset.type === 'excel') return [];

  const linearLayers = [...layers]
    .sort((left, right) => left.order - right.order)
    .filter(layer => layer.type === 'Linear');
  const outputLayer = linearLayers[linearLayers.length - 1];
  const expectedOutputs = dataset.type === 'csv' ? 1 : dataset.classCount;

  if (!Number.isInteger(expectedOutputs) || expectedOutputs < 1) return [];
  if (!outputLayer) {
    return [{
      layerId: '',
      layerType: 'Linear',
      errorType: 'param_conflict',
      message: dataset.type === 'csv'
        ? 'CSV 监督式回归需要最后一个 Linear 层输出 1 个连续数值'
        : `${dataset.name} 有 ${expectedOutputs} 个类别，需要最后一个 Linear 层输出 ${expectedOutputs} 个类别分数`,
      suggestion: `在网络末尾添加 outFeatures=${expectedOutputs} 的 Linear 层`,
      expectedInputShape: [expectedOutputs],
      actualInputShape: null,
    }];
  }

  const actualOutputs = outputLayer.params.outFeatures
    ?? outputLayer.params.units
    ?? outputLayer.params.outputSize;
  if (actualOutputs === expectedOutputs) return [];

  return [{
    layerId: outputLayer.id,
    layerType: outputLayer.type,
    errorType: 'param_conflict',
    message: dataset.type === 'csv'
      ? `CSV 回归要求最后一个 Linear 的 outFeatures=1，当前为 ${actualOutputs ?? '未设置'}`
      : `${dataset.name} 有 ${expectedOutputs} 个类别，但最后一个 Linear 的 outFeatures=${actualOutputs ?? '未设置'}`,
    suggestion: `将最后一个 Linear 层的 outFeatures 修改为 ${expectedOutputs}`,
    expectedInputShape: [expectedOutputs],
    actualInputShape: typeof actualOutputs === 'number' ? [actualOutputs] : null,
  }];
}

/* ============================================================
 * 统一训练前检查：同步可判断规则的唯一权威实现。
 * QuickTrain 的实时预览与点击启动共用；启动阶段最终检查仍由
 * prepareTrainingAttempt / sidecar 权威执行，本层不复制其规则。
 * ============================================================ */

export type TrainingPreflightSeverity = 'blocker' | 'warning';

export type TrainingPreflightCategory = 'data' | 'model' | 'split' | 'parameters' | 'runtime' | 'study';

/** 稳定 code：问题身份不得用中文 message 表达。 */
export type TrainingPreflightIssueCode =
  | 'model_empty'
  | 'model_shape_error'
  | 'model_output_contract'
  | 'csv_conv_layer_unsupported'
  | 'csv_input_declaration_mismatch'
  | 'csv_output_not_single'
  | 'csv_feature_count_zero'
  | 'data_missing'
  | 'data_excel_unsupported'
  | 'csv_target_missing'
  | 'csv_target_non_numeric'
  | 'csv_feature_non_numeric'
  | 'split_group_field_missing'
  | 'split_group_image_unavailable'
  | 'split_group_image_readiness'
  | 'split_temporal_non_csv'
  | 'split_temporal_field_missing'
  | 'param_epochs_invalid'
  | 'param_batch_invalid'
  | 'param_lr_invalid'
  | 'param_weight_decay_invalid'
  | 'param_val_split_invalid'
  | 'runtime_checking'
  | 'runtime_unavailable'
  | 'runtime_csv_dependency_missing'
  | 'warn_model_validation'
  | 'warn_simulation_mode'
  | 'warn_audit_degraded';

/** 训练参数定位目标：QuickTrain 对应输入字段。 */
export type TrainFieldId = 'epochs' | 'batchSize' | 'learningRate' | 'weightDecay' | 'valSplit';

/** 结构化定位目标：去处理只能导航/聚焦/选层，绝不修改配置。 */
export type TrainingPreflightTarget =
  | { kind: 'panel'; panelId: RightPanelId }
  | { kind: 'field'; fieldId: TrainFieldId }
  | { kind: 'layer'; layerId: string }
  | { kind: 'monitor' }
  | { kind: 'none' };

export interface TrainingPreflightIssue {
  /** 稳定唯一：code + 限定后缀（如 layerId）；同一输入下确定不变。 */
  id: string;
  code: TrainingPreflightIssueCode;
  severity: TrainingPreflightSeverity;
  category: TrainingPreflightCategory;
  title: string;
  /** 问题是什么、为什么阻断/提醒、去哪里处理。 */
  detail: string;
  target: TrainingPreflightTarget;
  source: 'live' | 'authoritative_start';
}

/** 纯检查输入：全部为值快照，不含 store/组件。 */
export interface TrainingPreflightInput {
  layers: ReadonlyArray<Layer3D>;
  validationErrors: ReadonlyArray<ShapeValidationError>;
  validationWarnings: ReadonlyArray<string>;
  dataset: DatasetInfo | null;
  splitStrategy: 'random' | 'group' | 'temporal';
  groupField: string | null;
  timeField: string | null;
  targetField: string | null;
  epochs: number;
  batchSize: number;
  learningRate: number;
  weightDecay: number;
  valSplit: number;
  isNativeRuntime: boolean;
  runtimeChecking: boolean;
  runtimeError: string | null;
  runtimeInfo: TrainingRuntimeInfo | null;
  auditPersistence: 'unavailable' | 'healthy' | 'degraded';
}

/** 验证后构建 TrainConfig 所需的派生结果：检查与配置必须共用同一套，不得各算一遍。 */
export interface TrainingPreflightDerived {
  /** CSV 训练特征列（已排除目标列与 group/time 元数据列）。 */
  featureFields?: string[];
  /** 从 Input 层派生的输入形状 [C, H, W]。 */
  inputShape?: [number, number, number];
}

export interface TrainingPreflightResult {
  status: 'checking' | 'blocked' | 'warning' | 'ready';
  issues: TrainingPreflightIssue[];
  blockers: TrainingPreflightIssue[];
  warnings: TrainingPreflightIssue[];
  /** 只由当前实时 blocker 与 checking 状态决定；历史启动错误不得永久合 canStart=false。 */
  canStart: boolean;
  derived: TrainingPreflightDerived;
}

const PANEL_TARGET = (panelId: RightPanelId): TrainingPreflightTarget => ({ kind: 'panel', panelId });

/**
 * 统一训练前检查：纯函数，确定性输出；不修改输入，不触发任何业务动作。
 * 不适用的检查不会产生问题项，也不会显示为“已通过”。
 */
export function evaluateTrainingPreflight(input: TrainingPreflightInput): TrainingPreflightResult {
  const issues: TrainingPreflightIssue[] = [];
  const push = (issue: Omit<TrainingPreflightIssue, 'source'>): void => {
    issues.push({ ...issue, source: 'live' });
  };
  const { dataset } = input;

  /* ---------- 运行环境（仅桌面原生环境检查；浏览器模拟降级为警告） ---------- */
  if (input.isNativeRuntime) {
    if (input.runtimeChecking || (!input.runtimeInfo && !input.runtimeError)) {
      // 正在检查 / 尚未取得检查结果（含首帧）：这不是“不可用”，不得误报。
      push({
        id: 'runtime_checking',
        code: 'runtime_checking',
        severity: 'blocker',
        category: 'runtime',
        title: '正在检查训练运行环境',
        detail: '桌面训练运行时自检尚未完成，请等待自检结果后再开始训练。',
        target: PANEL_TARGET('gpu'),
      });
    } else if (input.runtimeError || !input.runtimeInfo?.available) {
      // 明确失败：只有 runtimeError 非空，或已有 runtimeInfo 且 available=false，才算不可用。
      push({
        id: 'runtime_unavailable',
        code: 'runtime_unavailable',
        severity: 'blocker',
        category: 'runtime',
        title: '训练运行时不可用',
        detail: input.runtimeError
          ? `训练运行时不可用：${input.runtimeError}`
          : '训练运行时未通过能力自检，请在设备面板重新检测。',
        target: PANEL_TARGET('gpu'),
      });
    } else if (dataset?.type === 'csv' && input.runtimeInfo?.available && !input.runtimeInfo.csvRegressionAvailable) {
      // 明确成功（runtimeInfo 存在且 available）后才判断 CSV 回归能力。
      push({
        id: 'runtime_csv_dependency_missing',
        code: 'runtime_csv_dependency_missing',
        severity: 'blocker',
        category: 'runtime',
        title: 'CSV 回归依赖不可用',
        detail: '当前训练器缺少 CSV 回归依赖；请重新安装包含表格运行时的正式版本。',
        target: PANEL_TARGET('gpu'),
      });
    }
  } else {
    push({
      id: 'warn_simulation_mode',
      code: 'warn_simulation_mode',
      severity: 'warning',
      category: 'runtime',
      title: '浏览器演示模式',
      detail: '浏览器模拟不会产生可信执行证明，不代表受控可信训练；不阻止本次启动。',
      target: { kind: 'none' },
    });
  }

  /* ---------- 训练参数 ---------- */
  if (!Number.isInteger(input.epochs) || input.epochs < 1 || input.epochs > 50) {
    push({
      id: 'param_epochs_invalid',
      code: 'param_epochs_invalid',
      severity: 'blocker',
      category: 'parameters',
      title: 'Epochs 无效',
      detail: 'Epochs 必须是 1 到 50 的整数。',
      target: { kind: 'field', fieldId: 'epochs' },
    });
  }
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 512) {
    push({
      id: 'param_batch_invalid',
      code: 'param_batch_invalid',
      severity: 'blocker',
      category: 'parameters',
      title: 'Batch 无效',
      detail: 'Batch 必须是 1 到 512 的整数。',
      target: { kind: 'field', fieldId: 'batchSize' },
    });
  }
  if (!Number.isFinite(input.learningRate) || input.learningRate <= 0 || input.learningRate > 1) {
    push({
      id: 'param_lr_invalid',
      code: 'param_lr_invalid',
      severity: 'blocker',
      category: 'parameters',
      title: '学习率无效',
      detail: '学习率必须在 (0, 1] 范围内。',
      target: { kind: 'field', fieldId: 'learningRate' },
    });
  }
  if (!Number.isFinite(input.weightDecay) || input.weightDecay < 0 || input.weightDecay > 1) {
    push({
      id: 'param_weight_decay_invalid',
      code: 'param_weight_decay_invalid',
      severity: 'blocker',
      category: 'parameters',
      title: 'Weight Decay 无效',
      detail: 'Weight Decay 必须在 [0, 1] 范围内。',
      target: { kind: 'field', fieldId: 'weightDecay' },
    });
  }
  if (!Number.isFinite(input.valSplit) || input.valSplit <= 0 || input.valSplit > 0.5) {
    push({
      id: 'param_val_split_invalid',
      code: 'param_val_split_invalid',
      severity: 'blocker',
      category: 'parameters',
      title: '验证集比例无效',
      detail: '受控训练必须保留验证集（valSplit > 0）；测试集只能在冻结主张后解封。',
      target: { kind: 'field', fieldId: 'valSplit' },
    });
  }

  /* ---------- 数据与切分 ---------- */
  let csvFeatureFields: string[] | undefined;
  if (!dataset) {
    push({
      id: 'data_missing',
      code: 'data_missing',
      severity: 'blocker',
      category: 'data',
      title: '尚未导入数据',
      detail: '请先在数据集面板导入或选择数据集。',
      target: PANEL_TARGET('dataset'),
    });
  } else if (dataset.type === 'excel') {
    push({
      id: 'data_excel_unsupported',
      code: 'data_excel_unsupported',
      severity: 'blocker',
      category: 'data',
      title: 'Excel 暂不可训练',
      detail: '当前训练后端暂不支持 Excel，请先转换为 CSV 后导入。',
      target: PANEL_TARGET('dataset'),
    });
  } else {
    if (input.splitStrategy === 'group') {
      if (!input.groupField) {
        push({
          id: 'split_group_field_missing',
          code: 'split_group_field_missing',
          severity: 'blocker',
          category: 'split',
          title: 'group 切分缺少分组字段',
          detail: 'group 切分必须先在数据集面板选择分组字段。',
          target: PANEL_TARGET('dataset'),
        });
      }
      if (dataset.type === 'local_image' && !dataset.imageGroup?.available) {
        push({
          id: 'split_group_image_unavailable',
          code: 'split_group_image_unavailable',
          severity: 'blocker',
          category: 'split',
          title: '图像 group 身份不可用',
          detail: '当前图像目录不具备完整的 group 身份，请重新导入或整理为“类别/分组/图片”结构。',
          target: PANEL_TARGET('dataset'),
        });
      } else if (dataset.type === 'local_image' && dataset.imageGroup?.readinessWarning) {
        push({
          id: 'split_group_image_readiness',
          code: 'split_group_image_readiness',
          severity: 'blocker',
          category: 'split',
          title: '图像 group 切分存在风险',
          detail: dataset.imageGroup.readinessWarning,
          target: PANEL_TARGET('dataset'),
        });
      }
    }
    if (input.splitStrategy === 'temporal') {
      if (dataset.type !== 'csv') {
        push({
          id: 'split_temporal_non_csv',
          code: 'split_temporal_non_csv',
          severity: 'blocker',
          category: 'split',
          title: 'temporal 切分仅支持 CSV',
          detail: 'temporal 切分仅支持 CSV 数据集，请改用其他切分策略或更换数据。',
          target: PANEL_TARGET('dataset'),
        });
      }
      if (!input.timeField) {
        push({
          id: 'split_temporal_field_missing',
          code: 'split_temporal_field_missing',
          severity: 'blocker',
          category: 'split',
          title: 'temporal 切分缺少时间字段',
          detail: 'temporal 切分必须先在数据集面板选择真实时间字段。',
          target: PANEL_TARGET('dataset'),
        });
      }
    }

    if (dataset.type === 'csv') {
      const columns = dataset.columns ?? [];
      if (!input.targetField || !columns.includes(input.targetField)) {
        push({
          id: 'csv_target_missing',
          code: 'csv_target_missing',
          severity: 'blocker',
          category: 'data',
          title: 'CSV 目标列未确认',
          detail: '请先在数据集面板明确选择并确认回归目标列。',
          target: PANEL_TARGET('dataset'),
        });
      } else {
        if (dataset.nonNumericColumns?.includes(input.targetField)) {
          push({
            id: 'csv_target_non_numeric',
            code: 'csv_target_non_numeric',
            severity: 'blocker',
            category: 'data',
            title: 'CSV 目标列非数值',
            detail: `目标列“${input.targetField}”含缺失、文本或日期，不能作为数值回归目标。`,
            target: PANEL_TARGET('dataset'),
          });
        }
        // CSV 特征列排除规则的唯一来源：与 UI/experimentRuntime 共用 datasetContract，
        // 不在此处维护第二套 Set + filter。
        csvFeatureFields = deriveCsvFeatureFieldsFromColumns(columns, {
          splitStrategy: input.splitStrategy,
          groupField: input.groupField,
          timeField: input.timeField,
          targetField: input.targetField,
        });
        const nonNumericTrainingColumns = csvFeatureFields
          .filter(column => dataset.nonNumericColumns?.includes(column));
        if (nonNumericTrainingColumns.length > 0) {
          push({
            id: 'csv_feature_non_numeric',
            code: 'csv_feature_non_numeric',
            severity: 'blocker',
            category: 'data',
            title: 'CSV 特征列含非数值列',
            detail: `CSV 列 ${nonNumericTrainingColumns.join('、')} 含文本/日期，不能直接进入 MLP；请将其选为 group/time 切分字段，或先在源数据中完成数值编码。`,
            target: PANEL_TARGET('dataset'),
          });
        }
        const featureCount = csvFeatureFields.length;
        if (featureCount <= 0) {
          push({
            id: 'csv_feature_count_zero',
            code: 'csv_feature_count_zero',
            severity: 'blocker',
            category: 'data',
            title: 'CSV 没有可训练特征',
            detail: '排除目标列与元数据列后没有剩余特征；请在数据集面板检查列与切分字段选择。',
            target: PANEL_TARGET('dataset'),
          });
        } else {
          const inputLayer = input.layers.find(layer => layer.type === 'Input');
          const declaredFeatureCount = (inputLayer?.params.inChannels ?? 0)
            * (inputLayer?.params.inputHeight ?? 0)
            * (inputLayer?.params.inputWidth ?? 0);
          if (declaredFeatureCount !== featureCount) {
            push({
              id: 'csv_input_declaration_mismatch',
              code: 'csv_input_declaration_mismatch',
              severity: 'blocker',
              category: 'model',
              title: 'CSV 输入特征数与 Input 声明不一致',
              detail: `CSV 回归需要 ${featureCount} 个输入特征，但 Input 层声明为 ${declaredFeatureCount}；请在数据集面板重新选择切分字段并确认自动适配。`,
              target: inputLayer ? { kind: 'layer', layerId: inputLayer.id } : PANEL_TARGET('param'),
            });
          }
          // CSV 输出契约（末层 Linear 单值输出）不在此处手写：
          // 统一由下方 datasetOutputContractErrors 判断（单一权威来源）。
        }
      }
    }
  }

  /* ---------- 模型 ---------- */
  if (input.layers.length === 0) {
    push({
      id: 'model_empty',
      code: 'model_empty',
      severity: 'blocker',
      category: 'model',
      title: '没有网络层',
      detail: '请先在 3D 场景添加网络层，或在积木库选择经典模型。',
      target: PANEL_TARGET('param'),
    });
  }
  // 形状错误：id 含 code + layerId + errorType + 同一结构键下的稳定 occurrence，
  // 避免同一层多个错误产生重复 React key；不用中文 message 作为身份。
  const shapeOccurrences = new Map<string, number>();
  for (const error of input.validationErrors) {
    const occurrenceKey = `${error.layerId}:${error.errorType}`;
    const occurrence = shapeOccurrences.get(occurrenceKey) ?? 0;
    shapeOccurrences.set(occurrenceKey, occurrence + 1);
    push({
      id: `model_shape_error:${error.layerId}:${error.errorType}:${occurrence}`,
      code: 'model_shape_error',
      severity: 'blocker',
      category: 'model',
      title: '网络结构存在形状错误',
      detail: error.message,
      target: error.layerId ? { kind: 'layer', layerId: error.layerId } : PANEL_TARGET('param'),
    });
  }
  if (
    dataset?.type === 'csv'
    && input.layers.some(layer => layer.type === 'Conv2D' || layer.type === 'MaxPool2D' || layer.type === 'AvgPool2D')
  ) {
    push({
      id: 'csv_conv_layer_unsupported',
      code: 'csv_conv_layer_unsupported',
      severity: 'blocker',
      category: 'model',
      title: 'CSV 不支持卷积/池化层',
      detail: 'CSV 是表格数据，不支持卷积/池化层，请改用全连接结构。',
      target: PANEL_TARGET('param'),
    });
  }
  // 输出契约的单一权威来源：所有可训练监督任务（图片分类 / MNIST / CIFAR-10 / CSV 回归）
  // 都通过 datasetOutputContractErrors 判断；触发条件、真实 layerId、错误说明均来自该函数，
  // 仅按 dataset.type 映射 issue code（excel 由该函数自身返回空，不会产生问题项）。
  if (dataset) {
    const contractCode: TrainingPreflightIssueCode = dataset.type === 'csv'
      ? 'csv_output_not_single'
      : 'model_output_contract';
    for (const error of datasetOutputContractErrors([...input.layers], dataset)) {
      push({
        id: `${contractCode}:${error.layerId || 'missing'}`,
        code: contractCode,
        severity: 'blocker',
        category: 'model',
        title: dataset.type === 'csv' ? 'CSV 回归输出必须为单值' : '输出层与数据任务不匹配',
        detail: error.message,
        target: error.layerId ? { kind: 'layer', layerId: error.layerId } : PANEL_TARGET('param'),
      });
    }
  }

  /* ---------- 警告：不阻止启动，只提醒既有事实 ---------- */
  input.validationWarnings.forEach((warning, index) => {
    push({
      id: `warn_model_validation:${index}`,
      code: 'warn_model_validation',
      severity: 'warning',
      category: 'model',
      title: '结构校验警告',
      detail: warning,
      target: PANEL_TARGET('param'),
    });
  });
  if (input.auditPersistence === 'degraded') {
    push({
      id: 'warn_audit_degraded',
      code: 'warn_audit_degraded',
      severity: 'warning',
      category: 'study',
      title: '审计持久化降级',
      detail: '只追加审计链尚未恢复健康；训练可能运行，但档案完整性不能背书。不阻止本次启动。',
      target: PANEL_TARGET('study'),
    });
  }

  /* ---------- 派生结果（供 TrainConfig 复用，不二次计算） ---------- */
  const derived: TrainingPreflightDerived = {};
  if (csvFeatureFields) derived.featureFields = csvFeatureFields;
  const inputLayer = input.layers.find(layer => layer.type === 'Input');
  if (
    inputLayer
    && inputLayer.params.inChannels != null
    && inputLayer.params.inputHeight != null
    && inputLayer.params.inputWidth != null
  ) {
    derived.inputShape = [inputLayer.params.inChannels, inputLayer.params.inputHeight, inputLayer.params.inputWidth];
  }

  /* ---------- 结果语义 ---------- */
  const blockers = issues.filter(issue => issue.severity === 'blocker');
  const warnings = issues.filter(issue => issue.severity === 'warning');
  const checking = blockers.some(issue => issue.code === 'runtime_checking');
  const status: TrainingPreflightResult['status'] = checking
    ? 'checking'
    : blockers.length > 0
      ? 'blocked'
      : warnings.length > 0
        ? 'warning'
        : 'ready';
  return {
    status,
    issues,
    blockers,
    warnings,
    canStart: status === 'ready' || status === 'warning',
    derived,
  };
}
