import { useState } from 'react';
import { useLayerStore } from '@/stores/useLayerStore';

const SceneControls = () => {
  const [isLocked, setIsLocked] = useState(false);
  const clearAllLayers = useLayerStore(state => state.clearAllLayers);

  const handleToggleLock = () => {
    const next = !isLocked;
    setIsLocked(next);
    window.dispatchEvent(new CustomEvent('scene-lock', { detail: { locked: next } }));
  };

  const handleReset = () => {
    window.dispatchEvent(new CustomEvent('scene-reset'));
  };

  const handleClear = () => {
    if (confirm('确定要清除所有图层吗？此操作不可恢复。')) {
      clearAllLayers();
    }
  };

  const btnBase: React.CSSProperties = {
    padding: '4px 10px',
    borderRadius: '4px',
    color: 'white',
    fontSize: '12px',
    fontWeight: 500,
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  };

  return (
    <div style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 20, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* 视角锁定按钮 */}
      <button
        onClick={handleToggleLock}
        style={{
          ...btnBase,
          backgroundColor: isLocked ? 'rgba(217, 119, 6, 0.9)' : 'rgba(55, 65, 81, 0.9)',
        }}
        title={isLocked ? '已锁定视角' : '自由视角'}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = isLocked ? '#b45309' : '#4b5563'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = isLocked ? 'rgba(217, 119, 6, 0.9)' : 'rgba(55, 65, 81, 0.9)'; }}
      >
        {isLocked ? '🔒 已锁定' : '🔓 自由'}
      </button>

      {/* 复位按钮 */}
      <button
        onClick={handleReset}
        style={{ ...btnBase, backgroundColor: 'rgba(37, 99, 235, 0.9)' }}
        title="复位视角"
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.9)'; }}
      >
        🔄 复位
      </button>

      {/* 清除按钮 */}
      <button
        onClick={handleClear}
        style={{ ...btnBase, backgroundColor: 'rgba(220, 38, 38, 0.9)' }}
        title="清除所有图层"
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#b91c1c'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(220, 38, 38, 0.9)'; }}
      >
        🗑️ 清除
      </button>
    </div>
  );
};

export default SceneControls;
