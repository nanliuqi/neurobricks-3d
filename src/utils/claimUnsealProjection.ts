/**
 * 测试集级解封序号投影（模块 08 最终运行时原子性补丁）：UI 与 evaluateFrozenClaim 的唯一共享来源。
 *
 * 语义：解封序号属于「测试集」，不属于单条 Claim 快照：
 * - retry：当前 Claim 已有与自身 claimId + frozenHash + testDatasetHash 匹配的
 *   claim_unsealed 事件 → 使用事件中的原序号；不要求 Claim 快照 unsealSequence 非空；
 *   快照缺失或不一致时 snapshotMismatch=true（以只追加事件为准，绝不误判为首次）。
 * - subsequent：当前 Claim 无解封事件、快照也无序号声明，但同一 testSetHash 已被
 *   其他 Claim 合法解封 → sequence = max(历史序号)+1，属事后验证，不具首次独立验证资格。
 * - first：该 testSetHash 从未出现合法解封事件且快照无声称 → sequence = 1。
 * - invalid（失败关闭）：
 *   a) 与当前 Claim 或当前测试集相关的非法 claim_unsealed 事件（缺 frozenHash/testSetHash、
 *      序号为 0/负数/小数/NaN/Infinity/字符串/超安全整数、entityType 错误但指向当前测试集）；
 *   b) 当前 Claim 事件身份不匹配 / 同 Claim 多个不同序号 / 同测试集同序号重复占用；
 *   c) 测试集历史序号不从 1 连续递增（授权链断裂）；
 *   d) max(sequence)+1 越过安全整数；
 *   e) Claim 快照声称已解封（unsealSequence 非空）却没有对应授权事件。
 * 与当前 Claim 和当前测试集都无关的损坏事件不污染本投影。
 */
import type { EvaluationClaim, LedgerEvent } from '@/types/experiment';

export type UnsealMode = 'first' | 'subsequent' | 'retry' | 'invalid';

export interface UnsealProjection {
  mode: UnsealMode;
  /** 本次将使用/已记录的序号：first=1；subsequent=max+1；retry=事件原序号；invalid=null。 */
  sequence: number | null;
  /** 当前 Claim 自身审计事件记录的原序号（无事件时 null）。 */
  recordedSequence: number | null;
  /** 该测试集已被合法解封的历史序号集合（升序）。 */
  testSetHistory: number[];
  /** 失败关闭 / 警告原因（invalid 时非空；快照不一致时含警告）。 */
  reasons: string[];
  /** Claim 快照 unsealSequence 与审计事件不一致或缺失（retry 仍为 retry，仅警告）。 */
  snapshotMismatch: boolean;
}

interface ValidUnsealEvent {
  claimId: string;
  frozenHash: string;
  testSetHash: string;
  sequence: number;
}

function invalid(reasons: string[], testSetHistory: number[] = []): UnsealProjection {
  return { mode: 'invalid', sequence: null, recordedSequence: null, testSetHistory, reasons, snapshotMismatch: false };
}

export function projectClaimUnseal(
  claim: EvaluationClaim,
  events: readonly LedgerEvent[],
): UnsealProjection {
  const valid: ValidUnsealEvent[] = [];

  for (const event of events) {
    if (event.eventType !== 'claim_unsealed') continue;
    const payload = event.payload as { frozenHash?: unknown; testSetHash?: unknown; unsealSequence?: unknown };
    const payloadTestSet = typeof payload.testSetHash === 'string' && payload.testSetHash.length > 0
      ? payload.testSetHash
      : null;
    // 相关性：事件指向当前 Claim，或 payload 指向当前测试集（含 entityType 错误的情况）。
    const relatesToClaim = event.entityType === 'claim' && event.entityId === claim.id;
    const relatesToTestSet = payloadTestSet !== null && payloadTestSet === claim.testDatasetHash;

    const problems: string[] = [];
    if (event.entityType !== 'claim') problems.push('entityType 不是 claim');
    if (typeof event.entityId !== 'string' || event.entityId.length === 0) problems.push('entityId 无效');
    if (typeof payload.frozenHash !== 'string' || payload.frozenHash.length === 0) problems.push('缺少 frozenHash');
    if (payloadTestSet === null) problems.push('缺少 testSetHash');
    if (
      typeof payload.unsealSequence !== 'number'
      || !Number.isSafeInteger(payload.unsealSequence)
      || payload.unsealSequence <= 0
    ) {
      problems.push('解封序号不是正安全整数');
    }
    if (problems.length > 0) {
      // 与当前 Claim 或当前测试集相关的损坏事件必须失败关闭，不得当作不存在；
      // 无关测试集的损坏事件不污染当前投影。
      if (relatesToClaim || relatesToTestSet) {
        return invalid([`与当前主张或当前测试集相关的 claim_unsealed 事件非法（${problems.join('；')}），已失败关闭`]);
      }
      continue;
    }
    valid.push({
      claimId: event.entityId as string,
      frozenHash: payload.frozenHash as string,
      testSetHash: payloadTestSet as string,
      sequence: payload.unsealSequence as number,
    });
  }

  const ownEvents = valid.filter(event => event.claimId === claim.id);

  // 当前 Claim 的事件必须与自身冻结身份完全匹配；不匹配即档案冲突。
  if (ownEvents.some(event => event.frozenHash !== claim.frozenHash || event.testSetHash !== claim.testDatasetHash)) {
    return invalid(['当前 Claim 的解封事件与冻结身份（frozenHash/testSetHash）不一致，档案冲突已失败关闭']);
  }

  const ownSequences = [...new Set(ownEvents.map(event => event.sequence))].sort((left, right) => left - right);
  if (ownSequences.length > 1) {
    return invalid([`同一 Claim 出现多个不同解封序号（${ownSequences.join('、')}），档案冲突已失败关闭`]);
  }

  // 同一测试集的合法历史（含当前 Claim 自身事件）。
  const testSetEvents = valid.filter(event => event.testSetHash === claim.testDatasetHash);
  const testSetHistory = [...new Set(testSetEvents.map(event => event.sequence))].sort((left, right) => left - right);

  // 同一测试集同一序号被多个事件占用：失败关闭。
  const sequenceCounts = new Map<number, number>();
  for (const event of testSetEvents) {
    sequenceCounts.set(event.sequence, (sequenceCounts.get(event.sequence) ?? 0) + 1);
  }
  const conflicted = [...sequenceCounts.entries()].filter(([, count]) => count > 1).map(([sequence]) => sequence);
  if (conflicted.length > 0) {
    return invalid(
      [`同一测试集的解封序号 ${conflicted.sort((left, right) => left - right).join('、')} 被多个事件占用，档案冲突已失败关闭`],
      testSetHistory,
    );
  }

  // 授权链连续性：测试集历史序号必须从 1 开始连续递增；缺口即断链。
  if (testSetHistory.some((sequence, index) => sequence !== index + 1)) {
    return invalid(
      [`测试集解封序号不从 1 连续递增（历史：${testSetHistory.join('、')}），授权链断裂已失败关闭`],
      testSetHistory,
    );
  }

  if (ownSequences.length === 1) {
    const recordedSequence = ownSequences[0];
    // 快照缺失或不一致：仍为 retry（事件权威），但必须给出不一致警告。
    const snapshotMismatch = claim.unsealSequence !== recordedSequence;
    const reasons: string[] = [];
    if (snapshotMismatch) {
      reasons.push(claim.unsealSequence === null
        ? `Claim 快照缺失 unsealSequence，审计事件记录为第 ${recordedSequence} 次；以只追加事件为准`
        : `Claim 快照 unsealSequence=${String(claim.unsealSequence)} 与审计事件序号 ${recordedSequence} 不一致；以只追加事件为准`);
    }
    return { mode: 'retry', sequence: recordedSequence, recordedSequence, testSetHistory, reasons, snapshotMismatch };
  }

  // 无自身合法事件：快照声称已解封却缺少授权事件 → 失败关闭，不得显示首次独立验证。
  if (claim.unsealSequence !== null && claim.unsealSequence !== undefined) {
    return invalid(
      [`快照声称已解封（unsealSequence=${String(claim.unsealSequence)}）但缺少对应 claim_unsealed 授权事件，已失败关闭`],
      testSetHistory,
    );
  }

  if (testSetHistory.length === 0) {
    return { mode: 'first', sequence: 1, recordedSequence: null, testSetHistory, reasons: [], snapshotMismatch: false };
  }
  const maxSequence = testSetHistory[testSetHistory.length - 1];
  if (maxSequence >= Number.MAX_SAFE_INTEGER) {
    return invalid(['测试集解封序号已达安全整数上限，无法分配下一序号'], testSetHistory);
  }
  const next = maxSequence + 1;
  return {
    mode: 'subsequent',
    sequence: next,
    recordedSequence: null,
    testSetHistory,
    reasons: [`该测试集此前已解封 ${testSetHistory.length} 次（序号 ${testSetHistory.join('、')}）；本次为第 ${next} 次事后验证，不具首次独立验证资格`],
    snapshotMismatch: false,
  };
}
