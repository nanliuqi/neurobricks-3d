import type { SSHConfig } from '@/types/cloud';

const STORAGE_KEY = 'neurobricks_ssh_configs';

/**
 * 简单的 Base64 编码（用于密码混淆，非强加密）
 */
function encodePassword(password: string): string {
  return btoa(password);
}

/**
 * 简单的 Base64 解码
 */
function decodePassword(encoded: string): string {
  return atob(encoded);
}

/**
 * 从 localStorage 加载 SSH 配置列表
 * @returns SSH 配置数组，解析失败返回空数组
 */
export async function loadSSHConfigs(): Promise<SSHConfig[]> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const configs = JSON.parse(stored) as SSHConfig[];

    // 解码密码字段（如果存在）
    return configs.map(config => ({
      ...config,
      password: config.password ? decodePassword(config.password) : undefined,
    }));
  } catch (error) {
    console.error('Failed to load SSH configs:', error);
    return [];
  }
}

/**
 * 保存 SSH 配置列表到 localStorage
 * @param configs - SSH 配置数组
 */
export async function saveSSHConfigs(configs: SSHConfig[]): Promise<void> {
  try {
    // 编码密码字段（如果存在）
    const encodedConfigs = configs.map(config => ({
      ...config,
      password: config.password ? encodePassword(config.password) : undefined,
    }));

    localStorage.setItem(STORAGE_KEY, JSON.stringify(encodedConfigs));
  } catch (error) {
    console.error('Failed to save SSH configs:', error);
    throw error;
  }
}

/**
 * 添加新的 SSH 配置
 * @param config - 不包含 id、createdAt、updatedAt 的配置对象
 * @returns 新创建的完整配置对象
 */
export async function addSSHConfig(
  config: Omit<SSHConfig, 'id' | 'createdAt' | 'updatedAt'>
): Promise<SSHConfig> {
  const now = Date.now();

  const newConfig: SSHConfig = {
    ...config,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };

  // 加载现有配置
  const existingConfigs = await loadSSHConfigs();

  // 追加新配置并保存
  await saveSSHConfigs([...existingConfigs, newConfig]);

  return newConfig;
}

/**
 * 更新现有的 SSH 配置
 * @param configId - 配置 ID
 * @param updates - 要更新的字段
 * @returns 更新后的配置对象，如果未找到返回 null
 */
export async function updateSSHConfig(
  configId: string,
  updates: Partial<SSHConfig>
): Promise<SSHConfig | null> {
  // 加载现有配置
  const existingConfigs = await loadSSHConfigs();

  // 查找目标配置
  const index = existingConfigs.findIndex(config => config.id === configId);

  if (index === -1) {
    return null;
  }

  // 合并更新
  const updatedConfig: SSHConfig = {
    ...existingConfigs[index],
    ...updates,
    updatedAt: Date.now(),
  };

  // 替换并保存
  existingConfigs[index] = updatedConfig;
  await saveSSHConfigs(existingConfigs);

  return updatedConfig;
}

/**
 * 删除 SSH 配置
 * @param configId - 配置 ID
 */
export async function deleteSSHConfig(configId: string): Promise<void> {
  // 加载现有配置
  const existingConfigs = await loadSSHConfigs();

  // 过滤掉目标配置
  const filteredConfigs = existingConfigs.filter(config => config.id !== configId);

  // 保存更新后的列表
  await saveSSHConfigs(filteredConfigs);
}

/**
 * 校验 SSH 配置的合法性
 * @param config - 部分配置对象
 * @returns 校验结果，包含 isValid 和 errors 数组
 */
export function validateSSHConfig(
  config: Partial<SSHConfig>
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // host 不能为空
  if (!config.host || config.host.trim() === '') {
    errors.push('主机地址不能为空');
  }

  // username 不能为空
  if (!config.username || config.username.trim() === '') {
    errors.push('用户名不能为空');
  }

  // port 范围校验：1-65535
  if (config.port !== undefined && config.port !== null) {
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      errors.push('端口号必须在 1-65535 之间');
    }
  }

  // authType='password' 时 password 不能为空
  if (config.authType === 'password') {
    if (!config.password || config.password.trim() === '') {
      errors.push('密码不能为空');
    }
  }

  // authType='private_key' 时 privateKeyPath 不能为空
  if (config.authType === 'private_key') {
    if (!config.privateKeyPath || config.privateKeyPath.trim() === '') {
      errors.push('私钥路径不能为空');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
