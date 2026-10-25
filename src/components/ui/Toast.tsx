import { create } from 'zustand';
import { StatusToneIcon, type StatusTone } from './statusIcons';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
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

const MAX_VISIBLE_TOASTS = 5;
let fallbackId = 0;

function nextToastId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    fallbackId += 1;
    return `toast-${Date.now()}-${fallbackId}`;
  }
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  addToast: (type, message, duration = 4000) => {
    const id = nextToastId();
    const normalizedDuration = Number.isFinite(duration) && duration > 0 ? duration : 4000;
    set(state => ({
      // 突发错误只保留最近五条，避免通知层无限增长并遮住整个工作区。
      toasts: [...state.toasts, { id, type, message, duration: normalizedDuration }]
        .slice(-MAX_VISIBLE_TOASTS),
    }));
    setTimeout(() => {
      set(state => ({ toasts: state.toasts.filter(toastItem => toastItem.id !== id) }));
    }, normalizedDuration);
  },
  removeToast: (id) => {
    set(state => ({ toasts: state.toasts.filter(toastItem => toastItem.id !== id) }));
  },
}));

/** 快捷方法（可在任何地方调用，不需要 React 上下文）。 */
export const toast = {
  success: (message: string) => useToastStore.getState().addToast('success', message),
  error: (message: string) => useToastStore.getState().addToast('error', message, 6000),
  info: (message: string) => useToastStore.getState().addToast('info', message),
  warning: (message: string) => useToastStore.getState().addToast('warning', message, 5000),
};

const TOAST_TONES: Record<ToastType, StatusTone> = {
  success: 'success',
  error: 'danger',
  info: 'info',
  warning: 'warning',
};

/**
 * 全局通知容器。
 * 错误使用 assertive alert，其余使用 polite status；关闭操作由真实按钮承担，
 * 不再依赖“点击整张卡片”这种对键盘用户不可发现的交互。
 */
export function ToastContainer() {
  const toasts = useToastStore(state => state.toasts);
  const removeToast = useToastStore(state => state.removeToast);

  if (toasts.length === 0) return null;

  return (
    <section className="nb-toast-region" aria-label="应用通知">
      {toasts.map(toastItem => {
        const tone = TOAST_TONES[toastItem.type];
        const isError = toastItem.type === 'error';
        return (
          <div
            key={toastItem.id}
            className={`nb-toast nb-toast--${tone}`}
            role={isError ? 'alert' : 'status'}
            aria-live={isError ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            <StatusToneIcon tone={tone} />
            <p className="nb-toast__message">{toastItem.message}</p>
            <button
              type="button"
              className="nb-toast__close"
              aria-label={`关闭通知：${toastItem.message}`}
              onClick={() => removeToast(toastItem.id)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="m5 5 6 6M11 5l-6 6" />
              </svg>
            </button>
          </div>
        );
      })}
    </section>
  );
}
