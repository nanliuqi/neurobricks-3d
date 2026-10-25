import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import TrainingPreflightPanel, { type TrainingPreflightPanelHandle } from '@/components/training/TrainingPreflightPanel';
import { evaluateTrainingPreflight, type TrainingPreflightInput } from '@/utils/trainingPreflight';
import type { DatasetInfo } from '@/types/dataset';
import type { Layer3D, LayerParams, LayerType } from '@/types/layer';
import type { TrainingRuntimeInfo } from '@/types/gpu';

let layerSeq = 0;
function makeLayer(type: LayerType, params: LayerParams, order: number): Layer3D {
  layerSeq += 1;
  return {
    id: `panel-layer-${layerSeq}`,
    type,
    params,
    order,
    position: [0, order * 2, 0],
    outputShape: null,
    paramCount: 0,
    validationError: null,
  };
}

function makeDataset(): DatasetInfo {
  return { name: 'MNIST', type: 'mnist', sampleCount: 70000, classCount: 10 };
}

function makeRuntimeInfo(): TrainingRuntimeInfo {
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
  };
}

function makeInput(overrides: Partial<TrainingPreflightInput> = {}): TrainingPreflightInput {
  return {
    layers: [
      makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
      makeLayer('Flatten', {}, 1),
      makeLayer('Linear', { inFeatures: 784, outFeatures: 10 }, 2),
    ],
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
    isNativeRuntime: true,
    runtimeChecking: false,
    runtimeError: null,
    runtimeInfo: makeRuntimeInfo(),
    auditPersistence: 'unavailable',
    ...overrides,
  };
}

const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

describe('TrainingPreflightPanel', () => {
  it('1. 收起摘要：状态徽章 + 展开按钮 + ARIA 正确', () => {
    const result = evaluateTrainingPreflight(makeInput({ dataset: null, epochs: 0 }));
    render(<TrainingPreflightPanel result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    const toggle = screen.getByTestId('preflight-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'training-preflight-list');
    expect(screen.getByTestId('preflight-summary-text')).toBeInTheDocument();
    expect(screen.getByText(`${result.blockers.length} 项阻断`)).toBeInTheDocument();
    // 收起时直接展示首个阻断摘要
    expect(screen.getByTestId('preflight-summary-text').textContent).toContain(result.blockers[0].title);
  });

  it('2-3. 展开后显示全部阻断（不只第一个），按类别分组', () => {
    const result = evaluateTrainingPreflight(makeInput({ dataset: null, epochs: 0 }));
    render(<TrainingPreflightPanel result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    fireEvent.click(screen.getByTestId('preflight-toggle'));
    expect(screen.getByTestId('preflight-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('preflight-list')).toBeInTheDocument();
    // 全部问题都渲染
    for (const issue of result.issues) {
      expect(screen.getAllByText(issue.title).length).toBeGreaterThan(0);
    }
    // 4. 按类别分组：数据 + 训练参数两组
    expect(screen.getByText('数据')).toBeInTheDocument();
    expect(screen.getByText('训练参数')).toBeInTheDocument();
  });

  it('5. checking 状态：显示检查中文案，不显示通过', () => {
    const result = evaluateTrainingPreflight(makeInput({ runtimeChecking: true }));
    render(<TrainingPreflightPanel result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    expect(screen.getByTestId('preflight-summary-text')).toHaveTextContent('正在检查训练运行环境');
    expect(screen.getByTestId('preflight-summary-text').textContent).not.toContain('已通过');
    expect(screen.getByText('正在检查')).toBeInTheDocument();
  });

  it('6. warning 状态：说明可启动但存在注意事项', () => {
    const result = evaluateTrainingPreflight(makeInput({ isNativeRuntime: false, runtimeInfo: null }));
    expect(result.canStart).toBe(true);
    render(<TrainingPreflightPanel result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    expect(screen.getByTestId('preflight-summary-text')).toHaveTextContent('可以启动，但存在注意事项');
  });

  it('7. ready 显示保守通过文案（不承诺训练必然成功）', () => {
    const result = evaluateTrainingPreflight(makeInput());
    render(<TrainingPreflightPanel result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    const text = screen.getByTestId('preflight-summary-text');
    expect(text).toHaveTextContent('当前可见训练前检查已通过，启动时仍会执行数据契约、Study 和受控管线最终检查。');
    expect(text.textContent).not.toContain('训练一定可以成功');
  });

  it('8-10. 去处理按结构化 target 导航：数据→dataset、模型→param、运行环境→gpu', () => {
    const onNavigateTarget = vi.fn();
    const result = evaluateTrainingPreflight(makeInput({
      dataset: null,
      isNativeRuntime: true,
      runtimeError: 'torch 缺失',
    }));
    render(<TrainingPreflightPanel result={result} authoritativeError={null} onNavigateTarget={onNavigateTarget} />);
    fireEvent.click(screen.getByTestId('preflight-toggle'));

    const actions = screen.getAllByText('去处理');
    // 逐项点击并验证 target 结构化传递（不依赖文案判断）
    actions.forEach(action => fireEvent.click(action));
    const targets = onNavigateTarget.mock.calls.map(call => call[0]);
    expect(targets).toContainEqual({ kind: 'panel', panelId: 'dataset' });
    expect(targets).toContainEqual({ kind: 'panel', panelId: 'gpu' });
  });

  it('11. 启动阶段最终错误：Alert 展示真实信息并可导航训练监控', () => {
    const onNavigateTarget = vi.fn();
    const result = evaluateTrainingPreflight(makeInput());
    render(
      <TrainingPreflightPanel
        result={result}
        authoritativeError={{ title: '启动阶段最终检查未通过', detail: '当前数据、切分或预处理与活动 Study 不一致' }}
        onNavigateTarget={onNavigateTarget}
      />,
    );
    expect(screen.getByText('启动阶段最终检查未通过')).toBeInTheDocument();
    expect(screen.getByText(/当前数据、切分或预处理与活动 Study 不一致/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '前往训练监控' }));
    expect(onNavigateTarget).toHaveBeenCalledWith({ kind: 'monitor' });
  });

  it('25. 状态更新不自动抢焦点（摘要不可聚焦、不主动 focus）', () => {
    const result = evaluateTrainingPreflight(makeInput());
    render(<TrainingPreflightPanel result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    expect(document.activeElement).toBe(document.body);
  });

  it('27. 面板 UI 不含 emoji', () => {
    const result = evaluateTrainingPreflight(makeInput({ dataset: null, runtimeChecking: true }));
    const { container } = render(
      <TrainingPreflightPanel
        result={result}
        authoritativeError={{ title: '启动阶段最终检查未通过', detail: '错误详情' }}
        onNavigateTarget={() => {}}
      />,
    );
    expect(container.textContent ?? '').not.toMatch(EMOJI_PATTERN);
  });

  it('28. 多个“去处理”按钮拥有不同可访问名称（含问题标题）', () => {
    const result = evaluateTrainingPreflight(makeInput({ dataset: null, epochs: 0 }));
    render(<TrainingPreflightPanel result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    fireEvent.click(screen.getByTestId('preflight-toggle'));
    expect(screen.getByRole('button', { name: '处理：尚未导入数据' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '处理：Epochs 无效' })).toBeInTheDocument();
    // 可见文字仍为“去处理”
    expect(screen.getAllByText('去处理').length).toBe(2);
  });

  it('29. ready 且无问题时不存在无效的“查看全部”按钮', () => {
    const result = evaluateTrainingPreflight(makeInput());
    expect(result.issues).toHaveLength(0);
    render(<TrainingPreflightPanel result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    expect(screen.queryByTestId('preflight-toggle')).not.toBeInTheDocument();
  });

  it('30. 收起状态调用 expandAndFocusFirst：展开并聚焦首个问题', () => {
    const ref = createRef<TrainingPreflightPanelHandle>();
    const result = evaluateTrainingPreflight(makeInput({ dataset: null, epochs: 0 }));
    render(<TrainingPreflightPanel ref={ref} result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    expect(screen.queryByTestId('preflight-list')).not.toBeInTheDocument();
    act(() => ref.current?.expandAndFocusFirst());
    expect(screen.getByTestId('preflight-list')).toBeInTheDocument();
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
    expect(screen.getByTestId('preflight-list').contains(focused)).toBe(true);
  });

  it('31. 已展开时再次调用：重新聚焦（焦点已移走也能移回），不留 pending', () => {
    const ref = createRef<TrainingPreflightPanelHandle>();
    const result = evaluateTrainingPreflight(makeInput({ dataset: null }));
    render(<TrainingPreflightPanel ref={ref} result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    // 手动展开后把焦点移到 body（模拟用户焦点已移走）
    fireEvent.click(screen.getByTestId('preflight-toggle'));
    (document.body as HTMLElement).focus();
    expect(document.activeElement).toBe(document.body);
    act(() => ref.current?.expandAndFocusFirst());
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
    expect(screen.getByTestId('preflight-list').contains(focused)).toBe(true);
    // 连续第二次调用仍能重新聚焦（证明未残留一次性 pending 状态）
    (document.body as HTMLElement).focus();
    act(() => ref.current?.expandAndFocusFirst());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('32. 无 blocker、仅有 warning：聚焦首个问题（不阻断项）', () => {
    const ref = createRef<TrainingPreflightPanelHandle>();
    const result = evaluateTrainingPreflight(makeInput({
      isNativeRuntime: false,
      validationWarnings: ['输出形状异常'],
    }));
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    render(<TrainingPreflightPanel ref={ref} result={result} authoritativeError={null} onNavigateTarget={() => {}} />);
    act(() => ref.current?.expandAndFocusFirst());
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
    expect(screen.getByTestId('preflight-list').contains(focused)).toBe(true);
  });

  it('33. 无实时 issue、有权威错误：聚焦错误区域，且权威错误不依赖空列表展开', () => {
    const ref = createRef<TrainingPreflightPanelHandle>();
    const result = evaluateTrainingPreflight(makeInput());
    expect(result.issues).toHaveLength(0);
    render(
      <TrainingPreflightPanel
        ref={ref}
        result={result}
        authoritativeError={{ title: '上一次启动阶段最终检查未通过', detail: '错误详情' }}
        onNavigateTarget={() => {}}
      />,
    );
    expect(screen.getByText('上一次启动阶段最终检查未通过')).toBeInTheDocument();
    act(() => ref.current?.expandAndFocusFirst());
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toContain('上一次启动阶段最终检查未通过');
  });

  it('34. 状态自然更新不自动抢焦点；展开后列表变化聚焦使用当下首个问题', () => {
    const ref = createRef<TrainingPreflightPanelHandle>();
    const first = evaluateTrainingPreflight(makeInput({ dataset: null }));
    const { rerender } = render(
      <TrainingPreflightPanel ref={ref} result={first} authoritativeError={null} onNavigateTarget={() => {}} />,
    );
    (document.body as HTMLElement).focus();
    // 仅更新结果（不触发 expandAndFocusFirst）：不抢焦点，也不渲染列表（未展开）
    rerender(
      <TrainingPreflightPanel
        ref={ref}
        result={evaluateTrainingPreflight(makeInput({ dataset: null, epochs: 0 }))}
        authoritativeError={null}
        onNavigateTarget={() => {}}
      />,
    );
    expect(document.activeElement).toBe(document.body);
    // 展开后聚焦当下真实的首个问题（含新增的 epochs 问题集合的首项）
    act(() => ref.current?.expandAndFocusFirst());
    expect(document.activeElement).not.toBe(document.body);
  });
});
