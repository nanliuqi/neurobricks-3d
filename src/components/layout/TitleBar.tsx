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
    <div
      style={{
        position: 'relative',
        zIndex: 9999,
        height: 32,
        backgroundColor: '#111827',
        borderBottom: '1px solid #374151',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: 12,
        paddingRight: 0,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {/* 左侧标题：拖拽区域 */}
      <div
        onPointerDown={handleDragStart}
        style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, height: '100%', cursor: 'default' }}
      >
        <span style={{ color: 'white', fontSize: 12, fontWeight: 600 }}>NeuroBricks 3D</span>
        <span style={{ color: '#6b7280', fontSize: 10 }}>v0.1.0</span>
      </div>

      {/* 右侧窗口控制按钮 */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          onClick={handleMinimize}
          style={{ width: 46, height: 32, border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#374151'; e.currentTarget.style.color = 'white'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
          title="最小化"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
        </button>
        <button
          onClick={handleMaximize}
          style={{ width: 46, height: 32, border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#374151'; e.currentTarget.style.color = 'white'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
          title="最大化"
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2.5" y="0.5" width="7" height="7" />
              <rect x="0.5" y="2.5" width="7" height="7" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="1.5" y="1.5" width="7" height="7" />
            </svg>
          )}
        </button>
        <button
          onClick={handleClose}
          style={{ width: 46, height: 32, border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#dc2626'; e.currentTarget.style.color = 'white'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
