import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSSHConfigs, saveSSHConfigs } from '@/utils/sshManager';
import type { SSHConfig } from '@/types/cloud';

const SERVER: SSHConfig = {
  id: '5d59838b-1d55-46e9-9d90-100bc995dd88',
  name: '旧服务器',
  host: '192.0.2.10',
  port: 22,
  username: 'trainer',
  authType: 'password',
  password: 'legacy-base64-or-plain-secret',
  passphrase: 'legacy-passphrase',
  remoteWorkDir: '/tmp/neurobricks',
  createdAt: 1,
  updatedAt: 1,
};

describe('legacy SSH manager credential migration', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('never writes password or passphrase fields', async () => {
    await saveSSHConfigs([SERVER]);

    const stored = localStorage.getItem('neurobricks_ssh_configs') ?? '';
    const [persisted] = JSON.parse(stored) as Array<Record<string, unknown>>;
    expect(stored).not.toContain('legacy-base64-or-plain-secret');
    expect(stored).not.toContain('legacy-passphrase');
    expect(persisted).not.toHaveProperty('password');
    expect(persisted).not.toHaveProperty('passphrase');
    expect(persisted.authType).toBe('password');
  });

  it('purges secrets from legacy records as soon as they are loaded', async () => {
    localStorage.setItem('neurobricks_ssh_configs', JSON.stringify([SERVER]));

    const loaded = await loadSSHConfigs();
    expect(loaded[0].password).toBeUndefined();
    expect(loaded[0].passphrase).toBeUndefined();

    const migrated = localStorage.getItem('neurobricks_ssh_configs') ?? '';
    expect(migrated).not.toContain('legacy-base64-or-plain-secret');
    expect(migrated).not.toContain('legacy-passphrase');
  });

  it('removes malformed legacy storage instead of leaving unverifiable secrets behind', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.setItem('neurobricks_ssh_configs', '{"password":"left-behind-secret"');

    await expect(loadSSHConfigs()).resolves.toEqual([]);
    expect(localStorage.getItem('neurobricks_ssh_configs')).toBeNull();
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
