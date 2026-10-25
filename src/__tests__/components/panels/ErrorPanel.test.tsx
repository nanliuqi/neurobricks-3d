import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorPanel from '@/components/panels/ErrorPanel';
import { useLayerStore } from '@/stores/useLayerStore';
import type { ValidationResult } from '@/types/layer';
import { useDatasetStore } from '@/stores/useDatasetStore';

/** 构造校验结果夹具 */
function setValidation(result: ValidationResult) {
  useLayerStore.setState({ validationResult: result });
}

/** 无错误无警告的默认结果 */
function okResult(): ValidationResult {
  return { isValid: true, errors: [], warnings: [] };
}

/** 构造形状校验错误 */
function shapeError(overrides: Partial<import('@/types/layer').ShapeValidationError> = {}) {
  return {
    layerId: 'layer-1',
    layerType: 'Conv2D' as const,
    errorType: 'param_conflict' as const,
    message: 'Conv2D 输入通道不匹配：inChannels=3，但上游输出为 [1, 28, 28]',
    suggestion: '将 inChannels 修改为 1',
    expectedInputShape: [1, 28, 28] as number[] | null,
    actualInputShape: [3, 28, 28] as number[] | null,
    ...overrides,
  };
}

afterEach(() => {
  setValidation(okResult());
});

beforeEach(() => {
  useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
  useLayerStore.setState({ ...useLayerStore.getInitialState() });
});

describe('ErrorPanel', () => {
  it('应该在没有错误时显示校验通过消息', () => {
    setValidation(okResult());

    render(<ErrorPanel />);

    expect(screen.getByText('校验结果')).toBeInTheDocument();
    expect(screen.getByText(/网络结构校验通过/)).toBeInTheDocument();
  });

  it('应该在有错误时显示错误详情（层类型 + 消息 + 建议）', () => {
    setValidation({
      isValid: false,
      errors: [shapeError()],
      warnings: [],
    });

    render(<ErrorPanel />);

    // 标题 span 渲染层类型 + 截断的 layerId（substring(0,6)）
    expect(screen.getByText(/Conv2D · layer-/)).toBeInTheDocument();
    expect(screen.getByText('参数冲突', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/inChannels=3/)).toBeInTheDocument();
    expect(screen.getByText(/将 inChannels 修改为 1/)).toBeInTheDocument();
  });

  it('应该显示形状对比（期望 vs 实际）', () => {
    setValidation({
      isValid: false,
      errors: [shapeError()],
      warnings: [],
    });

    render(<ErrorPanel />);

    expect(screen.getByText('期望: [1, 28, 28]')).toBeInTheDocument();
    expect(screen.getByText('实际: [3, 28, 28]')).toBeInTheDocument();
  });

  it('missing_flatten 错误应该显示"缺少 Flatten"标签', () => {
    setValidation({
      isValid: false,
      errors: [
        shapeError({
          layerType: 'Linear',
          errorType: 'missing_flatten',
          message: 'Linear 层前需要添加 Flatten 层',
          suggestion: '在 Linear 层前添加 Flatten 层',
          expectedInputShape: null,
          actualInputShape: [32, 14, 14],
        }),
      ],
      warnings: [],
    });

    render(<ErrorPanel />);

    expect(screen.getByText('缺少 Flatten')).toBeInTheDocument();
  });

  it('应该显示警告信息', () => {
    setValidation({
      isValid: true,
      errors: [],
      warnings: ['第 3 层 (Conv2D) 输出形状异常：[32, 0, 0]'],
    });

    render(<ErrorPanel />);

    expect(screen.getByText(/第 3 层/)).toBeInTheDocument();
  });

  it('错误数量徽标应该等于错误条数', () => {
    setValidation({
      isValid: false,
      errors: [shapeError(), shapeError({ layerId: 'layer-2' })],
      warnings: [],
    });

    render(<ErrorPanel />);

    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('应该在二分类数据使用 10 输出 MLP 时显示任务输出错误', () => {
    useDatasetStore.setState({
      datasetType: 'local_image',
      datasetInfo: { name: 'review-images', type: 'local_image', sampleCount: 400, classCount: 2 },
    });
    useLayerStore.setState({
      layers: [{
        id: 'output', type: 'Linear', params: { inFeatures: 128, outFeatures: 10 }, order: 0,
        position: [0, 0, 0], outputShape: [10], paramCount: 1290, validationError: null,
      }],
      validationResult: okResult(),
    });

    render(<ErrorPanel />);

    expect(screen.getByText(/有 2 个类别，但最后一个 Linear/)).toBeInTheDocument();
    expect(screen.getByText(/outFeatures 修改为 2/)).toBeInTheDocument();
  });
});
