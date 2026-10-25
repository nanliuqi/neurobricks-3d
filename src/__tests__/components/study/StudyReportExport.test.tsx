/**
 * StudyReportExport 交互测试（模块 06）：
 * window.confirm 迁移、审计降级确认前不导出、取消事件、单次选择器/单次导出、
 * 待确认期间切换 Study 不串用身份。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudyReportExport from '@/components/study/StudyReportExport';
import { useExperimentStore, verifyExperimentLedgerAudit } from '@/stores/useExperimentStore';
import { TRUST_PROTOCOL_VERSION, type Study } from '@/types/experiment';

const tauriMocks = vi.hoisted(() => ({
  open: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/dialog', () => ({ open: tauriMocks.open }));
vi.mock('@tauri-apps/api/tauri', () => ({ invoke: tauriMocks.invoke }));

// 审计校验结果必须可控：真实实现依赖桌面运行时，测试环境无法真正写盘。
vi.mock('@/stores/useExperimentStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/useExperimentStore')>();
  return {
    ...actual,
    verifyExperimentLedgerAudit: vi.fn(),
  };
});

const auditMock = vi.mocked(verifyExperimentLedgerAudit);

function makeStudy(id: string, name: string): Study {
  return {
    id,
    protocolVersion: TRUST_PROTOCOL_VERSION,
    name,
    kind: 'candidate_selection',
    status: 'draft',
    question: '问题',
    datasetContract: {
      identity: {
        id: 'ds-1', name: 'MNIST', taskType: 'image_classification',
        contentHash: 'hash', fingerprintAlgorithm: 'sha256-v1', sampleCount: 10, importedAt: 1,
      },
      split: {
        strategy: 'random', seed: 42, validationRatio: 0.2, testRatio: 0.2,
        sampleUnit: 'image', independence: 'iid_assumed', machineChecks: [], splitHash: null,
      },
      preprocessing: { configHash: null, summary: 'dataset=mnist' },
    },
    comparisonKey: null,
    selectionRule: null,
    budget: { maxExperiments: null, maxGpuMinutes: null },
    selectedExperimentId: null,
    selectedAttemptId: null,
    createdAt: 1,
    updatedAt: 1,
    lockedAt: null,
  };
}

function setup(studyId = 'study-a', activeStudyId: string | null = 'study-a') {
  useExperimentStore.setState({
    ledger: {
      protocolVersion: TRUST_PROTOCOL_VERSION,
      ledgerId: 'ledger-export',
      studies: [makeStudy('study-a', '课题 A'), makeStudy('study-b', '课题 B')],
      experiments: [],
      attempts: [],
      claims: [],
      events: [],
    },
    activeStudyId,
    auditPersistence: 'degraded',
    auditError: null,
  });
  return render(<StudyReportExport studyId={studyId} studyName="课题 A" />);
}

function eventTypes(): string[] {
  return useExperimentStore.getState().ledger.events.map(event => event.eventType);
}

describe('StudyReportExport', () => {
  beforeEach(() => {
    tauriMocks.open.mockReset();
    tauriMocks.invoke.mockReset();
    auditMock.mockReset();
    useExperimentStore.getState().resetLedgerForTests();
  });

  it('不再调用 window.confirm（审计降级使用 ConfirmDialog）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    tauriMocks.open.mockResolvedValue('D:/reports');
    auditMock.mockResolvedValue(false);
    setup();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出 Study 报告/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: '审计链未通过校验，仍然导出？' })).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('审计降级时：确认前不调用最终导出，目录选择器只打开一次', async () => {
    tauriMocks.open.mockResolvedValue('D:/reports');
    auditMock.mockResolvedValue(false);
    setup();

    const exportButton = screen.getByRole('button', { name: /导出 Study 报告/ });
    await act(async () => {
      fireEvent.click(exportButton);
      await Promise.resolve();
      await Promise.resolve();
    });
    // 待确认期间再次点击不得打开第二个选择器
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出 Study 报告/ }));
      await Promise.resolve();
    });

    expect(tauriMocks.open).toHaveBeenCalledTimes(1);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(eventTypes()).toContain('study_report_export_requested');
  });

  it('取消降级导出：写入 export_cancelled，不导出文件', async () => {
    tauriMocks.open.mockResolvedValue('D:/reports');
    auditMock.mockResolvedValue(false);
    setup();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出 Study 报告/ }));
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: '取消导出' }));

    expect(eventTypes()).toContain('study_report_export_cancelled');
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('确认降级导出：使用已选目录，只执行一次导出', async () => {
    tauriMocks.open.mockResolvedValue('D:/reports');
    tauriMocks.invoke.mockResolvedValue(undefined);
    auditMock.mockResolvedValue(false);
    setup();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出 Study 报告/ }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '带档案不完整标记导出' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tauriMocks.open).toHaveBeenCalledTimes(1); // 不再次打开选择器
    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
    const invokeCall = tauriMocks.invoke.mock.calls[0];
    expect(invokeCall[0]).toBe('export_study_report');
    expect(String((invokeCall[1] as { dirPath: string }).dirPath)).toContain('D:/reports');
    expect(eventTypes()).toContain('study_report_export_completed');
  });

  it('审计健康时直接导出，不弹确认框', async () => {
    tauriMocks.open.mockResolvedValue('D:/reports');
    tauriMocks.invoke.mockResolvedValue(undefined);
    auditMock.mockResolvedValue(true);
    setup();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出 Study 报告/ }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('等待确认期间切换 Study：旧 Study 的报告不得导出', async () => {
    tauriMocks.open.mockResolvedValue('D:/reports');
    auditMock.mockResolvedValue(false);
    setup('study-a', 'study-a');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出 Study 报告/ }));
      await Promise.resolve();
      await Promise.resolve();
    });
    // 待确认期间活动 Study 切换到 B
    act(() => {
      useExperimentStore.getState().setActiveStudy('study-b');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '带档案不完整标记导出' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // 身份防串用：不导出、弹窗作废
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('选择器取消时不写事件、不报错', async () => {
    tauriMocks.open.mockResolvedValue(null);
    setup();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出 Study 报告/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(eventTypes()).not.toContain('study_report_export_requested');
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: /导出 Study 报告/ })).toBeEnabled());
  });
});

describe('StudyReportExport 冻结快照（TOCTOU 修复）', () => {
  beforeEach(() => {
    tauriMocks.open.mockReset();
    tauriMocks.invoke.mockReset();
    auditMock.mockReset();
    useExperimentStore.getState().resetLedgerForTests();
  });

  async function openDegradedDialog() {
    tauriMocks.open.mockResolvedValue('D:/reports');
    auditMock.mockResolvedValue(false);
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出 Study 报告/ }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('alertdialog', { name: '审计链未通过校验，仍然导出？' })).toBeInTheDocument();
  }

  it('确认前审计恢复 healthy：导出仍带档案不完整水印（不因恢复移除）', async () => {
    await openDegradedDialog();
    tauriMocks.invoke.mockResolvedValue(undefined);

    // 等待确认期间审计状态被恢复
    act(() => {
      useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '带档案不完整标记导出' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
    const payload = tauriMocks.invoke.mock.calls[0][1] as { readmeMd: string };
    // 冻结快照带请求时的降级水印；不得变成健康文案
    expect(payload.readmeMd).toContain('档案完整性警告');
    expect(payload.readmeMd).not.toContain('只追加 JSONL 审计在导出前校验通过');
  });

  it('确认前同 Study 新增证据：导出内容仍是请求时冻结的 bundle', async () => {
    await openDegradedDialog();
    tauriMocks.invoke.mockResolvedValue(undefined);

    // 等待确认期间向同一 Study 新增 Attempt
    act(() => {
      const state = useExperimentStore.getState();
      state.ledger.attempts.push({
        id: 'att-late',
        protocolVersion: TRUST_PROTOCOL_VERSION,
        experimentId: 'exp-late',
        runId: 'run-late',
        modelId: null,
        config: {} as never,
        ordinal: 9,
        parentAttemptId: null,
        restartCount: 0,
        resumeType: 'fresh',
        status: 'completed',
        startedAt: 1,
        endedAt: 2,
        provenance: {} as never,
        metrics: [],
        artifacts: null,
        executionMode: 'native',
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '带档案不完整标记导出' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
    const payload = tauriMocks.invoke.mock.calls[0][1] as { manifestJson: string; readmeMd: string };
    // 新增证据不得悄悄混入冻结的报告
    expect(payload.manifestJson).not.toContain('att-late');
    expect(payload.readmeMd).not.toContain('att-late');
  });

  it('失败后重试使用同一个冻结快照（dirPath 与内容一致）', async () => {
    await openDegradedDialog();
    tauriMocks.invoke.mockRejectedValueOnce(new Error('磁盘写入失败'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '带档案不完整标记导出' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    // 失败：弹窗保留，事件留痕
    expect(eventTypes()).toContain('study_report_export_failed');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // ConfirmDialog 锁存在事件循环后复位；冲洗定时器后重试
    tauriMocks.invoke.mockResolvedValueOnce(undefined);
    await act(async () => {
      await new Promise(resolve => { setTimeout(resolve, 0); });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '带档案不完整标记导出' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = tauriMocks.invoke.mock.calls.map(call => call[1] as Record<string, unknown>);
    // 同一个冻结快照：目录名与内容完全一致，不重新生成
    expect(secondCall.dirPath).toBe(firstCall.dirPath);
    expect(secondCall.readmeMd).toBe(firstCall.readmeMd);
    expect(secondCall.manifestJson).toBe(firstCall.manifestJson);
  });

  it('连续快速确认只执行一次 invoke', async () => {
    await openDegradedDialog();
    tauriMocks.invoke.mockResolvedValue(undefined);

    const confirmButton = screen.getByRole('button', { name: '带档案不完整标记导出' });
    await act(async () => {
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
  });
});
