import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_PREFS_STORAGE_KEY,
  getDefaultWorkspacePrefs,
  loadWorkspacePrefs,
  sanitizeWorkspacePrefs,
  saveWorkspacePrefs,
} from '@/utils/workspaceLayoutUtils';

describe('workspaceLayoutUtils', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('sanitizeWorkspacePrefs', () => {
    it('非对象 / null / 缺字段输入全部回退默认值', () => {
      expect(sanitizeWorkspacePrefs(null)).toEqual(getDefaultWorkspacePrefs());
      expect(sanitizeWorkspacePrefs('dataset')).toEqual(getDefaultWorkspacePrefs());
      expect(sanitizeWorkspacePrefs(42)).toEqual(getDefaultWorkspacePrefs());
      expect(sanitizeWorkspacePrefs({})).toEqual(getDefaultWorkspacePrefs());
    });

    it('未知面板 ID 与非法收起状态回退默认值', () => {
      expect(sanitizeWorkspacePrefs({ activePanel: 'nonexistent', collapsed: 'yes' }))
        .toEqual(getDefaultWorkspacePrefs());
      // 面板合法但收起状态非法：仅收起状态回退
      expect(sanitizeWorkspacePrefs({ activePanel: 'dataset', collapsed: 'yes' }))
        .toEqual({ activePanel: 'dataset', collapsed: false });
    });

    it('合法输入原样保留', () => {
      expect(sanitizeWorkspacePrefs({ activePanel: 'code', collapsed: true }))
        .toEqual({ activePanel: 'code', collapsed: true });
    });
  });

  describe('loadWorkspacePrefs', () => {
    it('无数据时返回默认值', () => {
      expect(loadWorkspacePrefs()).toEqual(getDefaultWorkspacePrefs());
    });

    it('JSON 损坏时回退默认值而非抛错', () => {
      window.localStorage.setItem(WORKSPACE_PREFS_STORAGE_KEY, '{broken json');
      expect(loadWorkspacePrefs()).toEqual(getDefaultWorkspacePrefs());
    });

    it('localStorage 读取异常时回退默认值而非崩溃', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      expect(loadWorkspacePrefs()).toEqual(getDefaultWorkspacePrefs());
    });
  });

  describe('saveWorkspacePrefs', () => {
    it('写入版本化 JSON', () => {
      saveWorkspacePrefs({ activePanel: 'predict', collapsed: true });
      const raw = window.localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string);
      expect(parsed).toEqual({ version: 1, activePanel: 'predict', collapsed: true });
    });

    it('写入异常不抛出、不阻断交互', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      expect(() => saveWorkspacePrefs({ activePanel: 'code', collapsed: false })).not.toThrow();
    });
  });
});
