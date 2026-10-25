/**
 * 数据集工作台：网络自动适配确认（ConfirmDialog 替代 window.confirm）
 * 与过期适配计划防护。覆盖验收清单 C（15-23）组。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DatasetPanel from '@/components/panels/DatasetPanel';
import { useToastStore } from '@/components/ui/Toast';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useLayerStore } from '@/stores/useLayerStore';
import type { Layer3D } from '@/types/layer';
import { adaptLayersForCsvRegression } from '@/utils/shapeInference';

const tauriMocks = vi.hoisted(() => ({
  open: vi.fn(),
  invoke: vi.fn(),
}));

// 把适配算法包成可监视函数（默认透传真实实现），用于验证“计算抛错不修改模型”。
vi.mock('@/utils/shapeInference', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/shapeInference')>();
  return {
    ...actual,
    adaptLayersForCsvRegression: vi.fn(actual.adaptLayersForCsvRegression),
    adaptLayersToInputShape: vi.fn(actual.adaptLayersToInputShape),
  };
});

vi.mock('@tauri-apps/api/dialog', () => ({ open: tauriMocks.open }));
vi.mock('@tauri-apps/api/tauri', () => ({ invoke: tauriMocks.invoke }));

function makeLayers(): Layer3D[] {
  return [
    { id: 'input', type: 'Input', order: 0, position: { x: 0, y: 0, z: 0 }, params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
    { id: 'flatten', type: 'Flatten', order: 1, position: { x: 1, y: 0, z: 0 }, params: {} },
    { id: 'linear', type: 'Linear', order: 2, position: { x: 2, y: 0, z: 0 }, params: { inFeatures: 784, outFeatures: 10 } },
  ];
}

const CSV_RESULT = {
  name: 'regression',
  type: 'csv' as const,
  sampleCount: 100,
  classCount: 0,
  columns: ['a', 'b', 'target'],
  datasetId: 'ds-csv-1',
  contentHash: 'hash-csv-1',
};

function resetStores() {
  useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
  useLayerStore.setState({ layers: makeLayers(), selectedId: null });
  useToastStore.setState({ toasts: [] });
  tauriMocks.open.mockReset();
  tauriMocks.invoke.mockReset();
}

async function importCsv() {
  tauriMocks.open.mockResolvedValue('D:/data.csv');
  tauriMocks.invoke.mockResolvedValue(CSV_RESULT);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }));
    await Promise.resolve();
  });
}

describe('数据集工作台：网络适配确认', () => {
  beforeEach(() => {
    resetStores();
  });

  it('15. 使用 ConfirmDialog，不再调用 window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);

    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用适配' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保留当前网络' })).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('16. 用户取消后数据集已选中但网络不变', async () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });

    fireEvent.click(screen.getByRole('button', { name: '保留当前网络' }));

    expect(useDatasetStore.getState().targetField).toBe('target');
    const layers = useLayerStore.getState().layers;
    expect(layers[0].params.inputWidth).toBe(28); // 未被旧计划覆盖
    expect(layers[2].params.outFeatures).toBe(10);
  });

  it('17. 用户确认后网络正确适配（Input 形状与末层单值输出）', async () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });

    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));

    const layers = useLayerStore.getState().layers;
    expect(layers[0].params).toMatchObject({ inChannels: 1, inputHeight: 1, inputWidth: 2 });
    expect(layers[2].params.outFeatures).toBe(1);
    expect(layers[2].params.inFeatures).toBe(2);
    // 适配后参数统计重新计算（形状派生属性已刷新）
    expect(layers[0].outputShape).toEqual([1, 1, 2]);
  });

  it('18. 已匹配网络不弹确认框', () => {
    useLayerStore.setState({
      layers: [
        { id: 'input', type: 'Input', order: 0, position: { x: 0, y: 0, z: 0 }, params: { inChannels: 1, inputHeight: 1, inputWidth: 2 } },
        { id: 'linear', type: 'Linear', order: 1, position: { x: 1, y: 0, z: 0 }, params: { inFeatures: 2, outFeatures: 1 } },
      ],
    });
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('19. 弹窗打开期间模型改变，确认时基于当前模型重算', async () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // 弹窗打开期间用户手动把 Input 改为 4 个特征宽（包在 act 中，避免订阅更新警告）
    act(() => {
      useLayerStore.setState({
        layers: useLayerStore.getState().layers.map(layer =>
          layer.type === 'Input' ? { ...layer, params: { ...layer.params, inputWidth: 4 } } : layer,
        ),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));

    // 以当前模型重算：最终适配到当前有效特征数（2），而不是覆盖成弹窗打开前的旧快照
    const input = useLayerStore.getState().layers.find(layer => layer.type === 'Input');
    expect(input?.params.inputWidth).toBe(2);
  });

  it('20. 弹窗打开期间数据集被替换，旧计划不得应用', async () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    act(() => {
      useDatasetStore.getState().clearDataset();
    });
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));

    // 上下文过期：拒绝应用并提示（不虚构阻断，只说明需重新确认）
    const message = useToastStore.getState().toasts.at(-1)?.message ?? '';
    expect(message).toContain('数据集或任务契约已变化，请重新确认网络适配');
    const input = useLayerStore.getState().layers.find(layer => layer.type === 'Input');
    expect(input?.params.inputWidth).toBe(28); // 未被修改
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('21. 快速连续更换目标列时只有一个弹窗，且最新请求生效', async () => {
    const csv = { ...CSV_RESULT, columns: ['a', 'b', 'c', 'target'] };
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: csv });
    render(<DatasetPanel />);

    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    // 快速把目标列换到 a（target 变为特征）：两次请求接连触发
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'a' } });

    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));

    // 最新请求（目标=a，特征=b、c、target 共 3 列）生效
    const layers = useLayerStore.getState().layers;
    expect(layers[0].params.inputWidth).toBe(3);
  });

  it('22. 应用适配不改变层顺序与场景位置', async () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));

    const layers = useLayerStore.getState().layers;
    expect(layers.map(layer => layer.id)).toEqual(['input', 'flatten', 'linear']);
    expect(layers.map(layer => layer.order)).toEqual([0, 1, 2]);
    expect(layers[2].position).toEqual({ x: 2, y: 0, z: 0 });
  });

  it('23. 统计重算（提交）失败时模型与派生状态完全不变，弹窗可重试', async () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
  
    const before = useLayerStore.getState();
    const beforeSnapshot = { layers: before.layers, validationResult: before.validationResult, totalParams: before.totalParams, hasShapeError: before.hasShapeError };
    // 模拟“首步计算成功、提交/重算失败”：在既有测试只覆盖写入前抛错的基础上补全第二段故障。
    const applySpy = vi.spyOn(useLayerStore.getState(), 'applyAdaptedLayers')
      .mockImplementationOnce(() => { throw new Error('重算失败'); });
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    applySpy.mockRestore();
  
    // 失败：模型与全部派生状态原样保留，错误可见，无半修改状态；弹窗保留可重试。
    const after = useLayerStore.getState();
    expect(after.layers).toEqual(beforeSnapshot.layers);
    expect(after.validationResult).toEqual(beforeSnapshot.validationResult);
    expect(after.totalParams).toBe(beforeSnapshot.totalParams);
    expect(after.hasShapeError).toBe(beforeSnapshot.hasShapeError);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('应用网络适配失败');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  
    // 重试成功：不永久锁死（ConfirmDialog 锁存在事件循环后复位，冲洗定时器后再点）。
    await act(async () => {
      await new Promise(resolve => { setTimeout(resolve, 0); });
    });
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    expect(useLayerStore.getState().layers[0].params.inputWidth).toBe(2);
  });
  
  it('21. 适配计算函数抛错时模型完全不变（受控错误边界）', () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    const adaptMock = vi.mocked(adaptLayersForCsvRegression);
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  
    const before = useLayerStore.getState().layers;
    adaptMock.mockImplementationOnce(() => { throw new Error('adapt boom'); });
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    // mockImplementationOnce 为一次性：消耗后自动回到真实实现，不污染后续用例。
    expect(adaptMock.mock.results.at(-1)?.type).toBe('throw');
  
    expect(useLayerStore.getState().layers).toEqual(before);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('应用网络适配失败');
    // 弹窗保留可重试，不永久锁死。
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
  
  it('24. 成功适配只产生一次完整状态提交，且保留 id/order/position/selectedId', () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    useLayerStore.setState({ selectedId: 'linear' });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
  
    const before = useLayerStore.getState().layers;
    let commits = 0;
    const unsubscribe = useLayerStore.subscribe(() => { commits += 1; });
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    unsubscribe();
  
    // 单次原子提交：不存在“新 layers + 旧统计”的两次可观察提交。
    expect(commits).toBe(1);
    const after = useLayerStore.getState().layers;
    expect(after.map(layer => layer.id)).toEqual(before.map(layer => layer.id));
    expect(after.map(layer => layer.order)).toEqual(before.map(layer => layer.order));
    expect(after.map(layer => layer.position)).toEqual(before.map(layer => layer.position));
    expect(useLayerStore.getState().selectedId).toBe('linear');
  });
  
  it('15. 数据集缺少强身份（无 datasetId / contentHash）时确认 fail-closed', async () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  
    // 模拟旧记录缺少强身份：不得用 type:name 冒充同一身份。
    act(() => {
      const info = useDatasetStore.getState().datasetInfo!;
      useDatasetStore.setState({
        datasetInfo: { ...info, datasetId: undefined, contentHash: undefined },
      });
    });
    const before = useLayerStore.getState().layers;
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('缺少强身份');
    expect(useLayerStore.getState().layers).toEqual(before);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
  
  it('16. 切换走再切回同名数据，旧计划不能复活（导入时间上下文不同）', async () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  
    // 模拟“切走再切回同名数据”：同名同类型同 hash，但导入上下文（重新导入）不同。
    act(() => {
      const info = useDatasetStore.getState().datasetInfo!;
      useDatasetStore.setState({ datasetInfo: { ...info, importedAt: (info.importedAt ?? 0) + 999 } });
    });
    const before = useLayerStore.getState().layers;
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('数据集或任务契约已变化');
    expect(useLayerStore.getState().layers).toEqual(before);
  });
  
  it('17. 弹窗期间修改 splitStrategy，旧计划不能执行', async () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  
    fireEvent.change(screen.getByLabelText('划分策略'), { target: { value: 'group' } });
    const before = useLayerStore.getState().layers;
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('数据集或任务契约已变化');
    expect(useLayerStore.getState().layers).toEqual(before);
  });
  
  it('18. 弹窗期间修改 timeField，旧计划被替换为最新上下文且只有一个模态', () => {
    const csv = { ...CSV_RESULT, columns: ['g', 't', 'f1', 'target'] };
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: csv, splitStrategy: 'temporal', timeField: 't' });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  
    // 弹窗打开期间改时间字段：新请求替换旧请求，始终只有一个模态框。
    fireEvent.change(screen.getByLabelText('时间字段'), { target: { value: 'g' } });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  
    // 确认应用的是最新上下文（不弹陈旧提示，且特征数按最新契约）。
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    const stale = useToastStore.getState().toasts.some(toastItem => toastItem.message.includes('已变化'));
    expect(stale).toBe(false);
    const input = useLayerStore.getState().layers.find(layer => layer.type === 'Input');
    expect(input?.params.inputWidth).toBe(2); // 目标 + 时间字段排除后剩 g 之外 2 列…
  });
  
  it('预览计算抛错时弹窗降级展示，不白屏、不虚假宣称已匹配，确认仍会安全重算', () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    const adaptMock = vi.mocked(adaptLayersForCsvRegression);
    // 第一次调用（打开前差异检查）返回与真实适配等价的结果，确保弹窗打开；
    // 第二次调用（弹窗渲染路径的差异预览）抛错，验证降级而非白屏。
    adaptMock.mockImplementationOnce((layers: Layer3D[]) => layers.map(layer => {
      if (layer.type === 'Input') return { ...layer, params: { ...layer.params, inChannels: 1, inputHeight: 1, inputWidth: 2 } };
      if (layer.type === 'Linear') return { ...layer, params: { ...layer.params, inFeatures: 2, outFeatures: 1 } };
      return { ...layer, params: { ...layer.params } };
    }));
    adaptMock.mockImplementationOnce(() => { throw new Error('preview boom'); });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/适配预览暂时无法计算/)).toBeInTheDocument();
    expect(screen.queryByText(/当前网络已匹配，无需修改/)).not.toBeInTheDocument();

    // 确认时再次安全计算（前两次一次性 mock 已消耗，回到真实实现）并成功应用。
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    const input = useLayerStore.getState().layers.find(layer => layer.type === 'Input');
    expect(input?.params.inputWidth).toBe(2);
  });

  it('19. 快速连续更换目标列多次后，只有最新请求可被确认（过期请求不执行）', () => {
    const csv = { ...CSV_RESULT, columns: ['a', 'b', 'c', 'target'] };
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: csv });
    render(<DatasetPanel />);
  
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    // 最新请求生效：无陈旧提示，适配已应用。
    const stale = useToastStore.getState().toasts.some(toastItem => toastItem.message.includes('已变化'));
    expect(stale).toBe(false);
    const input = useLayerStore.getState().layers.find(layer => layer.type === 'Input');
    expect(input?.params.inputWidth).toBe(3);
  });

  it('选择内置数据集也会触发适配确认（图片形状语义）', async () => {
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('内置数据集'), { target: { value: 'cifar10' } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/3×32×32/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用适配' }));
    const input = useLayerStore.getState().layers.find(layer => layer.type === 'Input');
    expect(input?.params).toMatchObject({ inChannels: 3, inputHeight: 32, inputWidth: 32 });
  });

  it('适配弹窗打开时，清除确认不得叠加第二个模态', () => {
    useDatasetStore.setState({ datasetType: 'csv', datasetInfo: CSV_RESULT });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('回归目标列'), { target: { value: 'target' } });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /清除当前数据集/ }));
    // 仍只有一个模态（适配确认框），清除弹窗未叠加；数据集未被清除
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(useDatasetStore.getState().datasetInfo).not.toBeNull();

    // 适配处理完后仍可清除：取消适配后清除确认正常弹出
    fireEvent.click(screen.getByRole('button', { name: '保留当前网络' }));
    fireEvent.click(screen.getByRole('button', { name: /清除当前数据集/ }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认清除' })).toBeInTheDocument();
  });

  it('导入图片后按首图尺寸触发适配确认', async () => {
    tauriMocks.open.mockResolvedValue('D:/imgs');
    tauriMocks.invoke.mockResolvedValue({
      name: 'imgs', type: 'local_image', sampleCount: 10, classCount: 2,
      channels: 1, imageHeight: 64, imageWidth: 64, datasetId: 'ds-x',
    });
    render(<DatasetPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择图像文件夹/ }));
      await Promise.resolve();
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/1×64×64/)).toBeInTheDocument();
  });
});
