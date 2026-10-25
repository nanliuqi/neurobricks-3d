import { beforeEach, describe, expect, it } from 'vitest';
import {
  sanitizePersistedCloudState,
  useCloudStore,
} from '@/stores/useCloudStore';
import { stripSSHSecrets } from '@/utils/sshCredentialPolicy';
import type { SSHConfig } from '@/types/cloud';

const SERVER: SSHConfig = {
  id: 'server-1',
  name: '测试服务器',
  host: '192.0.2.10',
  port: 22,
  username: 'trainer',
  authType: 'password',
  password: 'secret-password',
  passphrase: 'secret-passphrase',
  privateKeyPath: 'C:/keys/id_ed25519',
  remoteWorkDir: '/tmp/neurobricks',
  createdAt: 1,
  updatedAt: 1,
};

describe('cloud credential persistence boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    useCloudStore.setState({ servers: [], tasks: [] });
  });

  it('removes passwords and passphrases while preserving non-secret server metadata', () => {
    const safe = stripSSHSecrets(SERVER);

    expect(safe.password).toBeUndefined();
    expect(safe.passphrase).toBeUndefined();
    expect(safe.host).toBe(SERVER.host);
    expect(safe.privateKeyPath).toBe(SERVER.privateKeyPath);
  });

  it('sanitizes legacy persisted state and fails closed for malformed state', () => {
    expect(sanitizePersistedCloudState({ servers: [SERVER] }).servers).toEqual([
      stripSSHSecrets(SERVER),
    ]);
    expect(sanitizePersistedCloudState(null)).toEqual({ servers: [] });
    expect(sanitizePersistedCloudState({ servers: 'corrupt' })).toEqual({ servers: [] });
    expect(sanitizePersistedCloudState({ servers: [{ id: 'incomplete' }] })).toEqual({ servers: [] });
  });

  it('migrates a version-zero Zustand record without losing non-secret metadata', async () => {
    localStorage.setItem('neurobricks-cloud', JSON.stringify({
      state: { servers: [SERVER] },
      version: 0,
    }));

    await useCloudStore.persist.rehydrate();

    expect(useCloudStore.getState().servers).toEqual([stripSSHSecrets(SERVER)]);
    const persisted = localStorage.getItem('neurobricks-cloud') ?? '';
    expect(persisted).not.toContain('secret-password');
    expect(persisted).not.toContain('secret-passphrase');
  });

  it('keeps credentials available in memory but never serializes them to localStorage', () => {
    useCloudStore.getState().addServer(SERVER);

    expect(useCloudStore.getState().servers[0].password).toBe('secret-password');
    const persisted = localStorage.getItem('neurobricks-cloud');
    expect(persisted).not.toBeNull();
    expect(persisted).not.toContain('secret-password');
    expect(persisted).not.toContain('secret-passphrase');

    const parsed = JSON.parse(persisted ?? '{}') as { state?: { servers?: SSHConfig[] } };
    expect(parsed.state?.servers?.[0].password).toBeUndefined();
    expect(parsed.state?.servers?.[0].passphrase).toBeUndefined();
  });

  it('also strips a session credential introduced through updateServer', () => {
    useCloudStore.getState().addServer(stripSSHSecrets(SERVER));
    useCloudStore.getState().updateServer(SERVER.id, {
      password: 'replacement-secret',
      passphrase: 'replacement-passphrase',
    });

    expect(useCloudStore.getState().servers[0].password).toBe('replacement-secret');
    const persisted = localStorage.getItem('neurobricks-cloud') ?? '';
    expect(persisted).not.toContain('replacement-secret');
    expect(persisted).not.toContain('replacement-passphrase');
  });
});
