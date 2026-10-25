import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LedgerEvent } from '@/types/experiment';
import { sha256ProtocolValue } from '@/utils/experimentProtocol';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/tauri', () => ({ invoke: invokeMock }));

import { useExperimentStore, verifyExperimentLedgerAudit } from '@/stores/useExperimentStore';

function setNativeRuntime(enabled: boolean): void {
  if (enabled) {
    Object.defineProperty(window, '__TAURI_IPC__', { configurable: true, value: vi.fn() });
  } else {
    Reflect.deleteProperty(window, '__TAURI_IPC__');
  }
}

function mockDiskLedger(diskEvents: LedgerEvent[]): void {
  const expectedLedgerId = useExperimentStore.getState().ledger.ledgerId;
  invokeMock.mockImplementation(async (command: string, args?: { ledgerId?: string; event?: LedgerEvent; events?: LedgerEvent[] }) => {
    if (command === 'append_experiment_ledger_event') {
      if (args?.ledgerId !== expectedLedgerId) throw new Error('wrong ledger stream');
      const event = args?.event;
      if (!event) throw new Error('missing event');
      const last = diskEvents.at(-1);
      if (last?.eventId === event.eventId) return;
      if (event.sequence !== diskEvents.length + 1) throw new Error('sequence mismatch');
      diskEvents.push(event);
      return;
    }
    if (command === 'verify_experiment_ledger') {
      if (args?.ledgerId !== expectedLedgerId) throw new Error('wrong ledger stream');
      return {
        eventCount: diskEvents.length,
        lastEventId: diskEvents.at(-1)?.eventId ?? null,
        contentHash: await sha256ProtocolValue(diskEvents),
      };
    }
    if (command === 'hash_experiment_ledger_events') {
      const events = args?.events ?? [];
      return {
        eventCount: events.length,
        lastEventId: events.at(-1)?.eventId ?? null,
        contentHash: await sha256ProtocolValue(events),
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });
}

afterEach(() => {
  setNativeRuntime(false);
  invokeMock.mockReset();
  useExperimentStore.getState().resetLedgerForTests();
});

describe('append-only audit recovery', () => {
  it('backfills a strict local suffix after a crash before accepting trust-bearing work', async () => {
    setNativeRuntime(false);
    useExperimentStore.getState().appendEvent('study', 'study-1', 'study_created', { name: 'A' }, 1);
    const diskEvents: LedgerEvent[] = [];
    mockDiskLedger(diskEvents);

    setNativeRuntime(true);
    expect(await verifyExperimentLedgerAudit()).toBe(true);
    expect(diskEvents).toEqual(useExperimentStore.getState().ledger.events);
    expect(useExperimentStore.getState().auditPersistence).toBe('healthy');
    expect(invokeMock).toHaveBeenCalledWith('verify_experiment_ledger', {
      ledgerId: useExperimentStore.getState().ledger.ledgerId,
    });
  });

  it('refuses to overwrite a divergent disk history', async () => {
    setNativeRuntime(false);
    useExperimentStore.getState().appendEvent('study', 'study-local', 'study_created', {}, 1);
    const local = useExperimentStore.getState().ledger.events[0];
    const diskEvents: LedgerEvent[] = [{ ...local, eventId: 'event-divergent', entityId: 'study-disk' }];
    mockDiskLedger(diskEvents);

    setNativeRuntime(true);
    expect(await verifyExperimentLedgerAudit()).toBe(false);
    expect(diskEvents[0].eventId).toBe('event-divergent');
    expect(useExperimentStore.getState().auditPersistence).toBe('degraded');
  });
});
