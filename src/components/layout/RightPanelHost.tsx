import type { ReactNode } from 'react';

interface RightPanelHostProps {
  /** 由 useResizablePanel 裁决后的合法宽度；组件自身不做任何宽度计算。 */
  width: number;
  isResizing: boolean;
  /**
   * 收起态：子树保持挂载（面板局部状态不丢失），但 display:none 使其
   * 不可见、不占布局宽度、退出 Tab 顺序与可访问树。
   * “收起”与“切换面板”是两种语义：切换仍由外层条件渲染卸载旧面板。
   */
  collapsed: boolean;
  /** 面板标题：与业务内容分离，由外壳提供。 */
  title: string;
  /** 分隔条节点（绝对定位在面板左边缘）。 */
  resizer: ReactNode;
  /** 激活面板的内容。 */
  children: ReactNode;
  /** 底部错误面板等固定附属区域。 */
  footer?: ReactNode;
}

/**
 * 右侧内容面板宿主：只负责容器、标题与区域划分。
 * 宽度来自外部（工作区外壳），面板自身不写死宽度；
 * 业务面板的挂载映射由 MainLayout 按既有条件渲染语义传入。
 */
export default function RightPanelHost({
  width,
  isResizing,
  collapsed,
  title,
  resizer,
  children,
  footer,
}: RightPanelHostProps) {
  return (
    <section
      className="app-right-panel"
      data-testid="right-panel"
      data-resizing={isResizing || undefined}
      data-collapsed={collapsed || undefined}
      aria-hidden={collapsed || undefined}
      aria-labelledby="right-panel-heading"
      style={collapsed ? { display: 'none' } : { width: `${width}px` }}
    >
      {resizer}
      <h2 id="right-panel-heading" className="right-panel-host__header">{title}</h2>
      <div id="right-panel-content" className="app-right-panel__content">
        {children}
      </div>
      {footer && <div className="app-right-panel__errors">{footer}</div>}
    </section>
  );
}
