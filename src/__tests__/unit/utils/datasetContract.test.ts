/**
 * CSV 特征契约单一来源测试：
 * datasetContract 与模块 04 Preflight 的 derived.featureFields 在
 * random / group / temporal 三种策略下必须完全一致；
 * group 不得错误排除未激活的 timeField；temporal 不得错误排除未激活的 groupField。
 */
import { describe, expect, it } from 'vitest';
import {
  deriveCsvFeatureFields,
  deriveCsvFeatureFieldsFromColumns,
  deriveNonNumericFeatureColumns,
} from '@/utils/datasetContract';
import { evaluateTrainingPreflight, type TrainingPreflightInput } from '@/utils/trainingPreflight';
import type { DatasetInfo } from '@/types/dataset';
import type { Layer3D } from '@/types/layer';

const CSV_DATASET: DatasetInfo = {
  name: 'regression',
  type: 'csv',
  sampleCount: 100,
  classCount: 0,
  columns: ['customer_id', 'captured_at', 'feature_a', 'feature_b', 'target'],
  datasetId: 'ds-1',
  contentHash: 'hash-1',
  importedAt: 1,
};

const MLP_LAYERS: Layer3D[] = [
  { id: 'input', type: 'Input', order: 0, position: { x: 0, y: 0, z: 0 }, params: { inChannels: 1, inputHeight: 1, inputWidth: 3 } },
  { id: 'flatten', type: 'Flatten', order: 1, position: { x: 1, y: 0, z: 0 }, params: {} },
  { id: 'linear', type: 'Linear', order: 2, position: { x: 2, y: 0, z: 0 }, params: { inFeatures: 3, outFeatures: 1 } },
];

function makePreflightInput(selections: {
  splitStrategy: 'random' | 'group' | 'temporal';
  groupField: string | null;
  timeField: string | null;
  targetField: string | null;
}): TrainingPreflightInput {
  return {
    layers: MLP_LAYERS,
    validationErrors: [],
    validationWarnings: [],
    dataset: CSV_DATASET,
    splitStrategy: selections.splitStrategy,
    groupField: selections.groupField,
    timeField: selections.timeField,
    targetField: selections.targetField,
    epochs: 5,
    batchSize: 32,
    learningRate: 0.001,
    weightDecay: 0,
    valSplit: 0.2,
    isNativeRuntime: false,
    runtimeInfo: null,
    runtimeChecking: false,
    runtimeError: null,
    auditPersistence: 'healthy',
  };
}

describe('datasetContract：核心排除规则', () => {
  it('CSV 未选 targetField 时，数据集级入口返回空特征集合（契约未成立）', () => {
    expect(deriveCsvFeatureFields(CSV_DATASET, {
      splitStrategy: 'random', groupField: null, timeField: null, targetField: null,
    })).toEqual([]);
    // 不得把全部列当成特征。
    expect(deriveCsvFeatureFields(CSV_DATASET, {
      splitStrategy: 'group', groupField: 'customer_id', timeField: null, targetField: null,
    })).toEqual([]);
  });

  it('最低层函数同样 fail-closed：targetField 未确认时不得返回全部列', () => {
    expect(deriveCsvFeatureFieldsFromColumns(CSV_DATASET.columns, {
      splitStrategy: 'temporal', groupField: null, timeField: 'captured_at', targetField: null,
    })).toEqual([]);
    expect(deriveCsvFeatureFieldsFromColumns(CSV_DATASET.columns, {
      splitStrategy: 'random', groupField: 'customer_id', timeField: 'captured_at', targetField: '',
    })).toEqual([]);
  });

  it('选定 targetField 后正确排除目标列', () => {
    expect(deriveCsvFeatureFields(CSV_DATASET, {
      splitStrategy: 'random', groupField: null, timeField: null, targetField: 'target',
    })).toEqual(['customer_id', 'captured_at', 'feature_a', 'feature_b']);
  });

  it('始终排除 targetField', () => {
    expect(deriveCsvFeatureFieldsFromColumns(CSV_DATASET.columns, {
      splitStrategy: 'random', groupField: null, timeField: null, targetField: 'target',
    })).toEqual(['customer_id', 'captured_at', 'feature_a', 'feature_b']);
  });

  it('random 不排除未激活的 group/time 字段', () => {
    expect(deriveCsvFeatureFieldsFromColumns(CSV_DATASET.columns, {
      splitStrategy: 'random', groupField: 'customer_id', timeField: 'captured_at', targetField: 'target',
    })).toEqual(['customer_id', 'captured_at', 'feature_a', 'feature_b']);
  });

  it('group 只额外排除激活的 groupField，不错误排除未激活的 timeField', () => {
    expect(deriveCsvFeatureFieldsFromColumns(CSV_DATASET.columns, {
      splitStrategy: 'group', groupField: 'customer_id', timeField: 'captured_at', targetField: 'target',
    })).toEqual(['captured_at', 'feature_a', 'feature_b']);
  });

  it('temporal 只额外排除激活的 timeField，不错误排除未激活的 groupField', () => {
    expect(deriveCsvFeatureFieldsFromColumns(CSV_DATASET.columns, {
      splitStrategy: 'temporal', groupField: 'customer_id', timeField: 'captured_at', targetField: 'target',
    })).toEqual(['customer_id', 'feature_a', 'feature_b']);
  });

  it('字段顺序保持 columns 顺序；非 CSV 返回 undefined', () => {
    const columns = ['z', 'a', 'm'];
    expect(deriveCsvFeatureFieldsFromColumns(columns, {
      splitStrategy: 'random', groupField: null, timeField: null, targetField: 'a',
    })).toEqual(['z', 'm']);
    expect(deriveCsvFeatureFields(
      { ...CSV_DATASET, type: 'mnist' },
      { splitStrategy: 'random', groupField: null, timeField: null, targetField: null },
    )).toBeUndefined();
  });

  it('非数值特征列与阻断口径一致', () => {
    const dataset = { ...CSV_DATASET, nonNumericColumns: ['customer_id', 'captured_at'] };
    expect(deriveNonNumericFeatureColumns(dataset, {
      splitStrategy: 'group', groupField: 'customer_id', timeField: null, targetField: 'target',
    })).toEqual(['captured_at']);
  });
});

describe('datasetContract 与模块 04 Preflight derived.featureFields 完全一致', () => {
  it.each([
    ['random', null, null],
    ['group', 'customer_id', null],
    ['temporal', null, 'captured_at'],
  ] as const)('策略 %s（group=%s, time=%s）下两侧推导一致', (splitStrategy, groupField, timeField) => {
    const selections = { splitStrategy, groupField, timeField, targetField: 'target' };
    const fromContract = deriveCsvFeatureFields(CSV_DATASET, selections);
    const preflight = evaluateTrainingPreflight(makePreflightInput(selections));
    expect(preflight.derived.featureFields).toEqual(fromContract);
  });
});
