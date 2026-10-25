import { describe, expect, it } from 'vitest';
import {
  datasetOutputContractErrors,
  evaluateTrainingPreflight,
  type TrainingPreflightInput,
  type TrainingPreflightIssueCode,
} from '@/utils/trainingPreflight';
import type { DatasetInfo } from '@/types/dataset';
import type { Layer3D, LayerParams, LayerType, ShapeValidationError } from '@/types/layer';
import type { TrainingRuntimeInfo } from '@/types/gpu';

/* ---------------- 夹具构造 ---------------- */

let layerSeq = 0;

function makeLayer(type: LayerType, params: LayerParams, order: number): Layer3D {
  layerSeq += 1;
  return {
    id: `layer-${layerSeq}`,
    type,
    params,
    order,
    position: [0, order * 2, 0],
    outputShape: null,
    paramCount: 0,
    validationError: null,
  };
}

function mnistLayers(): Layer3D[] {
  return [
    makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
    makeLayer('Flatten', {}, 1),
    makeLayer('Linear', { inFeatures: 784, outFeatures: 10 }, 2),
  ];
}

function csvLayers(): Layer3D[] {
  // 2 个特征：Input 声明 1×1×2，最后一个 Linear 单值输出
  return [
    makeLayer('Input', { inChannels: 1, inputHeight: 1, inputWidth: 2 }, 0),
    makeLayer('Flatten', {}, 1),
    makeLayer('Linear', { inFeatures: 2, outFeatures: 1 }, 2),
  ];
}

function makeDataset(overrides: Partial<DatasetInfo> = {}): DatasetInfo {
  return { name: 'MNIST', type: 'mnist', sampleCount: 70000, classCount: 10, ...overrides };
}

function makeCsvDataset(overrides: Partial<DatasetInfo> = {}): DatasetInfo {
  return {
    name: '回归数据',
    type: 'csv',
    sampleCount: 100,
    classCount: 1,
    columns: ['a', 'b', 'y'],
    nonNumericColumns: [],
    ...overrides,
  };
}

function makeRuntimeInfo(overrides: Partial<TrainingRuntimeInfo> = {}): TrainingRuntimeInfo {
  return {
    available: true,
    source: 'bundled',
    pythonVersion: '3.12',
    torchVersion: '2.7',
    cudaBuildVersion: null,
    cudaAvailable: false,
    cudaDeviceName: null,
    imageClassificationAvailable: true,
    csvRegressionAvailable: true,
    issues: [],
    ...overrides,
  };
}

/** 就绪基线：MNIST + 合法 MLP + 浏览器环境（无运行时检查）。 */
function makeInput(overrides: Partial<TrainingPreflightInput> = {}): TrainingPreflightInput {
  return {
    layers: mnistLayers(),
    validationErrors: [],
    validationWarnings: [],
    dataset: makeDataset(),
    splitStrategy: 'random',
    groupField: null,
    timeField: null,
    targetField: null,
    epochs: 5,
    batchSize: 32,
    learningRate: 0.001,
    weightDecay: 0,
    valSplit: 0.2,
    isNativeRuntime: false,
    runtimeChecking: false,
    runtimeError: null,
    runtimeInfo: null,
    auditPersistence: 'unavailable',
    ...overrides,
  };
}

function codes(result: { issues: Array<{ code: TrainingPreflightIssueCode }> }): TrainingPreflightIssueCode[] {
  return result.issues.map(issue => issue.code);
}

/* ---------------- 数据与模型 ---------------- */

describe('训练前检查：数据和模型', () => {
  it('1. 无数据 → data_missing 阻断', () => {
    const result = evaluateTrainingPreflight(makeInput({ dataset: null }));
    expect(codes(result)).toContain('data_missing');
    expect(result.canStart).toBe(false);
    const issue = result.issues.find(item => item.code === 'data_missing');
    expect(issue?.category).toBe('data');
    expect(issue?.target).toEqual({ kind: 'panel', panelId: 'dataset' });
  });

  it('2. 无网络层 → model_empty 阻断', () => {
    const result = evaluateTrainingPreflight(makeInput({ layers: [] }));
    expect(codes(result)).toContain('model_empty');
    expect(result.canStart).toBe(false);
  });

  it('3. 结构 validation error → model_shape_error 阻断', () => {
    const error: ShapeValidationError = {
      layerId: 'layer-x',
      layerType: 'Linear',
      errorType: 'param_conflict',
      message: 'Linear 输入特征不匹配：inFeatures=128，但上游输出为 [784]',
      suggestion: '将 inFeatures 修改为 784',
      expectedInputShape: [784],
      actualInputShape: [128],
    };
    const result = evaluateTrainingPreflight(makeInput({ validationErrors: [error] }));
    expect(codes(result)).toContain('model_shape_error');
    expect(result.canStart).toBe(false);
  });

  it('4. 多个结构错误一次性全部展示，不只返回第一个', () => {
    const errors: ShapeValidationError[] = [0, 1].map(index => ({
      layerId: `layer-e${index}`,
      layerType: 'Linear',
      errorType: 'param_conflict',
      message: `错误 ${index}`,
      suggestion: '修复',
      expectedInputShape: null,
      actualInputShape: null,
    }));
    const result = evaluateTrainingPreflight(makeInput({ validationErrors: errors }));
    const shapeIssues = result.issues.filter(issue => issue.code === 'model_shape_error');
    expect(shapeIssues).toHaveLength(2);
  });

  it('5. 分类输出层数量错误 → model_output_contract', () => {
    const layers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
      makeLayer('Flatten', {}, 1),
      makeLayer('Linear', { inFeatures: 784, outFeatures: 5 }, 2),
    ];
    const result = evaluateTrainingPreflight(makeInput({ layers }));
    expect(codes(result)).toContain('model_output_contract');
    expect(result.canStart).toBe(false);
  });

  it('6. CSV 最终输出不是 1 → csv_output_not_single', () => {
    const layers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 1, inputWidth: 2 }, 0),
      makeLayer('Flatten', {}, 1),
      makeLayer('Linear', { inFeatures: 2, outFeatures: 3 }, 2),
    ];
    const result = evaluateTrainingPreflight(makeInput({
      layers,
      dataset: makeCsvDataset(),
      targetField: 'y',
    }));
    expect(codes(result)).toContain('csv_output_not_single');
  });

  it('7. CSV 使用卷积/池化 → csv_conv_layer_unsupported', () => {
    const layers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 1, inputWidth: 2 }, 0),
      makeLayer('Conv2D', { inChannels: 1, outChannels: 4, kernelSize: 3 }, 1),
      makeLayer('Flatten', {}, 2),
      makeLayer('Linear', { inFeatures: 2, outFeatures: 1 }, 3),
    ];
    const result = evaluateTrainingPreflight(makeInput({
      layers,
      dataset: makeCsvDataset(),
      targetField: 'y',
    }));
    expect(codes(result)).toContain('csv_conv_layer_unsupported');
  });

  it('8. datasetOutputContractErrors 继续作为输出契约来源（文案一致）', () => {
    const dataset = makeDataset({ type: 'local_image', name: '自定义', classCount: 2 });
    const layers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
      makeLayer('Flatten', {}, 1),
      makeLayer('Linear', { inFeatures: 784, outFeatures: 5 }, 2),
    ];
    const contractError = datasetOutputContractErrors(layers, dataset)[0];
    expect(contractError).toBeTruthy();
    const result = evaluateTrainingPreflight(makeInput({ layers, dataset }));
    const issue = result.issues.find(item => item.code === 'model_output_contract');
    expect(issue?.detail).toBe(contractError.message);
  });

  it('9. 有 layerId 的问题生成 layer target', () => {
    const error: ShapeValidationError = {
      layerId: 'layer-target',
      layerType: 'Conv2D',
      errorType: 'param_conflict',
      message: 'Conv2D 输入通道不匹配',
      suggestion: '修改 inChannels',
      expectedInputShape: [1, 28, 28],
      actualInputShape: [3, 28, 28],
    };
    const result = evaluateTrainingPreflight(makeInput({ validationErrors: [error] }));
    const issue = result.issues.find(item => item.code === 'model_shape_error');
    expect(issue?.target).toEqual({ kind: 'layer', layerId: 'layer-target' });
  });
});

/* ---------------- CSV ---------------- */

describe('训练前检查：CSV', () => {
  it('10. 未选择目标列 → csv_target_missing', () => {
    const result = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset(),
      targetField: null,
    }));
    expect(codes(result)).toContain('csv_target_missing');
  });

  it('11. 目标列不存在 → csv_target_missing', () => {
    const result = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset(),
      targetField: 'not-a-column',
    }));
    expect(codes(result)).toContain('csv_target_missing');
  });

  it('12. 目标列非数值 → csv_target_non_numeric', () => {
    const result = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset({ nonNumericColumns: ['y'] }),
      targetField: 'y',
    }));
    expect(codes(result)).toContain('csv_target_non_numeric');
  });

  it('13. 特征列含非数值列 → csv_feature_non_numeric', () => {
    const result = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset({ nonNumericColumns: ['b'] }),
      targetField: 'y',
    }));
    expect(codes(result)).toContain('csv_feature_non_numeric');
  });

  it('14. 特征列数量为 0 → csv_feature_count_zero', () => {
    const result = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset({ columns: ['y'] }),
      targetField: 'y',
    }));
    expect(codes(result)).toContain('csv_feature_count_zero');
  });

  it('15. group/time 元数据列按现行规则排除出训练特征（与 QuickTrain 原逻辑一致）', () => {
    // group 策略：排除目标列 + groupField（timeField 不参与排除，与原实现一致）
    const groupResult = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset({ columns: ['a', 'b', 'g', 't', 'y'] }),
      targetField: 'y',
      splitStrategy: 'group',
      groupField: 'g',
    }));
    expect(groupResult.derived.featureFields).toEqual(['a', 'b', 't']);
    // temporal 策略：排除目标列 + timeField；且特征列需与 Input 声明一致
    const temporalLayers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 1, inputWidth: 3 }, 0),
      makeLayer('Flatten', {}, 1),
      makeLayer('Linear', { inFeatures: 3, outFeatures: 1 }, 2),
    ];
    const temporalResult = evaluateTrainingPreflight(makeInput({
      layers: temporalLayers,
      dataset: makeCsvDataset({ columns: ['a', 'b', 'g', 't', 'y'] }),
      targetField: 'y',
      splitStrategy: 'temporal',
      timeField: 't',
    }));
    expect(temporalResult.derived.featureFields).toEqual(['a', 'b', 'g']);
  });

  it('16. Input 声明与特征数不一致 → csv_input_declaration_mismatch', () => {
    const layers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 1, inputWidth: 5 }, 0),
      makeLayer('Flatten', {}, 1),
      makeLayer('Linear', { inFeatures: 2, outFeatures: 1 }, 2),
    ];
    const result = evaluateTrainingPreflight(makeInput({
      layers,
      dataset: makeCsvDataset(),
      targetField: 'y',
    }));
    expect(codes(result)).toContain('csv_input_declaration_mismatch');
  });

  it('17-18. 正确 CSV 配置：derived.featureFields 确定且与 TrainConfig 共用同一结果', () => {
    const input = makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset(),
      targetField: 'y',
    });
    const first = evaluateTrainingPreflight(input);
    const second = evaluateTrainingPreflight(input);
    expect(first.derived.featureFields).toEqual(['a', 'b']);
    expect(second.derived.featureFields).toEqual(first.derived.featureFields);
    expect(first.canStart).toBe(true);
  });
});

/* ---------------- 切分 ---------------- */

describe('训练前检查：切分', () => {
  it('19. group 无字段 → split_group_field_missing', () => {
    const result = evaluateTrainingPreflight(makeInput({ splitStrategy: 'group', groupField: null }));
    expect(codes(result)).toContain('split_group_field_missing');
  });

  it('20. group 图片身份不可用 → split_group_image_unavailable', () => {
    const result = evaluateTrainingPreflight(makeInput({
      dataset: makeDataset({ type: 'local_image', imageGroup: { field: '__image_parent_directory__', label: '分组', distinctCount: 0, groupedSampleCount: 0, groupsPerClass: {}, available: false } }),
      splitStrategy: 'group',
      groupField: '__image_parent_directory__',
    }));
    expect(codes(result)).toContain('split_group_image_unavailable');
  });

  it('21. group 图像就绪警告 → split_group_image_readiness', () => {
    const result = evaluateTrainingPreflight(makeInput({
      dataset: makeDataset({
        type: 'local_image',
        imageGroup: { field: '__image_parent_directory__', label: '分组', distinctCount: 2, groupedSampleCount: 10, groupsPerClass: {}, available: true, readinessWarning: '分组过少，三路划分很可能无效' },
      }),
      splitStrategy: 'group',
      groupField: '__image_parent_directory__',
    }));
    expect(codes(result)).toContain('split_group_image_readiness');
    expect(result.canStart).toBe(false);
  });

  it('22. temporal 用于图片数据 → split_temporal_non_csv', () => {
    const result = evaluateTrainingPreflight(makeInput({ splitStrategy: 'temporal', timeField: 'ts' }));
    expect(codes(result)).toContain('split_temporal_non_csv');
  });

  it('23. temporal 没有 timeField → split_temporal_field_missing', () => {
    const result = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset(),
      targetField: 'y',
      splitStrategy: 'temporal',
      timeField: null,
    }));
    expect(codes(result)).toContain('split_temporal_field_missing');
  });

  it('24. 内置 MNIST/CIFAR-10 的 predefined 语义不被误报', () => {
    for (const type of ['mnist', 'cifar10'] as const) {
      const result = evaluateTrainingPreflight(makeInput({
        dataset: makeDataset({ type }),
        splitStrategy: 'random',
      }));
      expect(result.issues.some(issue => issue.category === 'split')).toBe(false);
    }
  });

  it('25-28. valSplit 非法值（NaN / Infinity / 0 / >0.5）均阻断', () => {
    for (const valSplit of [Number.NaN, Number.POSITIVE_INFINITY, 0, 0.6]) {
      const result = evaluateTrainingPreflight(makeInput({ valSplit }));
      expect(codes(result)).toContain('param_val_split_invalid');
      expect(result.canStart).toBe(false);
    }
  });
});

/* ---------------- 参数 ---------------- */

describe('训练前检查：参数', () => {
  it('29. epochs 非整数/越界 → 阻断', () => {
    for (const epochs of [0, 51, 2.5, Number.NaN]) {
      expect(codes(evaluateTrainingPreflight(makeInput({ epochs })))).toContain('param_epochs_invalid');
    }
  });

  it('30. batchSize 非整数/越界 → 阻断', () => {
    for (const batchSize of [0, 513, 2.5, Number.NaN]) {
      expect(codes(evaluateTrainingPreflight(makeInput({ batchSize })))).toContain('param_batch_invalid');
    }
  });

  it('31. learningRate 非有限/越界 → 阻断', () => {
    for (const learningRate of [0, -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codes(evaluateTrainingPreflight(makeInput({ learningRate })))).toContain('param_lr_invalid');
    }
  });

  it('32. weightDecay 非有限/越界 → 阻断', () => {
    for (const weightDecay of [-0.1, 1.5, Number.NaN]) {
      expect(codes(evaluateTrainingPreflight(makeInput({ weightDecay })))).toContain('param_weight_decay_invalid');
    }
  });

  it('33. 合法边界值全部通过', () => {
    const boundaries: Array<Partial<TrainingPreflightInput>> = [
      { epochs: 1 },
      { epochs: 50 },
      { batchSize: 1 },
      { batchSize: 512 },
      { learningRate: 1 },
      { learningRate: 0.000001 },
      { weightDecay: 0 },
      { weightDecay: 1 },
      { valSplit: 0.05 },
      { valSplit: 0.5 },
    ];
    for (const override of boundaries) {
      const result = evaluateTrainingPreflight(makeInput(override));
      expect(result.canStart, JSON.stringify(override)).toBe(true);
      expect(result.blockers).toHaveLength(0);
    }
  });
});

/* ---------------- 运行环境 ---------------- */

describe('训练前检查：运行环境', () => {
  it('34. runtime checking → status=checking 且 canStart=false', () => {
    const result = evaluateTrainingPreflight(makeInput({ isNativeRuntime: true, runtimeChecking: true }));
    expect(result.status).toBe('checking');
    expect(result.canStart).toBe(false);
    expect(result.status).not.toBe('ready');
  });

  it('35. runtime 明确失败（error 非空 / info.available=false）→ unavailable', () => {
    const withError = evaluateTrainingPreflight(makeInput({ isNativeRuntime: true, runtimeError: 'torch 缺失' }));
    expect(codes(withError)).toContain('runtime_unavailable');
    expect(withError.status).toBe('blocked');

    const notAvailable = evaluateTrainingPreflight(makeInput({
      isNativeRuntime: true,
      runtimeInfo: makeRuntimeInfo({ available: false }),
    }));
    expect(codes(notAvailable)).toContain('runtime_unavailable');
  });

  it('35b. 原生首帧（info=null、checking=false、error=null）→ checking，不误报不可用', () => {
    const result = evaluateTrainingPreflight(makeInput({
      isNativeRuntime: true,
      runtimeInfo: null,
      runtimeChecking: false,
      runtimeError: null,
    }));
    expect(codes(result)).toContain('runtime_checking');
    expect(codes(result)).not.toContain('runtime_unavailable');
    expect(result.status).toBe('checking');
    expect(result.canStart).toBe(false);
  });

  it('35c. runtimeInfo 已成功返回（available）→ 不产生 unavailable', () => {
    const result = evaluateTrainingPreflight(makeInput({
      isNativeRuntime: true,
      runtimeInfo: makeRuntimeInfo(),
    }));
    expect(codes(result)).not.toContain('runtime_unavailable');
    expect(codes(result)).not.toContain('runtime_checking');
  });

  it('35d. CSV 回归能力只在 runtimeInfo 成功返回后判断（首帧不误判依赖缺失）', () => {
    // 首帧：info 未返回，即使 CSV 也不得判定依赖缺失，而是 checking
    const firstFrame = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset(),
      targetField: 'y',
      isNativeRuntime: true,
      runtimeInfo: null,
      runtimeChecking: false,
      runtimeError: null,
    }));
    expect(codes(firstFrame)).toContain('runtime_checking');
    expect(codes(firstFrame)).not.toContain('runtime_csv_dependency_missing');

    // 成功后：能力缺失才阻断；能力具备则无该项
    const missing = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset(),
      targetField: 'y',
      isNativeRuntime: true,
      runtimeInfo: makeRuntimeInfo({ csvRegressionAvailable: false }),
    }));
    expect(codes(missing)).toContain('runtime_csv_dependency_missing');

    const ok = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset(),
      targetField: 'y',
      isNativeRuntime: true,
      runtimeInfo: makeRuntimeInfo(),
    }));
    expect(codes(ok)).not.toContain('runtime_csv_dependency_missing');
  });

  it('36. CSV 回归依赖缺失 → blocker', () => {
    const result = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset(),
      targetField: 'y',
      isNativeRuntime: true,
      runtimeInfo: makeRuntimeInfo({ csvRegressionAvailable: false }),
    }));
    expect(codes(result)).toContain('runtime_csv_dependency_missing');
  });

  it('37. 合法桌面运行时通过，无运行时问题项', () => {
    const result = evaluateTrainingPreflight(makeInput({
      isNativeRuntime: true,
      runtimeInfo: makeRuntimeInfo(),
    }));
    expect(result.issues.filter(issue => issue.category === 'runtime')).toHaveLength(0);
    expect(result.canStart).toBe(true);
  });

  it('38. 浏览器模拟显示 warning 但不阻断', () => {
    const result = evaluateTrainingPreflight(makeInput({ isNativeRuntime: false }));
    expect(codes(result)).toContain('warn_simulation_mode');
    expect(result.status).toBe('warning');
    expect(result.canStart).toBe(true);
  });
});

/* ---------------- 结果语义 ---------------- */

describe('训练前检查：结果语义', () => {
  it('39-40. blockerCount / warningCount 正确', () => {
    const result = evaluateTrainingPreflight(makeInput({
      dataset: null,
      layers: [],
      epochs: 0,
      validationWarnings: ['输出形状异常'],
    }));
    expect(result.blockers.length).toBeGreaterThanOrEqual(3);
    expect(result.blockers).toHaveLength(result.issues.filter(issue => issue.severity === 'blocker').length);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toHaveLength(result.issues.filter(issue => issue.severity === 'warning').length);
  });

  it('41. 有 blocker 时 canStart=false', () => {
    const result = evaluateTrainingPreflight(makeInput({ dataset: null }));
    expect(result.status).toBe('blocked');
    expect(result.canStart).toBe(false);
  });

  it('42. 只有 warning 时 canStart=true', () => {
    const result = evaluateTrainingPreflight(makeInput({ validationWarnings: ['警告'] }));
    expect(result.status).toBe('warning');
    expect(result.canStart).toBe(true);
  });

  it('43. checking 时 canStart=false', () => {
    const result = evaluateTrainingPreflight(makeInput({ isNativeRuntime: true, runtimeChecking: true }));
    expect(result.canStart).toBe(false);
  });

  it('44. 无问题时 ready（浏览器环境含模拟警告则 warning）', () => {
    const native = evaluateTrainingPreflight(makeInput({ isNativeRuntime: true, runtimeInfo: makeRuntimeInfo() }));
    expect(native.status).toBe('ready');
    expect(native.canStart).toBe(true);
  });

  it('45. 不适用的检查不显示为通过，也不存在问题项', () => {
    const result = evaluateTrainingPreflight(makeInput());
    // 非 CSV：所有 csv_* 检查不适用，issues 中完全不出现
    expect(result.issues.some(issue => issue.code.startsWith('csv_'))).toBe(false);
    // 浏览器环境：运行时检查不适用
    expect(result.issues.some(issue => issue.code.startsWith('runtime_'))).toBe(false);
  });

  it('46-47. issue id 稳定；不用 message 作为身份（同 code 不同层 id 不同）', () => {
    const errors: ShapeValidationError[] = ['l1', 'l2'].map(layerId => ({
      layerId,
      layerType: 'Linear',
      errorType: 'param_conflict',
      message: '同一个错误文案',
      suggestion: '',
      expectedInputShape: null,
      actualInputShape: null,
    }));
    const input = makeInput({ validationErrors: errors });
    const first = evaluateTrainingPreflight(input);
    const second = evaluateTrainingPreflight(input);
    expect(first.issues.map(issue => issue.id)).toEqual(second.issues.map(issue => issue.id));
    const shapeIssues = first.issues.filter(issue => issue.code === 'model_shape_error');
    expect(new Set(shapeIssues.map(issue => issue.id)).size).toBe(2);
    for (const issue of first.issues) {
      expect(issue.id.startsWith(issue.code)).toBe(true);
    }
  });

  it('48. 输入对象不被修改', () => {
    const input = makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset(),
      targetField: 'y',
    });
    const before = JSON.parse(JSON.stringify(input));
    evaluateTrainingPreflight(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(before);
  });

  it('49. 相同输入得到确定性相同结果', () => {
    const input = makeInput({ validationWarnings: ['警告'] });
    expect(evaluateTrainingPreflight(input)).toEqual(evaluateTrainingPreflight(input));
  });

  it('审计降级只产生警告，不阻断', () => {
    const result = evaluateTrainingPreflight(makeInput({
      isNativeRuntime: true,
      runtimeInfo: makeRuntimeInfo(),
      auditPersistence: 'degraded',
    }));
    expect(codes(result)).toContain('warn_audit_degraded');
    expect(result.canStart).toBe(true);
    const issue = result.issues.find(item => item.code === 'warn_audit_degraded');
    expect(issue?.severity).toBe('warning');
    expect(issue?.target).toEqual({ kind: 'panel', panelId: 'study' });
  });
});

/* ---------------- 输出契约单一权威来源（验收补丁） ---------------- */

describe('训练前检查：输出契约单源化', () => {
  it('CSV 缺少 Linear：只产生一个统一输出契约问题（不重复）', () => {
    const layers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 1, inputWidth: 2 }, 0),
      makeLayer('Flatten', {}, 1),
    ];
    const result = evaluateTrainingPreflight(makeInput({
      layers,
      dataset: makeCsvDataset(),
      targetField: 'y',
    }));
    const contractIssues = result.issues.filter(issue =>
      issue.code === 'csv_output_not_single' || issue.code === 'model_output_contract');
    expect(contractIssues).toHaveLength(1);
    expect(contractIssues[0].code).toBe('csv_output_not_single');
    // 缺 Linear 时统一函数返回空 layerId → 定位参数面板；文案来自统一函数（含建议）
    expect(contractIssues[0].target).toEqual({ kind: 'panel', panelId: 'param' });
    expect(contractIssues[0].detail).toContain('Linear');
    // 不与 shape error 重复
    expect(result.issues.filter(issue => issue.code === 'model_shape_error')).toHaveLength(0);
  });

  it('CSV outFeatures≠1：只产生一个问题，layer target 来自统一函数的真实 layerId', () => {
    const layers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 1, inputWidth: 2 }, 0),
      makeLayer('Flatten', {}, 1),
      makeLayer('Linear', { inFeatures: 2, outFeatures: 3 }, 2),
    ];
    const result = evaluateTrainingPreflight(makeInput({
      layers,
      dataset: makeCsvDataset(),
      targetField: 'y',
    }));
    const contractIssues = result.issues.filter(issue =>
      issue.code === 'csv_output_not_single' || issue.code === 'model_output_contract');
    expect(contractIssues).toHaveLength(1);
    expect(contractIssues[0].code).toBe('csv_output_not_single');
    expect(contractIssues[0].target).toEqual({ kind: 'layer', layerId: layers[2].id });
    // 文案来自 datasetOutputContractErrors（含当前 outFeatures 与建议）
    expect(contractIssues[0].detail).toContain('outFeatures=1');
    expect(result.issues.filter(issue => issue.code === 'model_shape_error')).toHaveLength(0);
  });

  it('CSV outFeatures=1：不产生输出契约问题', () => {
    const result = evaluateTrainingPreflight(makeInput({
      layers: csvLayers(),
      dataset: makeCsvDataset(),
      targetField: 'y',
    }));
    expect(result.issues.filter(issue =>
      issue.code === 'csv_output_not_single' || issue.code === 'model_output_contract')).toHaveLength(0);
  });

  it('分类输出数量不匹配继续正常（model_output_contract，含真实 layerId）', () => {
    const layers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
      makeLayer('Flatten', {}, 1),
      makeLayer('Linear', { inFeatures: 784, outFeatures: 5 }, 2),
    ];
    const result = evaluateTrainingPreflight(makeInput({ layers }));
    const contractIssues = result.issues.filter(issue => issue.code === 'model_output_contract');
    expect(contractIssues).toHaveLength(1);
    expect(contractIssues[0].target).toEqual({ kind: 'layer', layerId: layers[2].id });
    expect(contractIssues[0].detail).toContain('10 个类别');
    expect(result.issues.filter(issue => issue.code === 'csv_output_not_single')).toHaveLength(0);
  });
});

/* ---------------- Issue ID 稳定性补强 ---------------- */

describe('训练前检查：Issue ID 稳定性', () => {
  it('同一 layerId 的两个不同 errorType → 不同 id', () => {
    const errors: ShapeValidationError[] = [
      {
        layerId: 'layer-a', layerType: 'Linear', errorType: 'param_conflict',
        message: '错误甲', suggestion: '', expectedInputShape: null, actualInputShape: null,
      },
      {
        layerId: 'layer-a', layerType: 'Linear', errorType: 'missing_flatten',
        message: '错误乙', suggestion: '', expectedInputShape: null, actualInputShape: null,
      },
    ];
    const result = evaluateTrainingPreflight(makeInput({ validationErrors: errors }));
    const ids = result.issues.filter(issue => issue.code === 'model_shape_error').map(issue => issue.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('同一 layerId、同一 errorType 的两个错误 → 不同 id（稳定 occurrence）', () => {
    const errors: ShapeValidationError[] = [0, 1].map(() => ({
      layerId: 'layer-a', layerType: 'Linear', errorType: 'param_conflict',
      message: '同构错误', suggestion: '', expectedInputShape: null, actualInputShape: null,
    }));
    const result = evaluateTrainingPreflight(makeInput({ validationErrors: errors }));
    const ids = result.issues.filter(issue => issue.code === 'model_shape_error').map(issue => issue.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('相同输入重复计算 → id 完全一致；不同错误不产生相同 id', () => {
    const errors: ShapeValidationError[] = [
      {
        layerId: 'layer-a', layerType: 'Linear', errorType: 'param_conflict',
        message: '错误甲', suggestion: '', expectedInputShape: null, actualInputShape: null,
      },
      {
        layerId: 'layer-a', layerType: 'Linear', errorType: 'param_conflict',
        message: '错误乙', suggestion: '', expectedInputShape: null, actualInputShape: null,
      },
      {
        layerId: 'layer-b', layerType: 'Conv2D', errorType: 'shape_mismatch',
        message: '错误丙', suggestion: '', expectedInputShape: null, actualInputShape: null,
      },
    ];
    const input = makeInput({ validationErrors: errors });
    const first = evaluateTrainingPreflight(input);
    const second = evaluateTrainingPreflight(input);
    const firstIds = first.issues.map(issue => issue.id);
    expect(second.issues.map(issue => issue.id)).toEqual(firstIds);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    // id 不含中文 message
    for (const id of firstIds) {
      expect(id).not.toContain('错误');
    }
  });

  it('validation warning 的 id 顺序稳定且无重复', () => {
    const input = makeInput({ validationWarnings: ['警告一', '警告二', '警告三'] });
    const first = evaluateTrainingPreflight(input);
    const second = evaluateTrainingPreflight(input);
    const warningIds = (result: ReturnType<typeof evaluateTrainingPreflight>) =>
      result.issues.filter(issue => issue.code === 'warn_model_validation').map(issue => issue.id);
    expect(warningIds(first)).toEqual(warningIds(second));
    expect(new Set(warningIds(first)).size).toBe(3);
  });
});
