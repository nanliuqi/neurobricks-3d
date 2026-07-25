import { create } from 'zustand';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  addToast: (type, message, duration = 4000) => {
    const id = crypto.randomUUID();
    set(state => ({
      toasts: [...state.toasts, { id, type, message, duration }],
    }));
    // 自动移除
    setTimeout(() => {
      set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
    }, duration);
  },
  removeToast: (id) => {
    set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
  },
}));

/** 快捷方法（可在任何地方调用，不需要 React 上下文） */
export const toast = {
  success: (msg: string) => useToastStore.getState().addToast('success', msg),
  error: (msg: string) => useToastStore.getState().addToast('error', msg, 6000),
  info: (msg: string) => useToastStore.getState().addToast('info', msg),
  warning: (msg: string) => useToastStore.getState().addToast('warning', msg, 5000),
};

const TOAST_STYLES: Record<ToastType, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: 'rgba(16, 185, 129, 0.15)', border: '#10b981', color: '#6ee7b7', icon: '✓' },
  error: { bg: 'rgba(239, 68, 68, 0.15)', border: '#ef4444', color: '#fca5a5', icon: '✗' },
  info: { bg: 'rgba(59, 130, 246, 0.15)', border: '#3b82f6', color: '#93c5fd', icon: 'ℹ' },
  warning: { bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b', color: '#fcd34d', icon: '⚠' },
};

/** Toast 容器组件，放在 App 根节点 */
export function ToastContainer() {
  const toasts = useToastStore(state => state.toasts);
  const removeToast = useToastStore(state => state.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      maxWidth: '400px',
    }}>
      {toasts.map(t => {
        const s = TOAST_STYLES[t.type];
        return (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            style={{
              backgroundColor: s.bg,
              border: `1px solid ${s.border}`,
              borderRadius: '8px',
              padding: '12px 16px',
              color: s.color,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              backdropFilter: 'blur(8px)',
              animation: 'toastSlideIn 0.2s ease-out',
            }}
          >
            <span style={{ fontWeight: 700, flexShrink: 0 }}>{s.icon}</span>
            <span style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
