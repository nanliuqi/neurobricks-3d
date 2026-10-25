/**
 * Study 中文标签映射测试（模块 06）：枚举不直接展示；未知值安全显示且不升级。
 */
import { describe, expect, it } from 'vitest';
import {
  attemptStatusLabel,
  auditPersistenceLabel,
  claimStatusLabel,
  conclusionTrustLabel,
  executionTrustLabel,
  isAttemptActive,
  isAttemptCompleted,
  isExecutionTrusted,
  studyKindLabel,
  studyStatusLabel,
  trustSourceLabel,
} from '@/components/panels/study/studyLabels';

describe('studyLabels：中文映射与未知安全', () => {
  it('Study 类型与状态映射为中文，不显示原始枚举', () => {
    expect(studyKindLabel('free_exploration')).toBe('自由探索');
    expect(studyKindLabel('candidate_selection')).toBe('候选选择');
    expect(studyKindLabel('controlled_ablation')).toBe('对照消融');
    expect(studyStatusLabel('draft')).toBe('草稿');
    expect(studyStatusLabel('active')).toBe('进行中');
    expect(studyStatusLabel('closed')).toBe('已关闭');
  });

  it('Attempt 状态、执行可信、来源映射为中文', () => {
    expect(attemptStatusLabel('completed')).toBe('已完成');
    expect(attemptStatusLabel('paused')).toBe('已暂停');
    expect(attemptStatusLabel('cancelled')).toBe('已取消');
    expect(attemptStatusLabel('interrupted')).toBe('已中断');
    expect(executionTrustLabel('trusted')).toBe('执行可信');
    expect(executionTrustLabel('unverified')).toBe('未验证');
    expect(trustSourceLabel('external')).toBe('外部导入');
    expect(trustSourceLabel('legacy')).toBe('历史档案');
  });

  it('Claim 状态与结论信任映射为中文', () => {
    expect(claimStatusLabel('frozen')).toBe('已冻结');
    expect(claimStatusLabel('adjudicated')).toBe('已裁决');
    expect(conclusionTrustLabel('gold')).toBe('金标区间');
    expect(conclusionTrustLabel('not_evaluated')).toBe('未评估');
    expect(auditPersistenceLabel('healthy')).toBe('健康');
    expect(auditPersistenceLabel('degraded')).toBe('降级');
  });

  it('未知枚举显示“未知状态”，且按非完成、非可信处理', () => {
    expect(attemptStatusLabel('mystery')).toBe('未知状态');
    expect(executionTrustLabel('mystery')).toBe('未知状态');
    expect(studyKindLabel('mystery')).toBe('未知类型');
    expect(isAttemptCompleted('mystery')).toBe(false);
    expect(isAttemptCompleted('completed')).toBe(true);
    expect(isExecutionTrusted('mystery')).toBe(false);
    expect(isAttemptActive('running')).toBe(true);
    expect(isAttemptActive('mystery')).toBe(false);
  });
});
