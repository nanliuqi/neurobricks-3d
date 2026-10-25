/**
 * N3 集成证据：非法参数从真实 store 推导链一路走到训练前检查。
 * 这里不重新实现任何数值判断，只验证既有链路会记录错误、能被 Preflight
 * 消费成阻断项，并在参数改回合法后一起恢复。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { useLayerStore } from '@/stores/useLayerStore';
import { evaluateTrainingPreflight, type TrainingPreflightInput } from '@/utils/trainingPreflight';
import type { DatasetInfo } from '@/types/dataset';
import type { Layer3D, LayerParams, LayerType } from '@/types/layer';

function draftLayer(id: string, type: LayerType, order: number, params: LayerParams = {}): Layer3D {
  return {
    id,
    type,
    params,
    order,
    position: [0, order, 0],
    outputShape: null,
    paramCount: 0,
    validationError: null,
  };
}

/** 合法基线：Input → Conv2D → Flatten → Linear(10)，MNIST 10 类。 */
function legalLayers(): Layer3D[] {
  return [
    draftLayer('input-1', 'Input', 0, { inChannels: 1, inputHeight: 28, inputWidth: 28 }),
    draftLayer('conv-1', 'Conv2D', 1, { inChannels: 1, outChannels: 8, kernelSize: 3, stride: 1, padding: 1 }),
    draftLayer('flatten-1', 'Flatten', 2, {}),
    draftLayer('linear-1', 'Linear', 3, { inFeatures: 6272, outFeatures: 10 }),
  ];
}

function mnistDataset(): DatasetInfo {
  return { name: 'MNIST', type: 'mnist', sampleCount: 70000, classCount: 10 };
}

/** 输入构造与 QuickTrain 的真实接线一致：layers + validationResult.errors。 */
function preflightInput(overrides: Partial<TrainingPreflightInput> = {}): TrainingPreflightInput {
  const state = useLayerStore.getState();
  return {
    layers: state.layers,
    validationErrors: state.validationResult.errors,
    validationWarnings: state.validationResult.warnings,
    dataset: mnistDataset(),
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

function seed(layers: Layer3D[]) {
  act(() => {
    useLayerStore.getState().setLayers(layers);
  });
}

beforeEach(() => {
  useLayerStore.setState({ ...useLayerStore.getInitialState() });
});

describe('形状合法性 → 结构校验 → 训练前检查', () => {
  it('合法基线可启动，作为后续对照', () => {
    seed(legalLayers());
    const state = useLayerStore.getState();
    expect(state.hasShapeError).toBe(false);
    expect(state.validationResult.errors).toHaveLength(0);
    const result = evaluateTrainingPreflight(preflightInput());
    expect(result.canStart).toBe(true);
    expect(result.issues.filter(issue => issue.code === 'model_shape_error')).toHaveLength(0);
  });

  it('非数值 kernelSize 让 store 记录带真实层 ID 的错误，并被 Preflight 阻断', () => {
    const layers = legalLayers();
    layers[1] = draftLayer('conv-1', 'Conv2D', 1, {
      inChannels: 1,
      outChannels: 8,
      kernelSize: 'three' as unknown as number,
      stride: 1,
      padding: 1,
    });
    seed(layers);

    const state = useLayerStore.getState();
    expect(state.layers.find(layer => layer.id === 'conv-1')?.outputShape).toBeNull();
    expect(state.hasShapeError).toBe(true);

    const error = state.validationResult.errors.find(item => item.layerId === 'conv-1');
    expect(error?.errorType).toBe('invalid_dimension');

    const result = evaluateTrainingPreflight(preflightInput());
    const blocker = result.issues.find(issue => issue.code === 'model_shape_error');
    expect(blocker).toBeDefined();
    expect(blocker?.severity).toBe('blocker');
    expect(blocker?.target).toEqual({ kind: 'layer', layerId: 'conv-1' });
    expect(blocker?.detail).toBe(error?.message);
    expect(result.canStart).toBe(false);

    // 下游层不再持有可信形状（失败沿链传播，不是只有出错那一层）
    expect(state.layers.find(layer => layer.id === 'flatten-1')?.outputShape).toBeNull();
    expect(state.layers.find(layer => layer.id === 'linear-1')?.outputShape).toBeNull();

    // 参数量沿用既有公式，不伪造正常的 0 来掩盖同一个非法参数
    expect(Object.is(state.layers.find(layer => layer.id === 'conv-1')?.paramCount, Number.NaN)).toBe(true);
    expect(Number.isNaN(state.totalParams)).toBe(true);
  });

  it('Input 层推导失败也记录错误，不会出现「Input 失败但整网校验通过」', () => {
    seed([
      draftLayer('input-1', 'Input', 0, {
        inChannels: 1,
        inputHeight: Number.NaN,
        inputWidth: 28,
      }),
      ...legalLayers().slice(1),
    ]);

    const state = useLayerStore.getState();
    const inputError = state.validationResult.errors.find(item => item.layerId === 'input-1');
    expect(inputError).toBeDefined();
    expect(inputError?.errorType).toBe('invalid_dimension');
    expect(inputError?.message).toContain('inputHeight');
    expect(state.validationResult.isValid).toBe(false);
    expect(state.hasShapeError).toBe(true);

    const result = evaluateTrainingPreflight(preflightInput());
    expect(result.canStart).toBe(false);
    expect(result.issues.filter(issue => issue.code === 'model_shape_error').length).toBeGreaterThan(0);
  });

  it('池化与全连接的非法参数同样进入阻断链', () => {
    seed([
      draftLayer('input-1', 'Input', 0, { inChannels: 1, inputHeight: 28, inputWidth: 28 }),
      draftLayer('conv-1', 'Conv2D', 1, { inChannels: 1, outChannels: 8, kernelSize: 3, stride: 1, padding: 1 }),
      draftLayer('pool-1', 'MaxPool2D', 2, { poolKernelSize: 2, poolStride: 0 }),
      draftLayer('flatten-1', 'Flatten', 3, {}),
      draftLayer('linear-1', 'Linear', 4, { inFeatures: 1568, outFeatures: 'ten' as unknown as number }),
    ]);

    const state = useLayerStore.getState();
    const fields = state.validationResult.errors.map(error => error.message);
    expect(state.validationResult.errors.filter(error => error.errorType === 'invalid_dimension').map(e => e.layerId))
      .toEqual(expect.arrayContaining(['linear-1']));
    expect(fields.join('\n')).toContain('poolStride');

    const result = evaluateTrainingPreflight(preflightInput());
    const targets = result.issues
      .filter(issue => issue.code === 'model_shape_error')
      .map(issue => issue.target);
    expect(targets).toContainEqual({ kind: 'layer', layerId: 'linear-1' });
    expect(result.canStart).toBe(false);
  });

  it('把参数改回合法值后，形状、错误记录与启动准入一起恢复', () => {
    const layers = legalLayers();
    layers[1] = draftLayer('conv-1', 'Conv2D', 1, {
      inChannels: 1,
      outChannels: 8,
      kernelSize: 'three' as unknown as number,
      stride: 1,
      padding: 1,
    });
    seed(layers);
    expect(useLayerStore.getState().hasShapeError).toBe(true);
    expect(evaluateTrainingPreflight(preflightInput()).canStart).toBe(false);

    act(() => {
      useLayerStore.getState().updateLayerParam('conv-1', 'kernelSize', 3);
    });

    const state = useLayerStore.getState();
    expect(state.layers.find(layer => layer.id === 'conv-1')?.outputShape).toEqual([8, 28, 28]);
    expect(state.validationResult.errors).toHaveLength(0);
    expect(state.validationResult.isValid).toBe(true);
    expect(state.hasShapeError).toBe(false);

    const result = evaluateTrainingPreflight(preflightInput());
    expect(result.issues.filter(issue => issue.code === 'model_shape_error')).toHaveLength(0);
    expect(result.canStart).toBe(true);
  });
});
