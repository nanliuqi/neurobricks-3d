import { useCallback, useEffect, useState } from 'react';
import {
  loadWorkspacePrefs,
  saveWorkspacePrefs,
  type WorkspaceLayoutPrefs,
} from '../utils/workspaceLayoutUtils';
import type { RightPanelId } from '../types/workspace';

export interface WorkspaceLayoutState {
  /** 当前激活面板（收起状态下身份仍保留）。 */
  activePanel: RightPanelId;
  /** 右侧内容面板是否收起（活动栏不受影响）。 */
  collapsed: boolean;
  /** 点击活动栏入口：切换到其他面板；点击已激活面板则收起/恢复切换。 */
  selectPanel: (id: RightPanelId) => void;
  /** 强制激活并展开指定面板（如选中积木时自动打开参数面板）。 */
  expandPanel: (id: RightPanelId) => void;
  setCollapsed: (collapsed: boolean) => void;
}

/**
 * 工作区布局状态：活动面板 + 收起状态 + 版本化持久化。
 * 面板宽度不在这里管理——沿用既有的 useResizablePanel（避免两套竞争的宽度存储）。
 */
export function useWorkspaceLayout(): WorkspaceLayoutState {
  const [prefs, setPrefs] = useState<WorkspaceLayoutPrefs>(loadWorkspacePrefs);

  useEffect(() => {
    saveWorkspacePrefs(prefs);
  }, [prefs]);

  const selectPanel = useCallback((id: RightPanelId) => {
    setPrefs(current => {
      // 点击未激活入口：切换并展开；点击已激活入口：收起/恢复切换。
      if (current.activePanel !== id) return { activePanel: id, collapsed: false };
      return { activePanel: id, collapsed: !current.collapsed };
    });
  }, []);

  const expandPanel = useCallback((id: RightPanelId) => {
    setPrefs({ activePanel: id, collapsed: false });
  }, []);

  const setCollapsed = useCallback((collapsed: boolean) => {
    setPrefs(current => (current.collapsed === collapsed ? current : { ...current, collapsed }));
  }, []);

  return {
    activePanel: prefs.activePanel,
    collapsed: prefs.collapsed,
    selectPanel,
    expandPanel,
    setCollapsed,
  };
}
