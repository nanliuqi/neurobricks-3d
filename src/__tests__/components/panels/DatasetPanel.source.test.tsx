/**
 * 数据集工作台：数据来源、异步互斥、安全清除、卸载安全。
 * 覆盖验收清单 A（1-9）与 B（10-14）组。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DatasetPanel from '@/components/panels/DatasetPanel';
import { useToastStore } from '@/components/ui/Toast';
import { useDatasetStore } from '@/stores/useDatasetStore';
import type { DatasetInfo } from '@/types/dataset';

const tauriMocks = vi.hoisted(() => ({
  open: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/dialog', () => ({ open: tauriMocks.open }));
vi.mock('@tauri-apps/api/tauri', () => ({ invoke: tauriMocks.invoke }));

const CSV_RESULT: DatasetInfo = {
  name: 'regression',
  type: 'csv',
  sampleCount: 100,
  classCount: 0,
  columns: ['a', 'b', 'target'],
  datasetId: 'ds-csv-1',
  contentHash: 'hash-csv-1',
};

const IMAGE_RESULT: DatasetInfo = {
  name: 'img-dir',
  type: 'local_image',
  sampleCount: 40,
  classCount: 2,
  channels: 3,
  imageHeight: 32,
  imageWidth: 32,
  datasetId: 'ds-img-1',
  contentHash: 'hash-img-1',
};

function resetStores() {
  useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
  useToastStore.setState({ toasts: [] });
  tauriMocks.open.mockReset();
  tauriMocks.invoke.mockReset();
}

describe('数据集工作台：数据来源与异步互斥', () => {
  beforeEach(resetStores);

  it('1. 内置数据集选择与 store 同步（下拉值由 store 推导）', () => {
    useDatasetStore.setState({
      datasetType: 'mnist',
      datasetInfo: { name: 'MNIST', type: 'mnist', sampleCount: 60000, classCount: 10 },
    });
    render(<DatasetPanel />);
    expect((screen.getByLabelText('内置数据集') as HTMLSelectElement).value).toBe('mnist');
  });

  it('2. 导入自定义数据后，内置下拉不残留旧选中值', async () => {
    // 先选择 MNIST，再导入 CSV
    useDatasetStore.setState({
      datasetType: 'mnist',
      datasetInfo: { name: 'MNIST', type: 'mnist', sampleCount: 60000, classCount: 10 },
    });
    tauriMocks.open.mockResolvedValue('D:/data.csv');
    tauriMocks.invoke.mockResolvedValue(CSV_RESULT);
    render(<DatasetPanel />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }));
      await Promise.resolve();
    });

    expect(useDatasetStore.getState().datasetInfo?.type).toBe('csv');
    // 不得继续显示旧的 MNIST 选中状态
    expect((screen.getByLabelText('内置数据集') as HTMLSelectElement).value).toBe('');
  });

  it('3. 系统选择器取消时不显示错误', async () => {
    tauriMocks.open.mockResolvedValue(null);
    render(<DatasetPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择图像文件夹/ }));
      await Promise.resolve();
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it('4. 后端错误转换为明确中文提示，不显示 undefined（字符串/对象/空值）', async () => {
    tauriMocks.open.mockResolvedValue('D:/dir');
    tauriMocks.invoke.mockRejectedValue(undefined);
    render(<DatasetPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择图像文件夹/ }));
      await Promise.resolve();
    });
    const message = useToastStore.getState().toasts.at(-1)?.message ?? '';
    expect(message).toContain('导入图像数据集失败');
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('[object Object]');
  });

  it('5. 导入期间重复点击只触发一次选择器（同步重入锁）', async () => {
    let releaseOpen: (value: string | null) => void = () => {};
    tauriMocks.open.mockReturnValue(new Promise(resolve => { releaseOpen = resolve; }));
    render(<DatasetPanel />);
    const button = screen.getByRole('button', { name: /选择图像文件夹/ });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(tauriMocks.open).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => {
      releaseOpen(null);
      await Promise.resolve();
    });
  });

  it('6. 图片导入进行中时，CSV 入口不得并发打开选择器', async () => {
    let releaseOpen: (value: string | null) => void = () => {};
    tauriMocks.open.mockReturnValue(new Promise(resolve => { releaseOpen = resolve; }));
    render(<DatasetPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择图像文件夹/ }));
      await Promise.resolve();
    });
    const csvButton = screen.getByRole('button', { name: /选择 CSV 文件/ });
    expect(csvButton).toBeDisabled();
    await act(async () => {
      fireEvent.click(csvButton);
      await Promise.resolve();
    });
    expect(tauriMocks.open).toHaveBeenCalledTimes(1);
    await act(async () => {
      releaseOpen(null);
      await Promise.resolve();
    });
  });

  it('7-8. Excel 按钮绝不调用系统选择器或导入命令', () => {
    render(<DatasetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /选择 Excel 文件/ }));
    expect(tauriMocks.open).not.toHaveBeenCalled();
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it('9. 组件卸载后的异步结果不产生状态更新错误', async () => {
    let releaseOpen: (value: string | null) => void = () => {};
    tauriMocks.open.mockReturnValue(new Promise(resolve => { releaseOpen = resolve; }));
    tauriMocks.invoke.mockResolvedValue(CSV_RESULT);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<DatasetPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }));
      await Promise.resolve();
    });
    unmount();
    // 卸载后才让选择器与导入完成：不得抛错，也不得更新已卸载组件状态
    await act(async () => {
      releaseOpen('D:/late.csv');
      await Promise.resolve();
      await Promise.resolve();
    });
    const reactWarnings = consoleErrorSpy.mock.calls.filter(call =>
      String(call[0]).includes("Can't perform a React state update on an unmounted component"),
    );
    expect(reactWarnings).toHaveLength(0);
    consoleErrorSpy.mockRestore();
  });

  it('内置选择占位项不承担清除动作', () => {
    useDatasetStore.setState({
      datasetType: 'mnist',
      datasetInfo: { name: 'MNIST', type: 'mnist', sampleCount: 60000, classCount: 10 },
    });
    render(<DatasetPanel />);
    fireEvent.change(screen.getByLabelText('内置数据集'), { target: { value: '' } });
    // 占位项选择后数据集仍然存在（清除必须走确认框）
    expect(useDatasetStore.getState().datasetInfo).not.toBeNull();
  });

  it('25. deferred open 期间显示 selecting-image / selecting-csv', async () => {
    let releaseOpen: (value: string | null) => void = () => {};
    // 每次调用创建新的待决 Promise，避免复用已决议 Promise 导致阶段一闪而过。
    tauriMocks.open.mockImplementation(() => new Promise(resolve => { releaseOpen = resolve; }));
    render(<DatasetPanel />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择图像文件夹/ }));
      await Promise.resolve();
    });
    expect(screen.getByText('正在选择图片目录…')).toBeInTheDocument();
    await act(async () => {
      releaseOpen(null);
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }));
      await Promise.resolve();
    });
    expect(screen.getByText('正在选择 CSV 文件…')).toBeInTheDocument();
    await act(async () => {
      releaseOpen(null);
      await Promise.resolve();
    });
  });

  it('26. 选择器返回路径、invoke 未完成时显示 importing 阶段', async () => {
    let releaseInvoke: (value: DatasetInfo) => void = () => {};
    tauriMocks.open.mockResolvedValue('D:/imgs');
    tauriMocks.invoke.mockReturnValue(new Promise(resolve => { releaseInvoke = resolve; }));
    render(<DatasetPanel />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择图像文件夹/ }));
      await Promise.resolve();
      await Promise.resolve();
    });
    // open 已解析、invoke 未返回：真实阶段是导入而非选择
    expect(screen.getByText('正在导入图片数据集…')).toBeInTheDocument();
    expect(screen.queryByText('正在选择图片目录…')).not.toBeInTheDocument();

    await act(async () => {
      releaseInvoke(IMAGE_RESULT);
      await Promise.resolve();
    });
  });

  it('26b. CSV 导入阶段显示“正在导入 CSV…”', async () => {
    let releaseInvoke: (value: DatasetInfo) => void = () => {};
    tauriMocks.open.mockResolvedValue('D:/data.csv');
    tauriMocks.invoke.mockReturnValue(new Promise(resolve => { releaseInvoke = resolve; }));
    render(<DatasetPanel />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('正在导入 CSV…')).toBeInTheDocument();
    await act(async () => {
      releaseInvoke(CSV_RESULT);
      await Promise.resolve();
    });
  });

  it('27. 所有选择与导入阶段共享互斥锁（导入中不得再开选择器）', async () => {
    let releaseInvoke: (value: DatasetInfo) => void = () => {};
    tauriMocks.open.mockResolvedValue('D:/imgs');
    tauriMocks.invoke.mockReturnValue(new Promise(resolve => { releaseInvoke = resolve; }));
    render(<DatasetPanel />);
    // 提前捕获按钮引用：导入阶段可访问名会变为“正在导入…”。
    const imageButton = screen.getByRole('button', { name: /选择图像文件夹/ });
    const csvButton = screen.getByRole('button', { name: /选择 CSV 文件/ });
  
    await act(async () => {
      fireEvent.click(imageButton);
      await Promise.resolve();
      await Promise.resolve();
    });
    // 导入进行中：CSV 与图片入口均禁用，点击不触发新的选择器/调用。
    expect(csvButton).toBeDisabled();
    expect(imageButton).toBeDisabled();
    await act(async () => {
      fireEvent.click(imageButton);
      await Promise.resolve();
    });
    expect(tauriMocks.open).toHaveBeenCalledTimes(1);
    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      releaseInvoke(IMAGE_RESULT);
      await Promise.resolve();
    });
  });

  it('28. invoke 成功与失败后都恢复 idle（锁必定释放，可再次导入）', async () => {
    tauriMocks.open.mockResolvedValue('D:/data.csv');
    tauriMocks.invoke.mockResolvedValueOnce(CSV_RESULT);
    render(<DatasetPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: /选择 CSV 文件/ })).not.toBeDisabled();

    tauriMocks.invoke.mockRejectedValueOnce(new Error('解析失败'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }));
      await Promise.resolve();
    });
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('导入 CSV 失败');
    // 失败后锁释放：按钮恢复可用且可再次触发（第三次）
    expect(screen.getByRole('button', { name: /选择 CSV 文件/ })).not.toBeDisabled();
    tauriMocks.invoke.mockResolvedValueOnce(CSV_RESULT);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }));
      await Promise.resolve();
    });
    expect(tauriMocks.invoke).toHaveBeenCalledTimes(3);
  });
});

describe('数据集工作台：安全清除', () => {
  beforeEach(() => {
    resetStores();
    useDatasetStore.setState({
      datasetType: 'csv',
      datasetPath: 'D:/data.csv',
      datasetInfo: CSV_RESULT,
      targetField: 'target',
      splitStrategy: 'temporal',
      timeField: 'b',
    });
  });

  it('10. 点击清除后出现确认框', () => {
    render(<DatasetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /清除当前数据集/ }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('11. 取消后数据集、目标列、切分设置全部不变', () => {
    render(<DatasetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /清除当前数据集/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(useDatasetStore.getState()).toMatchObject({
      datasetType: 'csv',
      datasetPath: 'D:/data.csv',
      targetField: 'target',
      splitStrategy: 'temporal',
      timeField: 'b',
    });
    expect(useDatasetStore.getState().datasetInfo).not.toBeNull();
  });

  it('12. 确认后调用现有清除动作（选择与字段被清除）', () => {
    render(<DatasetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /清除当前数据集/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认清除' }));
    expect(useDatasetStore.getState()).toMatchObject({
      datasetInfo: null,
      datasetType: null,
      targetField: null,
      groupField: null,
      timeField: null,
    });
    // 清除后回到“未选择”状态
    expect((screen.getByLabelText('内置数据集') as HTMLSelectElement).value).toBe('');
  });

  it('13. 连续确认不会执行两次清除动作', () => {
    const clearSpy = vi.spyOn(useDatasetStore.getState(), 'clearDataset');
    render(<DatasetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /清除当前数据集/ }));
    const confirmButton = screen.getByRole('button', { name: '确认清除' });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });

  it('14. 确认框明确说明不删除磁盘文件与历史档案', () => {
    render(<DatasetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /清除当前数据集/ }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('将清除当前数据集选择');
    expect(dialog.textContent).toContain('目标列和切分字段选择');
    expect(dialog.textContent).toContain('不会删除你磁盘上的原始文件');
    expect(dialog.textContent).toContain('不会删除已有 Study、Attempt 或审计记录');
  });

  it('无数据集时不显示清除按钮', () => {
    useDatasetStore.setState({ ...useDatasetStore.getInitialState() });
    render(<DatasetPanel />);
    expect(screen.queryByRole('button', { name: /清除当前数据集/ })).not.toBeInTheDocument();
  });
});
