/**
 * 数据集工作台：CSV 任务契约、划分契约、样本独立性、机器检查、数据预览
 * 与模块 04 Preflight 集成。覆盖验收清单 D/E/F/G（24-53）组。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DatasetPanel from '@/components/panels/DatasetPanel';
import { useToastStore } from '@/components/ui/Toast';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { evaluateTrainingPreflight } from '@/utils/trainingPreflight';
import type { DatasetInfo } from '@/types/dataset';
import type { Layer3D } from '@/types/layer';

const tauriMocks = vi.hoisted(() => ({
  open: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/dialog', () => ({ open: tauriMocks.open }));
vi.mock('@tauri-apps/api/tauri', () => ({ invoke: tauriMocks.invoke }));

function makeCsvInfo(overrides: Partial<DatasetInfo> = {}): DatasetInfo {
  return {
    name: 'regression',
    type: 'csv',
    sampleCount: 100,
    classCount: 0,
    columns: ['customer_id', 'captured_at', 'feature', 'target'],
    ...overrides,
  };
}

function setCsvState(overrides: Partial<DatasetInfo> = {}, storeOverrides: Record<string, unknown> = {}) {
  useDatasetStore.setState({
    ...useDatasetStore.getInitialState(),
    datasetType: 'csv',
    datasetPath: 'D:/data.csv',
    datasetInfo: makeCsvInfo(overrides),
    ...storeOverrides,
  });
}

function makeMlpLayers(): Layer3D[] {
  return [
    { id: 'input', type: 'Input', order: 0, position: { x: 0, y: 0, z: 0 }, params: { inChannels: 1, inputHeight: 1, inputWidth: 2 } },
    { id: 'flatten', type: 'Flatten', order: 1, position: { x: 1, y: 0, z: 0 }, params: {} },
    { id: 'linear', type: 'Linear', order: 2, position: { x: 2, y: 0, z: 0 }, params: { inFeatures: 2, outFeatures: 1 } },
  ];
}

describe('数据集工作台：CSV 回归任务契约', () => {
  beforeEach(() => {
    setCsvState();
    useLayerStore.setState({ layers: makeMlpLayers(), selectedId: null });
    useToastStore.setState({ toasts: [] });
    tauriMocks.open.mockReset();
    tauriMocks.invoke.mockReset();
  });

  it('24. 不自动猜测目标列，未选择时显示待办状态', () => {
    render(<DatasetPanel />);
    expect(useDatasetStore.getState().targetField).toBeNull();
    expect((screen.getByLabelText('回归目标列') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText(/待办：请确认回归目标列/)).toBeInTheDocument();
    expect(screen.queryByText(/目标列已确认/)).not.toBeInTheDocument();
  });

  it('25. 目标列选择正确保存并显示确认状态', () => {
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(useDatasetStore.getState().targetField).toBe('target');
    expect(screen.getByText(/监督式回归 · 目标列已确认/)).toBeInTheDocument();
  });

  it('26. 特征列排除目标列，数量标注为“按当前配置推导”', () => {
    setCsvState({}, { targetField: 'target' });
    render(<DatasetPanel />);
    // 4 列 - 目标列 = 3 列
    expect(screen.getByText(/按当前配置推导/)).toBeInTheDocument();
    expect(screen.getByText('3 列')).toBeInTheDocument();
  });

  it('27. group/time 字段按实际训练规则参与特征推导', () => {
    setCsvState({}, { targetField: 'target', splitStrategy: 'temporal', timeField: 'captured_at' });
    render(<DatasetPanel />);
    // 排除目标 + 时间字段 = 2 列
    expect(screen.getByText('2 列')).toBeInTheDocument();
  });

  it('28. 目标列与 group 字段冲突时沿用既有清理规则', () => {
    setCsvState({}, { splitStrategy: 'group', groupField: 'customer_id' });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'customer_id' } });
    expect(useDatasetStore.getState().groupField).toBeNull();
    expect(useDatasetStore.getState().targetField).toBe('customer_id');
  });

  it('28b. 目标列与 time 字段冲突时同样清理', () => {
    setCsvState({}, { splitStrategy: 'temporal', timeField: 'captured_at' });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'captured_at' } });
    expect(useDatasetStore.getState().timeField).toBeNull();
  });

  it('29. 非数值特征列明确告警并列出问题列', () => {
    setCsvState({ nonNumericColumns: ['customer_id'] }, { targetField: 'target' });
    render(<DatasetPanel />);
    expect(screen.getByText(/特征列含非数值列/)).toBeInTheDocument();
    expect(screen.getAllByText(/customer_id/).length).toBeGreaterThanOrEqual(1);
  });

  it('29b. 目标列非数值时明确告警', () => {
    setCsvState({ nonNumericColumns: ['target'] }, { targetField: 'target' });
    render(<DatasetPanel />);
    expect(screen.getAllByText(/不能作为数值回归目标/).length).toBeGreaterThanOrEqual(1);
  });

  it('30. 空列与异常元数据不导致崩溃', () => {
    setCsvState({ columns: [] });
    const { container } = render(<DatasetPanel />);
    expect(container.querySelector('.dataset-wb-section')).toBeInTheDocument();
    // 无列时不渲染任务契约选择器，也不崩溃
    expect(screen.queryByLabelText('回归目标列')).not.toBeInTheDocument();
  });

  it('CSV group/time 字段选项不包含目标列', () => {
    setCsvState({}, { targetField: 'target', splitStrategy: 'temporal' });
    render(<DatasetPanel />);
    const options = Array.from((screen.getByLabelText('时间字段') as HTMLSelectElement).options)
      .map(option => option.value);
    expect(options).not.toContain('target');
    expect(options).toContain('captured_at');
  });
});

describe('数据集工作台：划分契约与独立性', () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: makeMlpLayers(), selectedId: null });
    useToastStore.setState({ toasts: [] });
  });

  it('31. 内置数据集显示预定义划分，不提供误导性比例编辑', () => {
    useDatasetStore.setState({
      ...useDatasetStore.getInitialState(),
      datasetType: 'mnist',
      datasetInfo: { name: 'MNIST', type: 'mnist', sampleCount: 60000, classCount: 10, channels: 1, imageHeight: 28, imageWidth: 28 },
    });
    render(<DatasetPanel />);
    expect(screen.getAllByText(/官方预定义 train\/test 切分/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/不可修改/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/开发池/)).not.toBeInTheDocument();
  });

  it('32-33. 自定义数据显示计划比例，且不伪造实际计数', () => {
    setCsvState();
    render(<DatasetPanel />);
    const label = screen.getByLabelText(/开发池/);
    expect(label).toBeInTheDocument();
    expect(screen.getByText(/这是计划比例，不是实际样本分配/)).toBeInTheDocument();
    expect(screen.getByText(/实际分配将在训练归档中记录/)).toBeInTheDocument();
    expect(screen.getByText(/validation split 由训练参数管理/)).toBeInTheDocument();
    fireEvent.change(label, { target: { value: '0.7' } });
    expect(useDatasetStore.getState().trainRatio).toBeCloseTo(0.7);
  });

  it('34. group 策略缺少字段时显示待办状态', () => {
    setCsvState({}, { splitStrategy: 'group', groupField: null });
    render(<DatasetPanel />);
    expect(screen.getByText(/待办：请选择分组字段/)).toBeInTheDocument();
  });

  it('35. temporal 策略缺少字段时显示待办状态', () => {
    setCsvState({}, { splitStrategy: 'temporal', timeField: null });
    render(<DatasetPanel />);
    expect(screen.getByText(/待办：请选择时间字段/)).toBeInTheDocument();
  });

  it('36-37. sampleUnit 正确显示，machine_verified 不显示成空选择', () => {
    useDatasetStore.setState({
      ...useDatasetStore.getInitialState(),
      datasetType: 'mnist',
      datasetInfo: {
        name: 'MNIST', type: 'mnist', sampleCount: 60000, classCount: 10,
        sampleUnit: 'image', sampleIndependence: 'machine_verified',
        sampleUnitDeclaration: 'TorchVision 官方预定义 train/test 样本',
      },
    });
    render(<DatasetPanel />);
    expect((screen.getByLabelText('独立样本单位') as HTMLSelectElement).value).toBe('image');
    expect(screen.getAllByText(/机器记录/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/TorchVision 官方预定义/)).toBeInTheDocument();
  });

  it('36b. 修改声明调用既有动作并更新为用户声明', () => {
    setCsvState();
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('独立样本单位'), { target: { value: 'row' } });
    const info = useDatasetStore.getState().datasetInfo;
    expect(info?.sampleUnit).toBe('row');
    expect(info?.sampleIndependence).toBe('user_declared');
  });

  it('38. 空 machineChecks 显示“尚无记录”，不显示“全部通过”', () => {
    setCsvState({ machineChecks: [] });
    render(<DatasetPanel />);
    expect(screen.getByText(/尚无逐项机器检查记录/)).toBeInTheDocument();
    expect(screen.queryByText(/全部通过/)).not.toBeInTheDocument();
  });

  it('39. passed/failed/not_run 均有文字与非颜色线索，failed 有摘要告警', () => {
    setCsvState({
      machineChecks: [
        { check: 'cross_split_exact_duplicate', status: 'passed' },
        { check: 'group_disjoint', status: 'failed', details: '组 g3 同时出现在训练与测试' },
        { check: 'temporal_order', status: 'not_run' },
      ],
    });
    render(<DatasetPanel />);
    expect(screen.getByText('通过')).toBeInTheDocument();
    expect(screen.getByText('未通过')).toBeInTheDocument();
    expect(screen.getByText('未运行')).toBeInTheDocument();
    expect(screen.getByText(/存在未通过的泄漏检查/)).toBeInTheDocument();
    expect(screen.getByText(/组 g3 同时出现在训练与测试/)).toBeInTheDocument();
    expect(screen.getByText(/跨切分精确重复检测/)).toBeInTheDocument();
  });

  it('39b. failed 文案不再声称训练被阻断（只陈述信任等级与统一检查裁决）', () => {
    setCsvState({
      machineChecks: [{ check: 'group_disjoint', status: 'failed' }],
    });
    render(<DatasetPanel />);
    const alert = screen.getByText(/存在未通过的泄漏检查/).closest('[role="alert"]') ?? document.body;
    expect(alert.textContent).toContain('不能获得最高结论信任等级');
    expect(alert.textContent).toContain('训练是否可启动以统一训练前检查为准');
    // 不得虚构业务代码未执行的阻断/资格剥夺
    expect(alert.textContent).not.toContain('无法继续训练');
    expect(alert.textContent).not.toContain('禁止训练');
    expect(alert.textContent).not.toContain('影响该数据集进入严格可比组');
  });
});

describe('数据集工作台：数据预览安全', () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: makeMlpLayers(), selectedId: null });
    useToastStore.setState({ toasts: [] });
  });

  it('40. 对象行按 columns 渲染为语义化表格', () => {
    setCsvState({ columns: ['a', 'b'], previewRows: [{ a: 1, b: 'x' }] });
    render(<DatasetPanel />);
    const table = document.querySelector('table.dataset-wb-preview-table');
    expect(table).not.toBeNull();
    expect(table!.querySelector('thead')).not.toBeNull();
    expect(table!.querySelector('tbody')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'a' })).toBeInTheDocument();
    expect(screen.getByText('x')).toBeInTheDocument();
  });

  it('41. 数组行按列序渲染', () => {
    setCsvState({ columns: ['n', 'v'], previewRows: [[1, 2]] });
    render(<DatasetPanel />);
    const cells = Array.from(document.querySelectorAll('table.dataset-wb-preview-table tbody td'))
      .map(cell => cell.textContent);
    expect(cells).toEqual(['1', '2']);
  });

  it('42. null/undefined/缺字段安全显示；额外字段不丢失（矩形化）', () => {
    setCsvState({ columns: ['a', 'b'], previewRows: [{ a: null }, { b: undefined, c: 9 }] });
    render(<DatasetPanel />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // 第二行的额外字段 c 必须可见，不得静默丢弃；且两行列数一致（c 列首行为—）
    expect(screen.getByRole('columnheader', { name: 'c' })).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    const rows = Array.from(document.querySelectorAll('table.dataset-wb-preview-table tbody tr'));
    const widths = rows.map(row => row.querySelectorAll('td').length);
    expect(new Set(widths).size).toBe(1);
  });

  it('43. 复杂值不出现 [object Object]', () => {
    setCsvState({ columns: ['a'], previewRows: [{ a: { nested: 1 } }] });
    const { container } = render(<DatasetPanel />);
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('44. HTML/脚本文本不会被执行', () => {
    setCsvState({
      columns: ['a'],
      previewRows: [{ a: '<img src=x onerror=window.__pwned=true><script>window.__pwned=true</script>' }],
    });
    render(<DatasetPanel />);
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
    expect(document.querySelector('table img')).toBeNull();
    expect(document.querySelector('table script')).toBeNull();
    // 原文以纯文本形式可见
    expect(document.querySelector('table td')?.textContent).toContain('<script>');
  });

  it('45. 超长内容：展示截断，title 完整等于原始 300 字符', () => {
    const long = '长'.repeat(300);
    setCsvState({ columns: ['a'], previewRows: [{ a: long }] });
    render(<DatasetPanel />);
    const cell = document.querySelector('table td') as HTMLTableCellElement;
    expect((cell.textContent ?? '').length).toBeLessThan(200);
    // 真实行为断言：title 必须完整等于原始值，而不是截断值的复制。
    expect(cell.getAttribute('title')).toBe(long);
  });

  it('45b. 未截断的短单元格不重复设置 title', () => {
    setCsvState({ columns: ['a'], previewRows: [{ a: '短值' }] });
    render(<DatasetPanel />);
    const cell = document.querySelector('table td') as HTMLTableCellElement;
    expect(cell.getAttribute('title')).toBeNull();
  });

  it('46. 空预览数据不渲染表格，面板其余部分正常', () => {
    setCsvState({ previewRows: [] });
    render(<DatasetPanel />);
    expect(document.querySelector('table.dataset-wb-preview-table')).toBeNull();
    expect(screen.getByLabelText('回归目标列')).toBeInTheDocument();
  });

  it('47. 异常预览数据不导致白屏', () => {
    setCsvState({ previewRows: 'corrupted' as unknown as unknown[] });
    const { container } = render(<DatasetPanel />);
    expect(container.querySelector('.dataset-wb-section')).toBeInTheDocument();
    expect(document.querySelector('table.dataset-wb-preview-table')).toBeNull();
  });
});

describe('数据集工作台：与模块 04 Preflight 集成', () => {
  beforeEach(() => {
    setCsvState();
    useLayerStore.setState({ layers: makeMlpLayers(), selectedId: null });
    useToastStore.setState({ toasts: [] });
  });

  function preflightInput() {
    const ds = useDatasetStore.getState();
    const layers = useLayerStore.getState().layers;
    return {
      dataset: ds.datasetInfo,
      targetField: ds.targetField,
      splitStrategy: ds.splitStrategy,
      groupField: ds.groupField,
      timeField: ds.timeField,
      layers,
      validationErrors: useLayerStore.getState().validationResult?.errors ?? [],
      validationWarnings: useLayerStore.getState().validationResult?.warnings ?? [],
      epochs: 5,
      batchSize: 32,
      learningRate: 0.001,
      weightDecay: 0,
      valSplit: 0.2,
      isNativeRuntime: false,
      runtimeInfo: null,
      runtimeChecking: false,
      runtimeError: null,
      auditPersistence: 'healthy' as const,
    };
  }

  it('48-49. CSV 未选目标列时统一 Preflight 立即阻断训练', () => {
    render(<DatasetPanel />);
    const result = evaluateTrainingPreflight(preflightInput());
    expect(result.canStart).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain('csv_target_missing');
  });

  it('50. 修正目标与网络后对应问题消失', () => {
    render(<DatasetPanel />);
    // 选择目标列；网络已匹配（2 特征，末层输出 1），适配框不会出现
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    const result = evaluateTrainingPreflight(preflightInput());
    expect(result.issues.map(issue => issue.code)).not.toContain('csv_target_missing');
    expect(result.issues.map(issue => issue.code)).not.toContain('csv_output_not_single');
  });

  it('52. 面板卸载再挂载后，store 持久状态完整保留（不丢失不应丢失的状态）', () => {
    setCsvState({}, { targetField: 'target', splitStrategy: 'temporal', timeField: 'captured_at' });
    const first = render(<DatasetPanel />);
    first.unmount();
    render(<DatasetPanel />);
    expect((screen.getByLabelText('回归目标列') as HTMLSelectElement).value).toBe('target');
    expect((screen.getByLabelText('划分策略') as HTMLSelectElement).value).toBe('temporal');
    expect((screen.getByLabelText('时间字段') as HTMLSelectElement).value).toBe('captured_at');
  });
});
