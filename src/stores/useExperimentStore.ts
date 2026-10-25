import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  TRUST_PROTOCOL_VERSION,
  type Attempt,
  type AttemptProvenance,
  type AttemptStatus,
  type EvaluationClaim,
  type Experiment,
  type ExperimentLedgerV1,
  type LedgerEntityType,
  type LedgerEvent,
  type Study,
} from '@/types/experiment';
import {
  ExperimentProtocolError,
  createEmptyExperimentLedger,
  parseExperimentLedger,
  transitionAttempt,
} from '@/utils/experimentProtocol';

const EXPERIMENT_LEDGER_STORAGE_KEY = 'neurobricks_experiment_ledger_v1';

interface ExperimentLedgerActions {
  setActiveStudy: (studyId: string | null) => void;
  updateStudy: (studyId: string, patch: Partial<Pick<Study, 'name' | 'question' | 'selectionRule' | 'budget' | 'selectedExperimentId' | 'selectedAttemptId'>>) => void;
  registerStudy: (study: Study) => void;
  registerExperiment: (experiment: Experiment) => void;
  registerAttempt: (attempt: Attempt) => void;
  checkpointAttemptMetrics: (attemptId: string, metrics: Attempt['metrics']) => void;
  registerClaim: (claim: EvaluationClaim) => void;
  replaceClaim: (claim: EvaluationClaim) => void;
  transitionAttemptStatus: (
    attemptId: string,
    status: AttemptStatus,
    occurredAt: number,
    patch?: Partial<Pick<Attempt, 'metrics' | 'artifacts' | 'interruptionReason'>> & {
      provenance?: Partial<AttemptProvenance>;
    },
  ) => void;
  appendEvent: (
    entityType: LedgerEntityType,
    entityId: string,
    eventType: string,
    payload?: Record<string, unknown>,
    occurredAt?: number,
  ) => void;
  resetLedgerForTests: () => void;
}

interface ExperimentLedgerState {
  ledger: ExperimentLedgerV1;
  activeStudyId: string | null;
  auditPersistence: 'unavailable' | 'healthy' | 'degraded';
  auditError: string | null;
}

interface PendingAuditEvent {
  ledgerId: string;
  event: LedgerEvent;
}

let pendingAuditEvents: PendingAuditEvent[] = [];
let auditWriteQueue: Promise<void> | null = null;

function isNativeAuditRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_IPC__' in window && typeof (window as unknown as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === 'function';
}

function drainPendingAuditEvents(): Promise<void> {
  if (auditWriteQueue) return auditWriteQueue;
  auditWriteQueue = (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      while (pendingAuditEvents.length > 0) {
        const pending = pendingAuditEvents[0];
        // Rust 端对“最后一条恰为同 eventId”做幂等确认，覆盖写入成功但 IPC 回执丢失。
        await invoke('append_experiment_ledger_event', {
          ledgerId: pending.ledgerId,
          event: pending.event,
        });
        pendingAuditEvents.shift();
      }
      useExperimentStore.setState({ auditPersistence: 'healthy', auditError: null });
    } catch (error) {
      useExperimentStore.setState({
        auditPersistence: 'degraded',
        auditError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      auditWriteQueue = null;
    }
  })();
  return auditWriteQueue;
}

function mirrorEventToAppendOnlyLedger(ledgerId: string, event: LedgerEvent): void {
  if (!isNativeAuditRuntime()) return;
  pendingAuditEvents.push({ ledgerId, event });
  void drainPendingAuditEvents();
}

export async function flushExperimentLedgerAudit(): Promise<void> {
  if (pendingAuditEvents.length > 0) await drainPendingAuditEvents();
  else if (auditWriteQueue) await auditWriteQueue;
}

export async function verifyExperimentLedgerAudit(): Promise<boolean> {
  if (!isNativeAuditRuntime()) return false;
  await flushExperimentLedgerAudit();
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    type AuditStatus = { eventCount: number; lastEventId: string | null; contentHash: string };
    const hashSnapshot = (events: LedgerEvent[]) => invoke<AuditStatus>('hash_experiment_ledger_events', { events });
    const ledgerSnapshot = useExperimentStore.getState().ledger;
    const ledgerId = ledgerSnapshot.ledgerId;
    let status = await invoke<AuditStatus>('verify_experiment_ledger', { ledgerId });
    const events = ledgerSnapshot.events;
    if (status.eventCount < events.length) {
      const prefix = events.slice(0, status.eventCount);
      const prefixStatus = await hashSnapshot(prefix);
      if (
        status.contentHash === prefixStatus.contentHash
        && status.lastEventId === prefixStatus.lastEventId
      ) {
        // 应用可能在 localStorage 状态落盘后、JSONL append 前崩溃；只在磁盘严格匹配
        // 本地前缀时补齐后缀，绝不覆盖或猜测分叉历史。
        for (const event of events.slice(status.eventCount)) {
          await invoke('append_experiment_ledger_event', { ledgerId, event });
        }
        status = await invoke<AuditStatus>('verify_experiment_ledger', { ledgerId });
      }
    }
    // 磁盘与前端快照必须由同一个 Rust 规范化实现计算哈希；否则 JS 与
    // serde_json 的数值序列化差异会把完整审计链误判为损坏。
    const localStatus = await hashSnapshot(events);
    const lastLocalEventId = localStatus.lastEventId;
    const complete = status.eventCount === localStatus.eventCount
      && status.lastEventId === localStatus.lastEventId
      && status.contentHash === localStatus.contentHash;
    if (complete) {
      // A previous append may have reached disk while its IPC receipt was lost, or
      // recovery above may have filled a strict local suffix. Remove only events
      // covered by this verified snapshot so concurrently-created events survive.
      const verifiedEventIds = new Set(events.map(event => event.eventId));
      pendingAuditEvents = pendingAuditEvents.filter(pending => (
        pending.ledgerId !== ledgerId || !verifiedEventIds.has(pending.event.eventId)
      ));
    }
    const currentEvents = useExperimentStore.getState().ledger.events;
    const snapshotStillCurrent = useExperimentStore.getState().ledger.ledgerId === ledgerId
      && currentEvents.length === events.length
      && (currentEvents[currentEvents.length - 1]?.eventId ?? null) === lastLocalEventId;
    const fullySettled = complete
      && snapshotStillCurrent
      && !pendingAuditEvents.some(pending => pending.ledgerId === ledgerId);
    useExperimentStore.setState({
      auditPersistence: fullySettled ? 'healthy' : 'degraded',
      auditError: fullySettled ? null : '磁盘 JSONL 与当前事件快照不一致或验证期间产生了新事件',
    });
    return fullySettled;
  } catch (error) {
    useExperimentStore.setState({
      auditPersistence: 'degraded',
      auditError: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function entityId(prefix: string): string {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function replaceById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex(existing => existing.id === item.id);
  if (index < 0) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

export const useExperimentStore = create<ExperimentLedgerState & ExperimentLedgerActions>()(
  persist(
    (set) => ({
      ledger: createEmptyExperimentLedger(),
      activeStudyId: null,
      auditPersistence: 'unavailable',
      auditError: null,

      setActiveStudy: studyId => set(state => {
        if (studyId && !state.ledger.studies.some(study => study.id === studyId && !study.archivedAt)) {
          throw new ExperimentProtocolError(`Study 不存在：${studyId}`);
        }
        return { activeStudyId: studyId };
      }),

      updateStudy: (studyId, patch) => set(state => {
        const study = state.ledger.studies.find(item => item.id === studyId);
        if (!study) throw new ExperimentProtocolError(`Study 不存在：${studyId}`);
        if (study.lockedAt !== null && (
          patch.question !== undefined
          || patch.selectionRule !== undefined
          || patch.budget !== undefined
        )) {
          throw new ExperimentProtocolError('首个 Attempt 启动后，Study 问题、选择规则与预算均已冻结');
        }
        const updated: Study = { ...study, ...patch, updatedAt: Date.now() };
        return { ledger: { ...state.ledger, studies: replaceById(state.ledger.studies, updated) } };
      }),

      registerStudy: study => set(state => {
        const existing = state.ledger.studies.find(item => item.id === study.id);
        if (existing && existing.lockedAt !== null && JSON.stringify(existing.datasetContract) !== JSON.stringify(study.datasetContract)) {
          throw new ExperimentProtocolError('已锁定 Study 的数据契约不可原地改写');
        }
        if (existing && existing.lockedAt !== null && existing.kind !== study.kind) {
          throw new ExperimentProtocolError('首个 attempt 启动后不可更改 Study 类型');
        }
        if (existing && existing.lockedAt !== null && (
          existing.question !== study.question
          || existing.comparisonKey !== study.comparisonKey
          || existing.selectionRule !== study.selectionRule
          || JSON.stringify(existing.budget) !== JSON.stringify(study.budget)
        )) {
          throw new ExperimentProtocolError('已锁定 Study 的问题、可比性、选择规则与预算不可改写');
        }
        return { ledger: { ...state.ledger, studies: replaceById(state.ledger.studies, study) } };
      }),

      registerExperiment: experiment => set(state => {
        if (!state.ledger.studies.some(study => study.id === experiment.studyId)) {
          throw new ExperimentProtocolError('不能把 Experiment 注册到不存在的 Study');
        }
        return {
          ledger: {
            ...state.ledger,
            experiments: replaceById(state.ledger.experiments, experiment),
          },
        };
      }),

      registerAttempt: attempt => set(state => {
        if (!state.ledger.experiments.some(experiment => experiment.id === attempt.experimentId)) {
          throw new ExperimentProtocolError('不能把 Attempt 注册到不存在的 Experiment');
        }
        if (state.ledger.attempts.some(existing => existing.id === attempt.id)) {
          throw new ExperimentProtocolError(`Attempt ID 已存在：${attempt.id}`);
        }
        return { ledger: { ...state.ledger, attempts: [...state.ledger.attempts, attempt] } };
      }),

      checkpointAttemptMetrics: (attemptId, metrics) => set(state => {
        const attempt = state.ledger.attempts.find(item => item.id === attemptId);
        if (!attempt) throw new ExperimentProtocolError(`Attempt 不存在：${attemptId}`);
        if (!['starting', 'running', 'paused'].includes(attempt.status)) return {};
        const updated: Attempt = { ...attempt, metrics: metrics.map(metric => ({ ...metric })) };
        return { ledger: { ...state.ledger, attempts: replaceById(state.ledger.attempts, updated) } };
      }),

      registerClaim: claim => set(state => {
        if (!state.ledger.attempts.some(attempt => attempt.id === claim.attemptId)) {
          throw new ExperimentProtocolError('不能把 Claim 注册到不存在的 Attempt');
        }
        return { ledger: { ...state.ledger, claims: replaceById(state.ledger.claims, claim) } };
      }),

      replaceClaim: claim => set(state => {
        if (!state.ledger.claims.some(existing => existing.id === claim.id)) {
          throw new ExperimentProtocolError(`Claim 不存在：${claim.id}`);
        }
        return { ledger: { ...state.ledger, claims: replaceById(state.ledger.claims, claim) } };
      }),

      transitionAttemptStatus: (attemptId, status, occurredAt, patch = {}) => set(state => {
        const attempt = state.ledger.attempts.find(item => item.id === attemptId);
        if (!attempt) throw new ExperimentProtocolError(`Attempt 不存在：${attemptId}`);
        const provenance = patch.provenance
          ? {
              ...attempt.provenance,
              ...patch.provenance,
              environment: patch.provenance.environment
                ? { ...attempt.provenance.environment, ...patch.provenance.environment }
                : attempt.provenance.environment,
            }
          : attempt.provenance;
        const transitioned = transitionAttempt({ ...attempt, ...patch, provenance }, status, occurredAt);
        return {
          ledger: {
            ...state.ledger,
            attempts: replaceById(state.ledger.attempts, transitioned),
          },
        };
      }),

      appendEvent: (entityType, entityIdValue, eventType, payload = {}, occurredAt = Date.now()) => {
        let eventToMirror: LedgerEvent | null = null;
        let ledgerIdToMirror = '';
        set(state => {
          ledgerIdToMirror = state.ledger.ledgerId;
          eventToMirror = {
            eventId: entityId('event'),
            protocolVersion: TRUST_PROTOCOL_VERSION,
            sequence: state.ledger.events.length + 1,
            occurredAt,
            entityType,
            entityId: entityIdValue,
            eventType,
            payload,
          };
          return {
            ledger: {
              ...state.ledger,
              events: [...state.ledger.events, eventToMirror],
            },
          };
        });
        if (eventToMirror) mirrorEventToAppendOnlyLedger(ledgerIdToMirror, eventToMirror);
      },

      resetLedgerForTests: () => {
        pendingAuditEvents = [];
        auditWriteQueue = null;
        set({ ledger: createEmptyExperimentLedger(), activeStudyId: null, auditPersistence: 'unavailable', auditError: null });
      },
    }),
    {
      name: EXPERIMENT_LEDGER_STORAGE_KEY,
      version: TRUST_PROTOCOL_VERSION,
      partialize: state => ({ ledger: state.ledger, activeStudyId: state.activeStudyId }),
      merge: (persisted, current) => {
        const candidate = (persisted as Partial<ExperimentLedgerState> | undefined)?.ledger;
        const parsed = parseExperimentLedger(candidate) ?? createEmptyExperimentLedger();
        const persistedActive = (persisted as Partial<ExperimentLedgerState> | undefined)?.activeStudyId;
        return {
          ...current,
          ledger: parsed,
          activeStudyId: typeof persistedActive === 'string'
            && parsed.studies.some(study => study.id === persistedActive && !study.archivedAt)
            ? persistedActive
            : null,
        };
      },
    },
  ),
);
