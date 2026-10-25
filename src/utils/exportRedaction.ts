/** 导出物不携带本机绝对路径；协议身份使用内容哈希，不依赖路径可见性。 */
export function redactLocalPaths(value: unknown, knownPaths: string[]): unknown {
  const paths = [...new Set(knownPaths.filter(path => path.trim().length > 0))]
    .sort((left, right) => right.length - left.length);
  const visit = (item: unknown, key = ''): unknown => {
    if (/(?:^|_)(?:data_?)?path$|directory/i.test(key)) return '[redacted-local-path]';
    if (typeof item === 'string') {
      return paths.reduce((text, path) => text.split(path).join('[redacted-local-path]'), item);
    }
    if (Array.isArray(item)) return item.map(entry => visit(entry));
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([childKey, child]) => (
        [childKey, visit(child, childKey)]
      )));
    }
    return item;
  };
  return visit(value);
}
