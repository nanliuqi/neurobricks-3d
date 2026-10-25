import { useEffect, useId, useRef, type ReactNode } from 'react';
import Button from './Button';

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  tone?: 'warning' | 'danger';
  onCancel: () => void;
  onConfirm: () => void;
}

/** 关键协议动作使用应用内模态框，避免 WebView 原生 confirm 在不同窗口上表现不一致。 */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  busy = false,
  tone = 'warning',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const confirmLatchResetTimer = useRef<number | undefined>(undefined);
  // 确认锁存：只阻断同一事件循环内的连续 Enter / 快速连点（双发）；
  // onConfirm 同步返回后通过微任务/宏任务复位，
  // 确保确认失败且调用方未置 busy 时，用户仍可正常重试。
  const confirmLatchRef = useRef(false);

  useEffect(() => {
    if (!busy) confirmLatchRef.current = false;
  }, [busy]);

  useEffect(() => () => {
    window.clearTimeout(confirmLatchResetTimer.current);
  }, []);

  useEffect(() => {
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        // 弹窗内只有取消/确认两个焦点点，两个方向都显式接管，避免焦点逃出弹窗。
        const onConfirmButton = document.activeElement === confirmButtonRef.current;
        const onCancelButton = document.activeElement === cancelButtonRef.current;
        if (event.shiftKey && onCancelButton) {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        } else if (event.shiftKey && onConfirmButton) {
          event.preventDefault();
          cancelButtonRef.current?.focus();
        } else if (!event.shiftKey && onConfirmButton) {
          event.preventDefault();
          cancelButtonRef.current?.focus();
        } else if (!event.shiftKey && onCancelButton) {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }
        return;
      }
      if (['Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Escape' && !busy) onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [busy, onCancel]);

  const handleConfirm = () => {
    if (busy || confirmLatchRef.current) return;
    confirmLatchRef.current = true;
    try {
      onConfirm();
    } finally {
      // 本事件循环结束后释放锁存；busy 置位期间由 busy 接手防护。
      window.clearTimeout(confirmLatchResetTimer.current);
      confirmLatchResetTimer.current = window.setTimeout(() => {
        confirmLatchRef.current = false;
      }, 0);
    }
  };

  return (
    <div
      className="protocol-confirm__backdrop"
      role="presentation"
      onMouseDown={event => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className={`protocol-confirm protocol-confirm--${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <strong id={titleId} className="protocol-confirm__title">{title}</strong>
        <div id={descriptionId} className="protocol-confirm__description">{description}</div>
        <div className="protocol-confirm__actions">
          <Button ref={cancelButtonRef} disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmButtonRef}
            className="protocol-confirm__confirm"
            variant={tone === 'danger' ? 'danger' : 'warning'}
            loading={busy}
            onClick={handleConfirm}
          >
            {busy ? '正在处理…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
