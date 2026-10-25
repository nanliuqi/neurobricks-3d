import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DatasetPanel from '@/components/panels/DatasetPanel';
import { useToastStore } from '@/components/ui/Toast';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { LOCAL_IMAGE_PARENT_GROUP_FIELD } from '@/types/dataset';

const tauriMocks = vi.hoisted(() => ({
  open: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/dialog', () => ({ open: tauriMocks.open }));
vi.mock('@tauri-apps/api/tauri', () => ({ invoke: tauriMocks.invoke }));

describe('DatasetPanel split strategy contract', () => {
  beforeEach(() => {
    tauriMocks.open.mockReset();
    tauriMocks.invoke.mockReset();
    useToastStore.setState({ toasts: [] });
    useDatasetStore.setState({
      ...useDatasetStore.getInitialState(),
      datasetType: 'local_image',
      datasetPath: 'D:/review-images-nested',
      datasetInfo: {
        name: 'review-images-nested',
        type: 'local_image',
        sampleCount: 400,
        classCount: 2,
        imageGroup: {
          field: LOCAL_IMAGE_PARENT_GROUP_FIELD,
          label: '类别内第一级子目录',
          distinctCount: 4,
          groupedSampleCount: 400,
          groupsPerClass: { defect: 2, normal: 2 },
          available: true,
          readinessWarning: '三路分类划分要求每类至少覆盖 3 个独立组',
        },
      },
    });
  });

  it('shows image group selection, binds the controlled field, and explains unavailable temporal semantics', () => {
    render(<DatasetPanel />);

    const strategy = screen.getByLabelText('划分策略');
    expect(screen.getByRole('option', { name: '按分组隔离' })).not.toBeDisabled();
    expect(screen.getByRole('option', { name: '按时间先后（仅 CSV）' })).toBeDisabled();

    fireEvent.change(strategy, { target: { value: 'group' } });

    expect(useDatasetStore.getState()).toMatchObject({
      splitStrategy: 'group',
      groupField: LOCAL_IMAGE_PARENT_GROUP_FIELD,
      timeField: null,
    });
    expect(screen.getByText(/分组字段：类别内第一级子目录 · 4 组/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('每类至少覆盖 3 个独立组');
    expect(screen.getByText(/文件修改时间不代表业务时间/)).toBeInTheDocument();
  });

  it('keeps CSV group and temporal fields selectable', () => {
    useDatasetStore.setState({
      datasetType: 'csv',
      datasetPath: 'D:/regression.csv',
      datasetInfo: {
        name: 'regression',
        type: 'csv',
        sampleCount: 100,
        classCount: 0,
        columns: ['customer_id', 'captured_at', 'feature', 'target'],
      },
    });
    render(<DatasetPanel />);

    fireEvent.change(screen.getByLabelText('划分策略'), { target: { value: 'temporal' } });
    fireEvent.change(screen.getByLabelText('时间字段'), { target: { value: 'captured_at' } });

    expect(useDatasetStore.getState()).toMatchObject({
      splitStrategy: 'temporal',
      groupField: null,
      timeField: 'captured_at',
    });
  });

  it('shows the actionable backend reason when CSV import rejects NaN/Infinity', async () => {
    tauriMocks.open.mockResolvedValue('D:/nonnumeric_target.csv');
    tauriMocks.invoke.mockRejectedValue({
      message: undefined,
      error: 'CSV 列“glucose”包含 NaN/Infinity，第 2 行无效',
    });
    render(<DatasetPanel />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
        '导入 CSV 失败：CSV 列“glucose”包含 NaN/Infinity，第 2 行无效'
      );
    });
    expect(useDatasetStore.getState().datasetPath).toBe('D:/review-images-nested');
  });

  it('uses a CSV-specific fallback when IPC supplies no error details', async () => {
    tauriMocks.open.mockResolvedValue('D:/nonnumeric_target.csv');
    tauriMocks.invoke.mockRejectedValue(undefined);
    render(<DatasetPanel />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }));
      await Promise.resolve();
    });

    await waitFor(() => {
      const message = useToastStore.getState().toasts.at(-1)?.message ?? '';
      // 新兜底必须匹配真实导入协议：不再暗示末列是目标。
      expect(message).toContain('至少包含两列');
      expect(message).toContain('目标列需在导入成功后于数据集面板明确选择');
      expect(message).not.toContain('undefined');
      expect(message).not.toContain('末列');
    });
  });

  it('explains the Excel boundary without opening a file picker', () => {
    render(<DatasetPanel />);

    fireEvent.click(screen.getByRole('button', { name: /选择 Excel 文件/ }));

    expect(tauriMocks.open).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      type: 'info',
      message: 'Excel 导入功能开发中，请使用 CSV 文件或内置数据集',
    });
  });
});
