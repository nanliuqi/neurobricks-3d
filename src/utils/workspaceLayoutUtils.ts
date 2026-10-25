/**
 * 工作区布局的纯函数工具：UI 偏好（活动面板 / 收起状态）的持久化读写与校验。
 *
 * 只保存纯 UI 状态，绝不写入训练、数据集、课题、主张等业务状态。
 * 面板宽度沿用既有的 useResizablePanel 持久化（'neurobricks:right-panel-width'），
 * 本模块不创建竞争的宽度存储。
 */
import { DEFAULT_RIGHT_PANEL_ID, isRightPanelId, type RightPanelId } from '../types/workspace';

/** 版本化、命名明确的偏好存储 key。 */
export const WORKSPACE_PREFS_STORAGE_KEY = 'neurobricks:workspace-layout:v1';

export interface WorkspaceLayoutPrefs {
  activePanel: RightPanelId;
  collapsed: boolean;
}

export function getDefaultWorkspacePrefs(): WorkspaceLayoutPrefs {
  return { activePanel: DEFAULT_RIGHT_PANEL_ID, collapsed: false };
}

/**
 * 校验任意来源的偏好数据：
 * - 未知/非法面板 ID 回退到真实存在的默认面板；
 * - 非法收起状态回退 false；
 * - 非对象输入整体回退默认值。
 */
export function sanitizeWorkspacePrefs(raw: unknown): WorkspaceLayoutPrefs {
  const defaults = getDefaultWorkspacePrefs();
  if (typeof raw !== 'object' || raw === null) return defaults;

  const candidate = raw as Partial<Record<'activePanel' | 'collapsed', unknown>>;
  return {
    activePanel: isRightPanelId(candidate.activePanel) ? candidate.activePanel : defaults.activePanel,
    collapsed: typeof candidate.collapsed === 'boolean' ? candidate.collapsed : defaults.collapsed,
  };
}

/** 读取偏好；localStorage 不可用、JSON 损坏、字段缺失时全部安全回退默认值。 */
export function loadWorkspacePrefs(): WorkspaceLayoutPrefs {
  if (typeof window === 'undefined') return getDefaultWorkspacePrefs();
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY);
    if (!raw) return getDefaultWorkspacePrefs();
    return sanitizeWorkspacePrefs(JSON.parse(raw));
  } catch {
    return getDefaultWorkspacePrefs();
  }
}

/** 写入偏好；写入失败（隐私模式/配额）静默降级，不阻断交互。 */
export function saveWorkspacePrefs(prefs: WorkspaceLayoutPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      WORKSPACE_PREFS_STORAGE_KEY,
      JSON.stringify({ version: 1, activePanel: prefs.activePanel, collapsed: prefs.collapsed }),
    );
  } catch {
    // localStorage 不可写时保持内存态即可，不影响使用。
  }
}
