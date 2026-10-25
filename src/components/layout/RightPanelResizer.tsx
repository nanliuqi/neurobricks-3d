import type { useResizablePanel } from '../../hooks/useResizablePanel';

type SeparatorProps = ReturnType<typeof useResizablePanel>['separatorProps'];

interface RightPanelResizerProps {
  /** 拖拽/键盘/ARIA 语义全部来自既有且已被测试覆盖的 useResizablePanel，避免重复实现边界。 */
  separatorProps: SeparatorProps;
}

/**
 * 右侧面板分隔条的呈现层：指针拖拽（含 pointer capture）、方向键/Shift/Home/End
 * 键盘调整、双击恢复默认均由 useResizablePanel 提供，本组件不重复实现任何边界逻辑。
 */
export default function RightPanelResizer({ separatorProps }: RightPanelResizerProps) {
  return (
    <div
      {...separatorProps}
      className="app-right-panel__resizer"
      data-testid="right-panel-resizer"
      aria-controls="right-panel-content"
      title="拖动调整宽度；方向键微调，Shift+方向键大步调整；Home/End 到边界；双击恢复默认"
    />
  );
}
