import { useEffect, useState } from 'react';

/**
 * 计时 hook（模块 06 预算区）：
 * - 仅在 enabled（存在运行中 Attempt）时启动定时器；
 * - 卸载或 Study 切换导致 enabled 变化时清理，不残留；
 * - now 通过返回值暴露，测试可用假定时器驱动。
 */
export function useNow(enabled: boolean, intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);

  return now;
}
