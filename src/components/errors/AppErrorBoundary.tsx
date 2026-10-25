import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
  errorName: string | null;
}

/**
 * Last-resort renderer boundary. It deliberately does not clear any persisted
 * project or experiment data: a rendering defect must not become data loss.
 */
export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false, errorName: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      failed: true,
      errorName: error.name || 'Error',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application renderer failed:', error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="app-crash-boundary" role="alert" aria-labelledby="app-crash-title">
        <section className="app-crash-boundary__card">
          <div className="app-crash-boundary__mark" aria-hidden="true">!</div>
          <h1 id="app-crash-title">界面遇到异常，项目数据未被清除</h1>
          <p>
            请重新加载应用恢复界面。如果问题反复出现，请记录刚才的操作步骤后反馈。
          </p>
          <p className="app-crash-boundary__diagnostic">
            错误类型：{this.state.errorName ?? 'Error'}
          </p>
          <button type="button" onClick={this.reload}>重新加载应用</button>
        </section>
      </main>
    );
  }
}
