/**
 * 预算与使用量（模块 06）：
 * - GPU 分钟计算共用 studyUsedGpuMinutes（与 experimentRuntime 阻断同算法）；
 * - 运行中 Attempt 按 now 计时，定时器仅在存在运行态时启动，卸载/切换即清理；
 * - 进度条只做视觉表示并钳制 0~100%，文字显示真实数值（允许超额）；
 * - 达到/超过预算有文字提示；不承诺“程序一定会自动停止”（阻断由 runtime 裁决）；
 * - 展示层不消耗预算、不改变 Attempt。
 */
import StatusBadge from '@/components/ui/StatusBadge';
import type { Attempt, Experiment, Study } from '@/types/experiment';
import { buildBudgetView } from './studyOverviewViewModel';
import { useNow } from './useNow';

interface StudyBudgetSummaryProps {
  study: Study;
  experiments: Experiment[];
  attempts: Attempt[];
  /** 测试可注入固定时间，避免依赖真实时钟。 */
  nowOverride?: number;
}

export default function StudyBudgetSummary({ study, experiments, attempts, nowOverride }: StudyBudgetSummaryProps) {
  const hasRunningAttempt = attempts.some(attempt => ['starting', 'running', 'paused'].includes(attempt.status));
  const tickingNow = useNow(hasRunningAttempt);
  const now = nowOverride ?? tickingNow;
  const budget = buildBudgetView(study, experiments, attempts, now);

  return (
    <section className="study-wb-section" aria-label="预算与使用量">
      <h4 className="study-wb-section__title">预算与使用量</h4>
      <div className="study-panel__facts study-wb-budget-facts">
        <span>
          实验 {budget.experimentsUsed}/{budget.experimentsMax ?? '不限'}
          {budget.experimentBudgetReached && '（已达实验数预算上限）'}
        </span>
        <span>
          GPU {budget.gpuMinutesUsed.toFixed(1)}/{budget.gpuMinutesMax ?? '不限'} 分钟
          {budget.gpuBudgetReached && budget.gpuMinutesMax !== null && (
            budget.gpuMinutesUsed > budget.gpuMinutesMax
              ? `（已超出预算 ${(budget.gpuMinutesUsed - budget.gpuMinutesMax).toFixed(1)} 分钟）`
              : '（已达预算上限）'
          )}
        </span>
        <span>{budget.runningAttemptCount > 0 ? `运行中 Attempt ${budget.runningAttemptCount} 个` : '当前无运行中 Attempt'}</span>
      </div>
      {budget.gpuMinutesMax !== null && (
        <div
          role="progressbar"
          aria-label="GPU 预算使用进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(budget.gpuProgressPercent)}
          className="study-wb-progress"
        >
          <div
            className="study-wb-progress__fill"
            style={{ width: `${budget.gpuProgressPercent}%` }}
          />
        </div>
      )}
      {budget.gpuBudgetReached && (
        <StatusBadge
          tone="warning"
          label="GPU 预算已用尽"
          description="是否阻断新训练由运行时预算检查裁决；此处仅说明现状。"
        />
      )}
    </section>
  );
}
