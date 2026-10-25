const ERROR_DETAIL_KEYS = ['message', 'error', 'reason', 'details', 'cause'] as const;

function extractErrorMessage(
  value: unknown,
  visited: Set<object>,
  depth: number
): string | null {
  if (typeof value === 'string') {
    const message = value.trim();
    return message || null;
  }

  if (value instanceof Error) {
    const message = value.message.trim();
    if (message) return message;
  }

  if (!value || typeof value !== 'object' || depth >= 4 || visited.has(value)) {
    return null;
  }

  visited.add(value);
  for (const key of ERROR_DETAIL_KEYS) {
    if (!(key in value)) continue;
    const message = extractErrorMessage(Reflect.get(value, key), visited, depth + 1);
    if (message) return message;
  }

  return null;
}

/**
 * 将浏览器 Error、Tauri 字符串拒绝和 IPC 结构化错误统一为可展示文案。
 * 不直接 String(error)，避免把 undefined、null 或 [object Object] 暴露给用户。
 */
export function getErrorMessage(error: unknown, fallback = '未知错误'): string {
  return extractErrorMessage(error, new Set<object>(), 0) ?? fallback;
}
