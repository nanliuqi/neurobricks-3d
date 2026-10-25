/**
 * LAYER_META_LIST 契约测试（S1）：
 * S1 只允许修改 description 文案，因此这里把其余字段（层顺序、类型、标签、图标、
 * 颜色、类别、默认参数）逐项钉死；同时约束 description 保持"简短且不承诺效果"。
 * 任何越界改动（改参数、改顺序、改颜色、把文案写成效果承诺）都应在此失败。
 */
import { describe, expect, it } from 'vitest';
import { LAYER_META_LIST, type LayerCategory, type LayerParams, type LayerType } from '@/types/layer';

/** 除 description 之外的全部字段，即本轮禁止改动的部分。 */
interface NonCopyMetaContract {
  type: LayerType;
  label: string;
  icon: string;
  color: string;
  category: LayerCategory;
  defaultParams: LayerParams;
}

const EXPECTED_NON_COPY: readonly NonCopyMetaContract[] = [
  { type: 'Input', label: '输入层', icon: 'input', color: '#9E9E9E', category: 'utility', defaultParams: { inChannels: 1 } },
  {
    type: 'Conv2D',
    label: '卷积层',
    icon: 'conv',
    color: '#4FC3F7',
    category: 'conv',
    defaultParams: { inChannels: 1, outChannels: 32, kernelSize: 3, stride: 1, padding: 0 },
  },
  { type: 'MaxPool2D', label: '最大池化层', icon: 'pool', color: '#81C784', category: 'pool', defaultParams: { poolKernelSize: 2, poolStride: 2 } },
  { type: 'AvgPool2D', label: '平均池化层', icon: 'pool', color: '#66BB6A', category: 'pool', defaultParams: { poolKernelSize: 2, poolStride: 2 } },
  { type: 'Linear', label: '全连接层', icon: 'linear', color: '#FFB74D', category: 'linear', defaultParams: { inFeatures: 128, outFeatures: 10 } },
  { type: 'ReLU', label: 'ReLU 激活', icon: 'relu', color: '#E57373', category: 'activation', defaultParams: {} },
  { type: 'Sigmoid', label: 'Sigmoid 激活', icon: 'sigmoid', color: '#EF5350', category: 'activation', defaultParams: {} },
  { type: 'Tanh', label: 'Tanh 激活', icon: 'tanh', color: '#EC407A', category: 'activation', defaultParams: {} },
  { type: 'BatchNorm2d', label: '批量归一化', icon: 'batchnorm', color: '#BA68C8', category: 'norm', defaultParams: { numFeatures: 32 } },
  { type: 'LayerNorm', label: '层归一化', icon: 'layernorm', color: '#AB47BC', category: 'norm', defaultParams: { normalizedShape: 32 } },
  { type: 'Dropout', label: 'Dropout', icon: 'dropout', color: '#90A4AE', category: 'utility', defaultParams: { dropRate: 0.5 } },
  { type: 'Flatten', label: '展平层', icon: 'flatten', color: '#FFF176', category: 'utility', defaultParams: {} },
];

/** 基础说明应当短句化：详细教学留给帮助面板，避免层卡片与参数面板被长文挤爆。 */
const MAX_DESCRIPTION_LENGTH = 24;

/** 效果承诺类措辞不得出现在基础说明里（是否有效由用户实验与验证集判断）。 */
const FORBIDDEN_PROMISE_WORDS = ['保证', '必然', '防止', '加速', '概率', '更准', '提升效果'] as const;

function toNonCopy(meta: (typeof LAYER_META_LIST)[number]): NonCopyMetaContract {
  return {
    type: meta.type,
    label: meta.label,
    icon: meta.icon,
    color: meta.color,
    category: meta.category,
    defaultParams: meta.defaultParams,
  };
}

describe('LAYER_META_LIST 非文案字段保持不变', () => {
  it('层数量与顺序与契约完全一致', () => {
    expect(LAYER_META_LIST).toHaveLength(EXPECTED_NON_COPY.length);
    expect(LAYER_META_LIST.map(meta => meta.type)).toEqual(EXPECTED_NON_COPY.map(item => item.type));
  });

  it('标签、图标、颜色、类别与默认参数逐项等于契约值', () => {
    const actual = LAYER_META_LIST.map(toNonCopy);
    expect(actual).toEqual(EXPECTED_NON_COPY.map(item => ({ ...item, defaultParams: { ...item.defaultParams } })));
  });
});

describe('LAYER_META_LIST 基础说明文案约束', () => {
  it('每条说明非空且保持短句', () => {
    const tooLong = LAYER_META_LIST.filter(
      meta => typeof meta.description !== 'string' || meta.description.trim().length === 0 || meta.description.length > MAX_DESCRIPTION_LENGTH,
    ).map(meta => `${meta.type}(${meta.description?.length ?? 0})`);
    expect(tooLong).toEqual([]);
  });

  it('说明中不含效果承诺措辞', () => {
    const offenders = LAYER_META_LIST.flatMap(meta =>
      FORBIDDEN_PROMISE_WORDS.filter(word => meta.description.includes(word)).map(word => `${meta.type}: ${word}`),
    );
    expect(offenders).toEqual([]);
  });

  it('说明内容彼此唯一，避免同义重复条目', () => {
    const descriptions = LAYER_META_LIST.map(meta => meta.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
