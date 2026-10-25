/**
 * 测试集级解封序号投影测试（模块 08 可信边界补丁）：
 * first / subsequent / retry / invalid 四态、快照不一致警告、
 * 只信任合法 claim_unsealed 事件；UI 与 evaluateFrozenClaim 共享本投影。
 */
import { describe, expect, it } from 'vitest';
import { projectClaimUnseal } from '@/utils/claimUnsealProjection';
import type { EvaluationClaim, LedgerEvent } from '@/types/experiment';

function makeClaim(overrides: Partial<EvaluationClaim> = {}): EvaluationClaim {
  return {
    id: 'claim-b', protocolVersion: 1, studyId: 'study-1', attemptId: 'att-1',
    modelWeightsHash: 'sha256:weights', testDatasetHash: 'sha256:test-B', preprocessingHash: 'sha256:pre',
    status: 'frozen', revision: 1, predicates: [],
    frozenHash: 'sha256:frozen-b', frozenAt: 2, unsealSequence: null, adjudicatedAt: null,
    verdict: null, predicateResults: [], classificationDiagnostics: null,
    conclusionTrust: 'not_evaluated', createdAt: 1, updatedAt: 2,
    ...overrides,
  } as EvaluationClaim;
}

function unsealedEvent(claimId: string, testSetHash: string, frozenHash: string, sequence: number, eventId = `ev-${claimId}-${sequence}`): LedgerEvent {
  return {
    eventId, protocolVersion: 1, sequence: 10, occurredAt: 100,
    entityType: 'claim', entityId: claimId, eventType: 'claim_unsealed',
    payload: { frozenHash, testSetHash, unsealSequence: sequence },
  } as LedgerEvent;
}

describe('projectClaimUnseal：测试集级解封投影', () => {
  it('测试集没有历史解封 → first，sequence=1', () => {
    const projection = projectClaimUnseal(makeClaim(), []);
    expect(projection.mode).toBe('first');
    expect(projection.sequence).toBe(1);
    expect(projection.recordedSequence).toBeNull();
  });

  it('Claim A 已用 testHash=T、seq=1；Claim B 同 T 未解封 → subsequent，sequence=2', () => {
    const events = [unsealedEvent('claim-a', 'sha256:test-B', 'sha256:frozen-a', 1)];
    const projection = projectClaimUnseal(makeClaim(), events);
    expect(projection.mode).toBe('subsequent');
    expect(projection.sequence).toBe(2);
    expect(projection.testSetHistory).toEqual([1]);
    expect(projection.reasons.join('')).toContain('不具首次独立验证资格');
  });

  it('同一测试集已有 seq 1、2 → 新 Claim 显示 sequence=3', () => {
    const events = [
      unsealedEvent('claim-a', 'sha256:test-B', 'sha256:frozen-a', 1),
      unsealedEvent('claim-a2', 'sha256:test-B', 'sha256:frozen-a2', 2),
    ];
    const projection = projectClaimUnseal(makeClaim(), events);
    expect(projection.mode).toBe('subsequent');
    expect(projection.sequence).toBe(3);
    expect(projection.testSetHistory).toEqual([1, 2]);
  });

  it('当前 Claim 有合法解封事件、快照 unsealSequence=null → retry + snapshotMismatch，不误判 first', () => {
    const events = [unsealedEvent('claim-b', 'sha256:test-B', 'sha256:frozen-b', 1)];
    const projection = projectClaimUnseal(makeClaim({ unsealSequence: null }), events);
    expect(projection.mode).toBe('retry');
    expect(projection.sequence).toBe(1);
    expect(projection.recordedSequence).toBe(1);
    expect(projection.snapshotMismatch).toBe(true);
    expect(projection.reasons.join('')).toContain('以只追加事件为准');
  });

  it('快照与事件序号不一致 → 仍 retry，但给出档案不一致警告', () => {
    // 历史必须连续：seq 1 由其他 Claim 占用，自身事件为 seq 2；快照仍声称 1 → 以事件为准
    const events = [
      unsealedEvent('claim-a', 'sha256:test-B', 'sha256:frozen-a', 1),
      unsealedEvent('claim-b', 'sha256:test-B', 'sha256:frozen-b', 2),
    ];
    const projection = projectClaimUnseal(makeClaim({ unsealSequence: 1 }), events);
    expect(projection.mode).toBe('retry');
    expect(projection.sequence).toBe(2);
    expect(projection.recordedSequence).toBe(2);
    expect(projection.snapshotMismatch).toBe(true);
    expect(projection.reasons.join('')).toContain('以只追加事件为准');
  });

  it('快照声称已解封（unsealSequence=1）却无授权事件 → invalid，不得显示首次独立验证', () => {
    const projection = projectClaimUnseal(makeClaim({ unsealSequence: 1 }), []);
    expect(projection.mode).toBe('invalid');
    expect(projection.sequence).toBeNull();
    expect(projection.reasons.join('')).toContain('快照声称已解封');
    expect(projection.reasons.join('')).toContain('缺少对应 claim_unsealed 授权事件');
  });

  it('快照声称序号 2、仅有其他 Claim 的 seq 1 历史 → 仍 invalid（自身无授权事件）', () => {
    const events = [unsealedEvent('claim-a', 'sha256:test-B', 'sha256:frozen-a', 1)];
    const projection = projectClaimUnseal(makeClaim({ unsealSequence: 2 }), events);
    expect(projection.mode).toBe('invalid');
    expect(projection.reasons.join('')).toContain('快照声称已解封');
  });

  it('当前 Claim 的事件 frozenHash/testSetHash 不匹配 → invalid', () => {
    const events = [unsealedEvent('claim-b', 'sha256:test-B', 'sha256:other-frozen', 1)];
    const projection = projectClaimUnseal(makeClaim(), events);
    expect(projection.mode).toBe('invalid');
    expect(projection.sequence).toBeNull();
    expect(projection.reasons.join('')).toContain('冻结身份');
  });

  it('同一 Claim 多个不同解封序号 → invalid', () => {
    const events = [
      unsealedEvent('claim-b', 'sha256:test-B', 'sha256:frozen-b', 1),
      unsealedEvent('claim-b', 'sha256:test-B', 'sha256:frozen-b', 2, 'ev-dup'),
    ];
    const projection = projectClaimUnseal(makeClaim(), events);
    expect(projection.mode).toBe('invalid');
    expect(projection.reasons.join('')).toContain('多个不同解封序号');
  });

  it('同一测试集同一序号被多个事件占用 → invalid', () => {
    const events = [
      unsealedEvent('claim-a', 'sha256:test-B', 'sha256:frozen-a', 1),
      unsealedEvent('claim-x', 'sha256:test-B', 'sha256:frozen-x', 1, 'ev-conflict'),
    ];
    const projection = projectClaimUnseal(makeClaim(), events);
    expect(projection.mode).toBe('invalid');
    expect(projection.reasons.join('')).toContain('被多个事件占用');
  });

  it('与当前 Claim/测试集相关的非法事件 → invalid（不得当作不存在重新判 first）', () => {
    const claim = makeClaim();
    // entityType 错误但 payload 指向当前测试集
    const wrongEntityType = projectClaimUnseal(claim, [
      { ...unsealedEvent('claim-a', 'sha256:test-B', 'sha256:frozen-a', 1), entityType: 'attempt' } as LedgerEvent,
    ]);
    expect(wrongEntityType.mode).toBe('invalid');
    expect(wrongEntityType.reasons.join('')).toContain('entityType 不是 claim');

    // 序号非法变体（0/负数/小数/NaN/Infinity/字符串/超安全整数）指向当前测试集
    const badSequences: unknown[] = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', Number.MAX_SAFE_INTEGER + 2];
    for (const badSequence of badSequences) {
      const projection = projectClaimUnseal(claim, [
        { ...unsealedEvent('claim-a', 'sha256:test-B', 'sha256:frozen-a', 1), payload: { frozenHash: 'sha256:frozen-a', testSetHash: 'sha256:test-B', unsealSequence: badSequence } } as unknown as LedgerEvent,
      ]);
      expect(projection.mode).toBe('invalid');
      expect(projection.reasons.join('')).toContain('正安全整数');
    }

    // 当前 Claim 的事件缺 frozenHash / 缺 testSetHash
    const missingFrozen = projectClaimUnseal(claim, [
      { ...unsealedEvent('claim-b', 'sha256:test-B', '', 1), payload: { testSetHash: 'sha256:test-B', unsealSequence: 1 } } as unknown as LedgerEvent,
    ]);
    expect(missingFrozen.mode).toBe('invalid');
    expect(missingFrozen.reasons.join('')).toContain('缺少 frozenHash');

    const missingTestSet = projectClaimUnseal(claim, [
      { ...unsealedEvent('claim-b', 'sha256:test-B', 'sha256:frozen-b', 1), payload: { frozenHash: 'sha256:frozen-b', unsealSequence: 1 } } as unknown as LedgerEvent,
    ]);
    // 缺 testSetHash 的自身事件无法判定相关性时仍按自身 Claim 处理 → invalid
    expect(missingTestSet.mode).toBe('invalid');
  });

  it('其他测试集的损坏事件不污染当前投影', () => {
    const projection = projectClaimUnseal(makeClaim(), [
      { ...unsealedEvent('claim-x', 'sha256:test-OTHER', 'sha256:frozen-x', 0, 'ev-bad-other'), payload: { frozenHash: 'sha256:frozen-x', testSetHash: 'sha256:test-OTHER', unsealSequence: 0 } } as unknown as LedgerEvent,
      unsealedEvent('claim-y', 'sha256:test-OTHER', 'sha256:frozen-y', 7),
    ]);
    expect(projection.mode).toBe('first');
    expect(projection.sequence).toBe(1);
  });

  it('测试集历史序号缺口（[1,3]）→ invalid（授权链断裂）', () => {
    const events = [
      unsealedEvent('claim-a', 'sha256:test-B', 'sha256:frozen-a', 1),
      unsealedEvent('claim-x', 'sha256:test-B', 'sha256:frozen-x', 3),
    ];
    const projection = projectClaimUnseal(makeClaim(), events);
    expect(projection.mode).toBe('invalid');
    expect(projection.reasons.join('')).toContain('不从 1 连续递增');
  });

  it('安全整数溢出：max+1 越过安全整数 → invalid', () => {
    // 历史包含 MAX_SAFE_INTEGER（连续性已被破坏，但必须给出失败关闭而非错误序号）
    const events = [unsealedEvent('claim-a', 'sha256:test-B', 'sha256:frozen-a', Number.MAX_SAFE_INTEGER)];
    const projection = projectClaimUnseal(makeClaim(), events);
    expect(projection.mode).toBe('invalid');
    expect(projection.sequence).toBeNull();
  });

  it('其他测试集的历史不影响当前测试集投影', () => {
    const events = [unsealedEvent('claim-a', 'sha256:test-OTHER', 'sha256:frozen-a', 5)];
    const projection = projectClaimUnseal(makeClaim(), events);
    expect(projection.mode).toBe('first');
    expect(projection.sequence).toBe(1);
    expect(projection.testSetHistory).toEqual([]);
  });
});
