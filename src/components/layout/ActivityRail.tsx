import type { Ref } from 'react';
import IconButton from '../ui/IconButton';
import Tooltip from '../ui/Tooltip';
import { RIGHT_PANELS, type RightPanelId } from '../../types/workspace';
import { RIGHT_PANEL_ICONS } from './activityRailIcons';

interface ActivityRailProps {
  activePanel: RightPanelId;
  collapsed: boolean;
  onSelect: (id: RightPanelId) => void;
  /** 供外壳在自动收起等场景把焦点稳定到当前激活入口（仅指向激活按钮）。 */
  activeItemRef?: Ref<HTMLButtonElement>;
}

/**
 * 右侧活动栏：固定宽度的窄型垂直导航，只负责入口呈现与导航事件，
 * 不承载任何业务规则（训练状态等业务提示若未来出现，只允许投影已有状态）。
 *
 * 交互语义（由上层 useWorkspaceLayout 裁决，本组件只上报点击）：
 * - 点击未激活入口：切换面板并展开；
 * - 点击已激活入口：收起/恢复右侧内容面板。
 *
 * 悬停提示统一使用模块 01 的 Tooltip（placement="left"，显示在按钮左侧，
 * 避免越过窗口右缘）；不再使用原生 title，防止系统提示与自定义提示叠加。
 * data-testid 沿用下拉时代的 panel-selector / panel-option-* 命名，
 * 保证既有回归脚本锚点可用。
 */
export default function ActivityRail({ activePanel, collapsed, onSelect, activeItemRef }: ActivityRailProps) {
  return (
    <nav
      className="activity-rail"
      data-testid="panel-selector"
      data-collapsed={collapsed || undefined}
      aria-label="右侧面板导航"
    >
      {RIGHT_PANELS.map(panel => {
        const active = panel.id === activePanel;
        const Icon = RIGHT_PANEL_ICONS[panel.id];
        return (
          <Tooltip key={panel.id} content={panel.tooltip} placement="left">
            <IconButton
              ref={active ? activeItemRef : undefined}
              className="activity-rail__item"
              data-testid={`panel-option-${panel.id.toLowerCase()}`}
              label={panel.label}
              tooltip={null}
              icon={<Icon />}
              active={active}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(panel.id)}
            />
          </Tooltip>
        );
      })}
    </nav>
  );
}
