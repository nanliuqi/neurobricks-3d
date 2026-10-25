import {
  TRUST_PROTOCOL_VERSION,
  type Attempt,
  type AttemptProvenance,
  type AttemptStatus,
  type ExperimentLedgerV1,
  type Study,
} from '@/types/experiment';

export class ExperimentProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExperimentProtocolError';
  }
}

const TERMINAL_ATTEMPT_STATUSES = new Set<AttemptStatus>([
  'completed',
  'interrupted',
  'failed',
  'cancelled',
]);

const ALLOWED_ATTEMPT_TRANSITIONS: Record<AttemptStatus, ReadonlySet<AttemptStatus>> = {
  pending: new Set(['starting', 'cancelled']),
  starting: new Set(['running', 'interrupted', 'failed', 'cancelled']),
  running: new Set(['paused', 'completed', 'interrupted', 'failed', 'cancelled']),
  paused: new Set(['running', 'interrupted', 'failed', 'cancelled']),
  completed: new Set(),
  interrupted: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new ExperimentProtocolError('协议内容不能包含 NaN 或 Infinity');
    }
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
      throw new ExperimentProtocolError('协议内容包含不可序列化值');
    }
    return value;
  }
  if (seen.has(value)) {
    throw new ExperimentProtocolError('协议内容不能包含循环引用');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(item => canonicalize(item, seen));
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (typeof item !== 'undefined') result[key] = canonicalize(item, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

/** 稳定 JSON 只用于协议键和待哈希内容；它不是加密签名。 */
export function stableProtocolJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

/**
 * 同步的 64 位 FNV-1a 仅用于本地分组键。文件内容、权重和冻结主张必须使用后端 SHA-256。
 */
export function localGroupingKey(value: unknown): string {
  const input = new TextEncoder().encode(stableProtocolJson(value));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of input) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `fnv1a64-v1:${hash.toString(16).padStart(16, '0')}`;
}

/** 协议实体的身份钉子使用 SHA-256；运行环境不提供 Web Crypto 时必须失败，不能降级弱哈希。 */
export async function sha256ProtocolValue(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new ExperimentProtocolError('当前运行环境不支持 SHA-256，无法建立可信协议身份');
  }
  const bytes = new TextEncoder().encode(stableProtocolJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

export function hasCompleteControlledProvenance(
  provenance: AttemptProvenance,
  artifacts: Attempt['artifacts'],
): boolean {
  return provenance.source === 'controlled'
    && provenance.witnessedByPipeline
    && provenance.executionWitnessed === true
    && provenance.protocolConsistent === true
    && provenance.artifactsVerified === true
    && provenance.overallTrust === 'controlled_only'
    && artifacts?.weights === true
    && artifacts.fullModel === true
    && artifacts.numpy === true
    && artifacts.perModel === true
    && Boolean(provenance.datasetContentHash)
    && Boolean(provenance.splitHash)
    && Boolean(provenance.preprocessingHash)
    && Boolean(provenance.configHash)
    && Boolean(provenance.modelWeightsHash)
    && Boolean(provenance.environment.applicationVersion)
    && Boolean(provenance.environment.pythonVersion)
    && Boolean(provenance.environment.torchVersion)
    && Boolean(provenance.environment.device);
}

export function createEmptyExperimentLedger(): ExperimentLedgerV1 {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    protocolVersion: TRUST_PROTOCOL_VERSION,
    ledgerId: `ledger-${suffix}`,
    studies: [],
    experiments: [],
    attempts: [],
    claims: [],
    events: [],
  };
}

/**
 * 只接受当前协议的完整顶层形状。旧 TrainRecord 或未知版本必须保持 legacy/unverified，
 * 不能在这里静默补字段并升级为可信记录。
 */
export function parseExperimentLedger(value: unknown): ExperimentLedgerV1 | null {
  if (!isRecord(value) || value.protocolVersion !== TRUST_PROTOCOL_VERSION) return null;
  const arrayKeys = ['studies', 'experiments', 'attempts', 'claims', 'events'] as const;
  if (!arrayKeys.every(key => Array.isArray(value[key]))) return null;
  const ledgerId = typeof value.ledgerId === 'string'
    && value.ledgerId.length > 0
    && value.ledgerId.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value.ledgerId)
    ? value.ledgerId
    : createEmptyExperimentLedger().ledgerId;
  // v1 旧状态没有 ledgerId。为它分配新审计流并保留全部本地实体/事件；验证流程会在
  // 新文件中严格回填本地事件，不再与旧的全局 JSONL 序列发生 230→1 冲突。
  return { ...(value as unknown as ExperimentLedgerV1), ledgerId };
}

export function isTerminalAttemptStatus(status: AttemptStatus): boolean {
  return TERMINAL_ATTEMPT_STATUSES.has(status);
}

export function transitionAttempt(
  attempt: Attempt,
  nextStatus: AttemptStatus,
  occurredAt: number,
): Attempt {
  if (!Number.isFinite(occurredAt) || occurredAt < 0) {
    throw new ExperimentProtocolError('attempt 状态时间戳无效');
  }
  if (!ALLOWED_ATTEMPT_TRANSITIONS[attempt.status].has(nextStatus)) {
    throw new ExperimentProtocolError(`非法 attempt 状态转换：${attempt.status} → ${nextStatus}`);
  }

  const startsNow = nextStatus === 'starting' && attempt.startedAt === null;
  const endsNow = TERMINAL_ATTEMPT_STATUSES.has(nextStatus);
  return {
    ...attempt,
    status: nextStatus,
    startedAt: startsNow ? occurredAt : attempt.startedAt,
    endedAt: endsNow ? occurredAt : null,
    provenance: {
      ...attempt.provenance,
      executionTrust: nextStatus === 'completed' && hasCompleteControlledProvenance(attempt.provenance, attempt.artifacts)
        ? 'trusted'
        : nextStatus === 'interrupted'
          ? 'interrupted'
          : attempt.provenance.executionTrust,
    },
  };
}

/** 首个 attempt 启动时锁定 Study；重复调用幂等，不允许改写原锁定时间。 */
export function lockStudyForFirstAttempt(study: Study, occurredAt: number): Study {
  if (study.lockedAt !== null) return study;
  if (!Number.isFinite(occurredAt) || occurredAt < study.createdAt) {
    throw new ExperimentProtocolError('Study 锁定时间不能早于创建时间');
  }
  return {
    ...study,
    status: 'active',
    lockedAt: occurredAt,
    updatedAt: occurredAt,
  };
}

export function assertLedgerReferences(ledger: ExperimentLedgerV1): void {
  const unique = (ids: string[], entity: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id || seen.has(id)) throw new ExperimentProtocolError(`${entity} ID 缺失或重复：${id}`);
      seen.add(id);
    }
    return seen;
  };

  const studyIds = unique(ledger.studies.map(item => item.id), 'Study');
  const experimentIds = unique(ledger.experiments.map(item => item.id), 'Experiment');
  const attemptIds = unique(ledger.attempts.map(item => item.id), 'Attempt');
  unique(ledger.claims.map(item => item.id), 'Claim');
  unique(ledger.events.map(item => item.eventId), 'Event');

  for (const experiment of ledger.experiments) {
    if (!studyIds.has(experiment.studyId)) {
      throw new ExperimentProtocolError(`Experiment ${experiment.id} 引用了不存在的 Study`);
    }
  }
  for (const attempt of ledger.attempts) {
    if (!experimentIds.has(attempt.experimentId)) {
      throw new ExperimentProtocolError(`Attempt ${attempt.id} 引用了不存在的 Experiment`);
    }
    if (attempt.parentAttemptId && !attemptIds.has(attempt.parentAttemptId)) {
      throw new ExperimentProtocolError(`Attempt ${attempt.id} 引用了不存在的父 Attempt`);
    }
  }
  for (const claim of ledger.claims) {
    if (!studyIds.has(claim.studyId) || !attemptIds.has(claim.attemptId)) {
      throw new ExperimentProtocolError(`Claim ${claim.id} 的 Study/Attempt 引用无效`);
    }
  }
}
