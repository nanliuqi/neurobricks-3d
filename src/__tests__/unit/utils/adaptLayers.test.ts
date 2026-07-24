import { describe, it, expect } from 'vitest';
import { adaptLayersToInputShape, validateNetwork } from '@/utils/shapeInference';
import { CLASSIC_MODELS } from '@/types/classicModels';
import type { Layer3D } from '@/types/layer';

/** 从经典模型模板构建 Layer3D 列表（模拟 addClassicModel 的构建方式） */
function templateToLayers(modelId: string): Layer3D[] {
  const model = CLASSIC_MODELS.find(m => m.id === modelId);
  if (!model) throw new Error(`模型不存在: ${modelId}`);
  return model.layers.map((t, i) => ({
    id: `layer-${i}`,
    type: t.type,
    params: { ...(t.params ?? {}) },
    order: i,
    position: [0, 0, 0] as [number, number, number],
    outputShape: null,
    paramCount: 0,
    validationError: null,
  }));
}

describe('adaptLayersToInputShape（数据集适配）', () => {
  it('LeNet-5 适配 CIFAR-10：Conv2D 通道 1→3，Linear 特征 256→400', () => {
    const layers = templateToLayers('lenet5');
    const adapted = adaptLayersToInputShape(layers, [3, 32, 32]);

    const input = adapted.find(l => l.type === 'Input')!;
    expect(input.params.inChannels).toBe(3);
    expect(input.params.inputHeight).toBe(32);
    expect(input.params.inputWidth).toBe(32);

    const convs = adapted.filter(l => l.type === 'Conv2D');
    // 第一个 Conv2D：输入通道修正为数据集通道数 3
    expect(convs[0].params.inChannels).toBe(3);
    // 第二个 Conv2D：上游输出 6 通道，保持 6 不变
    expect(convs[1].params.inChannels).toBe(6);

    const linears = adapted.filter(l => l.type === 'Linear');
    // 第一个 Linear：Flatten 输出 16×5×5=400
    expect(linears[0].params.inFeatures).toBe(400);
    // 后续 Linear 不受影响
    expect(linears[1].params.inFeatures).toBe(120);
    expect(linears[2].params.inFeatures).toBe(84);

    // 适配后的网络必须通过形状校验（前端与 Python 端一致）
    const result = validateNetwork(adapted);
    expect(result.errors).toHaveLength(0);
  });

  it('SimpleCNN 适配 CIFAR-10：Conv2D 通道 1→3，Linear 特征 3136→4096', () => {
    const layers = templateToLayers('simplecnn');
    const adapted = adaptLayersToInputShape(layers, [3, 32, 32]);

    const convs = adapted.filter(l => l.type === 'Conv2D');
    expect(convs[0].params.inChannels).toBe(3);
    expect(convs[1].params.inChannels).toBe(32);

    const linears = adapted.filter(l => l.type === 'Linear');
    // Flatten 输出 64×8×8=4096
    expect(linears[0].params.inFeatures).toBe(4096);
    expect(linears[1].params.inFeatures).toBe(128);

    expect(validateNetwork(adapted).errors).toHaveLength(0);
  });

  it('LeNet-5 适配 MNIST：参数与模板一致（无需修正）', () => {
    const layers = templateToLayers('lenet5');
    const adapted = adaptLayersToInputShape(layers, [1, 28, 28]);

    expect(adapted.filter(l => l.type === 'Conv2D')[0].params.inChannels).toBe(1);
    expect(adapted.filter(l => l.type === 'Linear')[0].params.inFeatures).toBe(256);
    expect(validateNetwork(adapted).errors).toHaveLength(0);
  });

  it('不修改调用方传入的原始层数据', () => {
    const layers = templateToLayers('lenet5');
    const before = JSON.stringify(layers.map(l => l.params));
    adaptLayersToInputShape(layers, [3, 32, 32]);
    expect(JSON.stringify(layers.map(l => l.params))).toBe(before);
  });

  it('所有声明数据集兼容性的经典模型模板自身形状一致', () => {
    for (const model of CLASSIC_MODELS) {
      if (!model.compatibleDatasets || model.compatibleDatasets.length === 0) continue;
      const layers = templateToLayers(model.id);
      const result = validateNetwork(layers);
      expect(result.errors, `${model.name} 模板应自洽`).toHaveLength(0);
    }
  });

  it('MLP 适配 CSV 编码形状 1×1×F：首个 Linear 特征数修正为 F', () => {
    // CSV 是表格数据：DatasetPanel 以 [1, 1, 特征数] 作为目标形状，
    // Flatten(1×1×16) = 16，首个 Linear 的 inFeatures 应同步修正
    const layers = templateToLayers('mlp');
    const adapted = adaptLayersToInputShape(layers, [1, 1, 16]);

    const input = adapted.find(l => l.type === 'Input')!;
    expect(input.params.inChannels).toBe(1);
    expect(input.params.inputHeight).toBe(1);
    expect(input.params.inputWidth).toBe(16);

    const linears = adapted.filter(l => l.type === 'Linear');
    expect(linears[0].params.inFeatures).toBe(16);
    // 后续 Linear 不受影响
    expect(linears[1].params.inFeatures).toBe(256);
    expect(linears[2].params.inFeatures).toBe(128);

    expect(validateNetwork(adapted).errors).toHaveLength(0);
  });
});

describe('validateNetwork 参数一致性校验', () => {
  it('Conv2D inChannels 与上游输出不匹配时报 param_conflict', () => {
    const layers = templateToLayers('lenet5');
    // 人为制造不匹配：Input 改为 3 通道，但 Conv2D 仍声明 1
    layers[0].params = { inChannels: 3, inputHeight: 32, inputWidth: 32 };
    const result = validateNetwork(layers);
    expect(
      result.errors.some(e => e.errorType === 'param_conflict' && e.layerType === 'Conv2D')
    ).toBe(true);
  });

  it('Linear inFeatures 与上游输出不匹配时报 param_conflict', () => {
    const layers = templateToLayers('lenet5');
    // 人为制造不匹配：Input 改为 32×32，Flatten 输出 400，但 Linear 仍声明 256
    layers[0].params = { inChannels: 1, inputHeight: 32, inputWidth: 32 };
    const result = validateNetwork(layers);
    expect(
      result.errors.some(e => e.errorType === 'param_conflict' && e.layerType === 'Linear')
    ).toBe(true);
  });

  it('参数一致时不产生 param_conflict 误报', () => {
    const layers = templateToLayers('lenet5');
    const result = validateNetwork(layers);
    expect(result.errors.filter(e => e.errorType === 'param_conflict')).toHaveLength(0);
  });
});
