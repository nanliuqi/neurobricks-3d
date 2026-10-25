import type { SSHConfig } from '@/types/cloud';

/**
 * Passwords and private-key passphrases are ephemeral session credentials.
 * They must never cross a browser persistence, export, or diagnostic boundary.
 */
export function stripSSHSecrets(config: SSHConfig): SSHConfig {
  const { password: _password, passphrase: _passphrase, ...persistable } = config;
  return persistable;
}

function isPersistableSSHConfig(value: unknown): value is SSHConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Partial<SSHConfig>;
  return typeof config.id === 'string'
    && config.id.length > 0
    && typeof config.name === 'string'
    && typeof config.host === 'string'
    && Number.isInteger(config.port)
    && Number(config.port) >= 1
    && Number(config.port) <= 65_535
    && typeof config.username === 'string'
    && (config.authType === 'password' || config.authType === 'private_key')
    && (config.privateKeyPath === undefined || typeof config.privateKeyPath === 'string')
    && typeof config.remoteWorkDir === 'string'
    && Number.isFinite(config.createdAt)
    && Number.isFinite(config.updatedAt);
}

export function sanitizePersistedSSHConfigs(value: unknown): SSHConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isPersistableSSHConfig)
    .map(stripSSHSecrets);
}
