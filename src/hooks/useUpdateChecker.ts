import { useState, useEffect } from 'react';

interface UpdateInfo {
  available: boolean;
  version?: string;
  body?: string;
}

/**
 * 检查应用更新
 * Tauri updater 未激活（active: false）或无签名密钥时静默跳过
 */
export function useUpdateChecker() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({ available: false });

  useEffect(() => {
    (async () => {
      try {
        const { checkUpdate } = await import('@tauri-apps/api/updater');
        const result = await checkUpdate();
        if (result.shouldUpdate) {
          setUpdateInfo({
            available: true,
            version: result.manifest?.version,
            body: result.manifest?.body,
          });
        }
      } catch {
        // updater 未配置/未激活或网络不可用，静默忽略
      }
    })();
  }, []);

  return updateInfo;
}
