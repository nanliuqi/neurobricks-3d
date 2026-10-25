/**
 * 对比图表渲染错误边界（M07-002~015 截图修复）：
 * 空态矩阵的最后一环——必须区分“没有严格数据”（有明确原因的失败关闭）
 * 与“发生了真实渲染错误”（异常，数据仍在档案中）。
 * 捕获渲染异常后显示诚实的中文说明，绝不让整块区域静默空白。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ComparisonChartBoundaryProps {
  children: ReactNode;
}

interface ComparisonChartBoundaryState {
  error: Error | null;
}

export default class ComparisonChartBoundary extends Component<
  ComparisonChartBoundaryProps,
  ComparisonChartBoundaryState
> {
  state: ComparisonChartBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ComparisonChartBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 保留诊断线索；不吞掉错误语义，界面同步显示失败关闭说明。
    console.error('对比图表渲染失败（数据仍在档案中）:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="comparison-view__render-error" role="alert">
          <strong>图表渲染发生错误</strong>
          <p>
            这是渲染失败，不是“没有严格数据”；档案与指标记录不受影响。
            错误信息：{this.state.error.message || '未知渲染错误'}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
