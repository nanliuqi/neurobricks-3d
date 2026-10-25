import { useState } from 'react';

const TitleBar = () => {
  const [maximized, setMaximized] = useState(false);

  const handleDragStart = async (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    try {
      const { appWindow } = await import('@tauri-apps/api/window');
      await appWindow.startDragging();
    } catch { /* 非 Tauri 环境忽略 */ }
  };

  const handleMinimize = async () => {
    try {
      const { appWindow } = await import('@tauri-apps/api/window');
      await appWindow.minimize();
    } catch { /* ignore */ }
  };

  const handleMaximize = async () => {
    try {
      const { appWindow } = await import('@tauri-apps/api/window');
      await appWindow.toggleMaximize();
      setMaximized(prev => !prev);
    } catch { /* ignore */ }
  };

  const handleClose = async () => {
    try {
      const { appWindow } = await import('@tauri-apps/api/window');
      await appWindow.close();
    } catch { /* ignore */ }
  };

  return (
    <header className="app-title-bar" aria-label="应用标题栏">
      {/* 左侧标题：拖拽区域 */}
      <div
        onPointerDown={handleDragStart}
        className="app-title-bar__drag-region"
      >
        <span className="app-title-bar__name">NeuroBricks 3D</span>
        <span className="app-title-bar__version">v0.1.0</span>
      </div>

      {/* 右侧窗口控制按钮 */}
      <div className="app-title-bar__controls" role="group" aria-label="窗口控制">
        <button
          type="button"
          onClick={handleMinimize}
          className="app-title-bar__button"
          aria-label="最小化窗口"
          title="最小化"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor" aria-hidden="true"><rect width="10" height="1" /></svg>
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className="app-title-bar__button"
          aria-label={maximized ? '还原窗口' : '最大化窗口'}
          title={maximized ? '还原' : '最大化'}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
              <rect x="2.5" y="0.5" width="7" height="7" />
              <rect x="0.5" y="2.5" width="7" height="7" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
              <rect x="1.5" y="1.5" width="7" height="7" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="app-title-bar__button app-title-bar__button--close"
          aria-label="关闭窗口"
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </header>
  );
};

export default TitleBar;
