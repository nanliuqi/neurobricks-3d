import { describe, expect, it } from 'vitest';
import type { DatasetInfo } from '@/types/dataset';
import type { Layer3D } from '@/types/layer';
import { datasetOutputContractErrors } from '@/utils/trainingPreflight';

function linear(outFeatures: number): Layer3D {
  return {
    id: 'output', type: 'Linear', params: { inFeatures: 128, outFeatures }, order: 0,
    position: [0, 0, 0], outputShape: [outFeatures], paramCount: 0, validationError: null,
  };
}

function dataset(type: DatasetInfo['type'], classCount: number): DatasetInfo {
  return { name: 'review-images', type, sampleCount: 400, classCount };
}

describe('dataset output contract preflight', () => {
  it('rejects a 10-output MLP for a binary image dataset before training', () => {
    const errors = datasetOutputContractErrors([linear(10)], dataset('local_image', 2));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('2 个类别');
    expect(errors[0].suggestion).toContain('outFeatures 修改为 2');
  });

  it('accepts matching classification output and requires one regression output', () => {
    expect(datasetOutputContractErrors([linear(2)], dataset('local_image', 2))).toEqual([]);
    expect(datasetOutputContractErrors([linear(2)], dataset('csv', 0))[0].message).toContain('outFeatures=1');
  });
});

