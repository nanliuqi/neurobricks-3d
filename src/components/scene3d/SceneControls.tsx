import { useEffect, useRef, useState } from 'react';
import { useLayerStore } from '@/stores/useLayerStore';

interface ClearSceneDialogProps {
  layerCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

function ClearSceneDialog({ layerCount, onCancel, onConfirm }: ClearSceneDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === cancelButtonRef.current) {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        } else if (!event.shiftKey && document.activeElement === confirmButtonRef.current) {
          event.preventDefault();
          cancelButtonRef.current?.focus();
        }
        return;
      }

      // 对话框存在期间，场景级删除/换位快捷键不能穿透到 NeuroScene。
      if (['Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onCancel]);

  return (
    <div
      role="presentation"
      data-testid="clear-scene-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backgroundColor: 'rgba(2, 6, 23, 0.72)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-scene-dialog-title"
        aria-describedby="clear-scene-dialog-description"
        style={{
          width: 'min(380px, calc(100vw - 32px))',
          padding: '18px',
          border: '1px solid #7f1d1d',
          borderRadius: '10px',
          backgroundColor: '#16213e',
          boxShadow: '0 18px 48px rgba(0, 0, 0, 0.55)',
          color: '#e2e8f0',
        }}
      >
        <div id="clear-scene-dialog-title" style={{ fontSize: '16px', fontWeight: 700 }}>
          确认清空场景？
        </div>
        <div
          id="clear-scene-dialog-description"
          style={{ marginTop: '10px', color: '#cbd5e1', fontSize: '13px', lineHeight: 1.6 }}
        >
          场景中的 {layerCount} 个积木将被删除，应用内无法撤销。已单独保存的项目文件不受影响。
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            style={{
              padding: '7px 14px',
              border: '1px solid #475569',
              borderRadius: '5px',
              backgroundColor: '#334155',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            style={{
              padding: '7px 14px',
              border: '1px solid #ef4444',
              borderRadius: '5px',
              backgroundColor: '#b91c1c',
              color: 'white',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            确认清除
          </button>
        </div>
      </div>
    </div>
  );
}

const SceneControls = () => {
  const [isLocked, setIsLocked] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const layerCount = useLayerStore(state => state.layers.length);
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
    setIsClearConfirmOpen(true);
  };

  const handleConfirmClear = () => {
    clearAllLayers();
    setIsClearConfirmOpen(false);
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
        type="button"
        onClick={handleToggleLock}
        aria-label={isLocked ? '解除视角锁定' : '锁定视角'}
        style={{
          ...btnBase,
          backgroundColor: isLocked ? 'rgba(217, 119, 6, 0.9)' : 'rgba(55, 65, 81, 0.9)',
        }}
        title={isLocked ? '解除视角锁定' : '锁定视角（禁止旋转、平移和缩放）'}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = isLocked ? '#b45309' : '#4b5563'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = isLocked ? 'rgba(217, 119, 6, 0.9)' : 'rgba(55, 65, 81, 0.9)'; }}
      >
        {isLocked ? '🔒 视角已锁定' : '🔓 视角自由'}
      </button>

      {/* 复位按钮 */}
      <button
        type="button"
        onClick={handleReset}
        aria-label="复位视角"
        data-testid="reset-view-btn"
        style={{ ...btnBase, backgroundColor: 'rgba(37, 99, 235, 0.9)' }}
        title="复位视角"
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.9)'; }}
      >
        🔄 复位
      </button>

      {/* 清除按钮 */}
      <button
        type="button"
        onClick={handleClear}
        aria-label="清除所有图层"
        data-testid="clear-scene-btn"
        style={{ ...btnBase, backgroundColor: 'rgba(220, 38, 38, 0.9)' }}
        title="清除所有图层"
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#b91c1c'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(220, 38, 38, 0.9)'; }}
      >
        🗑️ 清除
      </button>

      {isClearConfirmOpen && (
        <ClearSceneDialog
          layerCount={layerCount}
          onCancel={() => setIsClearConfirmOpen(false)}
          onConfirm={handleConfirmClear}
        />
      )}
    </div>
  );
};

export default SceneControls;
