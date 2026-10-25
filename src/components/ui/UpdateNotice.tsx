import { useRef, useState } from 'react';
import Alert from './Alert';
import Button from './Button';

interface UpdateNoticeProps {
  version?: string;
  onInstall: () => Promise<void>;
}

/**
 * 应用更新提示的纯 UI 边界：负责可访问状态、重复点击防护与失败反馈，
 * 不负责检查版本或调用具体的 Tauri API。
 */
export default function UpdateNotice({ version, onInstall }: UpdateNoticeProps) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState(false);
  const requestInFlight = useRef(false);
  const normalizedVersion = typeof version === 'string'
    ? version.trim().replace(/^v/i, '')
    : '';

  const handleInstall = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setInstalling(true);
    setError(false);
    try {
      await onInstall();
      // 成功后通常会立即重启；若宿主没有重启，保持 busy 可阻止重复安装。
    } catch {
      requestInFlight.current = false;
      setInstalling(false);
      setError(true);
    }
  };

  return (
    <aside className="nb-update-notice" aria-label="应用更新通知">
      <Alert
        tone={error ? 'danger' : 'info'}
        title={error ? '自动更新失败' : '发现新版本'}
        action={(
          <Button
            size="small"
            variant={error ? 'danger' : 'primary'}
            loading={installing}
            onClick={() => void handleInstall()}
          >
            {installing ? '正在更新' : error ? '重试更新' : '立即更新'}
          </Button>
        )}
      >
        {error
          ? '未能启动自动更新，请检查网络后重试。当前版本仍可继续使用。'
          : normalizedVersion
            ? `版本 v${normalizedVersion} 已可用。`
            : '有新版本可用。'}
      </Alert>
    </aside>
  );
}
