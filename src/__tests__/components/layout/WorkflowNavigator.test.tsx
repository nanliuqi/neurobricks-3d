import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkflowNavigator from '@/components/layout/WorkflowNavigator';
import { projectWorkflow } from '@/utils/workflowProjection';
import type { WorkflowFacts } from '@/types/workflow';

function makeFacts(overrides: Partial<WorkflowFacts> = {}): WorkflowFacts {
  return {
    hasDataset: false,
    datasetAttention: false,
    hasLayers: false,
    structureValid: false,
    trainStatus: 'idle',
    activeStudy: null,
    latestClaim: null,
    auditDegraded: false,
    hasHistoricalTrustedAttempt: false,
    currentStudyExportRecorded: false,
    hasHistoricalExportRecord: false,
    ...overrides,
  };
}

const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

describe('WorkflowNavigator', () => {
  it('展示六个阶段与有序列表语义，且整体为命名导航区', () => {
    render(<WorkflowNavigator projection={projectWorkflow(makeFacts())} onNavigate={() => {}} />);
    const nav = screen.getByRole('navigation', { name: '可信实验工作流' });
    expect(nav).toBeInTheDocument();
    const list = within(nav).getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
  });

  it('所有阶段按钮有准确可访问名称（阶段名称 + 当前状态）', () => {
    render(
      <WorkflowNavigator
        projection={projectWorkflow(makeFacts({ trainStatus: 'training' }))}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: '数据，未开始' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '训练，训练进行中' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出，未开始' })).toBeInTheDocument();
  });

  it('同时只有一个 aria-current="step"', () => {
    const { container } = render(
      <WorkflowNavigator projection={projectWorkflow(makeFacts())} onNavigate={() => {}} />,
    );
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('点击阶段只发出导航意图，并映射到正确的面板', () => {
    const onNavigate = vi.fn();
    render(<WorkflowNavigator projection={projectWorkflow(makeFacts())} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /^数据/ }));
    expect(onNavigate).toHaveBeenLastCalledWith('dataset');
    fireEvent.click(screen.getByRole('button', { name: /^模型/ }));
    expect(onNavigate).toHaveBeenLastCalledWith('param');
    fireEvent.click(screen.getByRole('button', { name: /^训练/ }));
    expect(onNavigate).toHaveBeenLastCalledWith('trainMonitor');
    fireEvent.click(screen.getByRole('button', { name: /^对比/ }));
    expect(onNavigate).toHaveBeenLastCalledWith('study');
    fireEvent.click(screen.getByRole('button', { name: /^主张/ }));
    expect(onNavigate).toHaveBeenLastCalledWith('study');
    fireEvent.click(screen.getByRole('button', { name: /^导出/ }));
    expect(onNavigate).toHaveBeenLastCalledWith('export');
  });

  it('阶段文案不使用 emoji，图标为装饰性（aria-hidden）', () => {
    const { container } = render(
      <WorkflowNavigator projection={projectWorkflow(makeFacts({ trainStatus: 'paused' }))} onNavigate={() => {}} />,
    );
    const nav = screen.getByRole('navigation', { name: '可信实验工作流' });
    expect(nav.textContent ?? '').not.toMatch(EMOJI_PATTERN);
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('下一步建议：文案可见、按钮只导航', () => {
    const onNavigate = vi.fn();
    render(
      <WorkflowNavigator
        projection={projectWorkflow(makeFacts({ hasDataset: true, hasLayers: true, structureValid: false }))}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('workflow-next-action')).toHaveTextContent('模型结构校验未通过');
    const button = screen.getByRole('button', { name: '前往参数面板' });
    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('param');
  });

  it('窄窗口下六个步骤仍存在于 DOM（横向滚动而非消失）', () => {
    render(<WorkflowNavigator projection={projectWorkflow(makeFacts())} onNavigate={() => {}} />);
    for (const id of ['data', 'model', 'train', 'compare', 'claim', 'export']) {
      expect(screen.getByTestId(`workflow-stage-${id}`)).toBeInTheDocument();
    }
  });
});
