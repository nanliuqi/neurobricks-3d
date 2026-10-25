import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout';
import { WORKSPACE_PREFS_STORAGE_KEY } from '@/utils/workspaceLayoutUtils';

describe('useWorkspaceLayout', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('默认激活参数面板且展开', () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    expect(result.current.activePanel).toBe('param');
    expect(result.current.collapsed).toBe(false);
  });

  it('点击未激活面板：切换并展开', () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    act(() => result.current.selectPanel('dataset'));
    expect(result.current.activePanel).toBe('dataset');
    expect(result.current.collapsed).toBe(false);
  });

  it('点击已激活面板：收起；再次点击：恢复且身份保留', () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    act(() => result.current.selectPanel('dataset'));
    act(() => result.current.selectPanel('dataset'));
    expect(result.current.activePanel).toBe('dataset');
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.selectPanel('dataset'));
    expect(result.current.activePanel).toBe('dataset');
    expect(result.current.collapsed).toBe(false);
  });

  it('expandPanel 强制激活并展开（选中积木自动打开参数面板的路径）', () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    act(() => result.current.selectPanel('help'));
    act(() => result.current.selectPanel('help')); // 收起
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.expandPanel('param'));
    expect(result.current.activePanel).toBe('param');
    expect(result.current.collapsed).toBe(false);
  });

  it('偏好持久化到版本化 key，重新挂载后可恢复', () => {
    const first = renderHook(() => useWorkspaceLayout());
    act(() => first.result.current.selectPanel('code'));
    act(() => first.result.current.selectPanel('code')); // 收起
    first.unmount();

    const stored = JSON.parse(window.localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY) ?? '');
    expect(stored.version).toBe(1);
    expect(stored.activePanel).toBe('code');
    expect(stored.collapsed).toBe(true);

    const second = renderHook(() => useWorkspaceLayout());
    expect(second.result.current.activePanel).toBe('code');
    expect(second.result.current.collapsed).toBe(true);
  });

  it('持久化数据损坏时回退默认值启动', () => {
    window.localStorage.setItem(WORKSPACE_PREFS_STORAGE_KEY, '{oops');
    const { result } = renderHook(() => useWorkspaceLayout());
    expect(result.current.activePanel).toBe('param');
    expect(result.current.collapsed).toBe(false);
  });

  it('持久化的未知面板 ID 回退到真实存在的默认面板', () => {
    window.localStorage.setItem(
      WORKSPACE_PREFS_STORAGE_KEY,
      JSON.stringify({ version: 1, activePanel: 'deleted-panel', collapsed: false }),
    );
    const { result } = renderHook(() => useWorkspaceLayout());
    expect(result.current.activePanel).toBe('param');
  });
});
