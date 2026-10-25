import { useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import { ToastContainer } from './components/ui/Toast';
import UpdateNotice from './components/ui/UpdateNotice';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import { useLayerStore } from './stores/useLayerStore';
import { writeChartMetricsNow } from './utils/chartSync';
import {
  ensureTrainingEventBridge,
  subscribeTrainingRuntimeEvents,
} from './trainingRuntime';

const AUTOSAVE_KEY = 'neurobricks_autosave';

/** 判断当前是否为主窗口。
 * 重要：自动保存恢复使用 window.confirm（进程级模态框），若在任何非主窗口（如曲线弹窗）误触发，
 * 会冻结整个应用。因此该逻辑仅限主窗口执行。 */
function isMainWindow(): boolean {
  try {
    const meta = (window as unknown as { __TAURI_METADATA__?: { __currentWindow?: { label?: string } } }).__TAURI_METADATA__;
    // 能读到元数据时，仅当 label 为 main 才视为主窗口
    if (meta?.__currentWindow?.label) {
      return meta.__currentWindow.label === 'main';
    }
  } catch {
    // 忽略
  }
  // 无法判断时（纯浏览器环境）默认允许
  return true;
}

async function installAvailableUpdate(): Promise<void> {
  const { installUpdate } = await import('@tauri-apps/api/updater');
  await installUpdate();
  const { relaunch } = await import('@tauri-apps/api/process');
  await relaunch();
}

export default function App() {
  // 根组件只关心“是否为空”；订阅完整 layers 会让每次调参都重渲染整个应用外壳。
  const layerCount = useLayerStore(state => state.layers.length);
  const updateInfo = useUpdateChecker();

  // 自动保存：每 30 秒将网络结构序列化到 localStorage
  useEffect(() => {
    const AUTOSAVE_INTERVAL = 30000;

    const saveTimer = setInterval(() => {
      const state = useLayerStore.getState();
      if (state.layers.length === 0) return; // 空网络不保存

      const data = {
        layers: state.layers,
        layoutMode: state.layoutMode,
        towerName: state.towerName,
        savedAt: Date.now(),
      };
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
      } catch {
        // localStorage 满或不可用，静默忽略
      }
    }, AUTOSAVE_INTERVAL);

    return () => clearInterval(saveTimer);
  }, []);

  // 启动时检查自动保存数据，提示用户恢复（仅主窗口，避免 window.confirm 模态框冻结其他窗口）
  useEffect(() => {
    if (!isMainWindow()) return;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);
      if (!data.layers || data.layers.length === 0) return;

      // 超过 24 小时不提示，直接清除
      const age = Date.now() - (data.savedAt || 0);
      if (age > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(AUTOSAVE_KEY);
        return;
      }

      // 延迟提示，等组件渲染完成
      setTimeout(() => {
        const timeStr = new Date(data.savedAt).toLocaleTimeString('zh-CN', { hour12: false });
        const confirmed = window.confirm(
          `检测到上次自动保存的网络（${data.layers.length} 层，保存于 ${timeStr}），是否恢复？`
        );
        if (confirmed) {
          useLayerStore.getState().loadProject({
            layers: data.layers,
            layoutMode: data.layoutMode || 'vertical',
          });
        } else {
          localStorage.removeItem(AUTOSAVE_KEY);
        }
      }, 500);
    } catch {
      // JSON 解析失败，清除损坏的数据
      try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
    }
  }, []);

  // 网络清空时清除自动保存数据
  useEffect(() => {
    if (layerCount === 0) {
      try {
        localStorage.removeItem(AUTOSAVE_KEY);
      } catch {}
    }
  }, [layerCount]);

  // 训练事件由 trainingRuntime 的进程级单例桥接；这里仅订阅已处理的事件来同步曲线。
  // 进程活性由 Rust 看门狗统一裁决，前端不维护第二套超时钟。
  useEffect(() => {
    // 独立曲线窗口数据同步：将曲线数据写入 localStorage（同源窗口共享），
    // chart.html 每 500ms 轮询读取。节流 600ms，避免频繁序列化大数组
    let lastChartSync = 0;
    const syncChartMetrics = (force = false) => {
      const now = Date.now();
      if (!force && now - lastChartSync < 600) return;
      lastChartSync = now;
      writeChartMetricsNow();
    };

    const unsubscribe = subscribeTrainingRuntimeEvents(result => {
      if (result === 'metric') syncChartMetrics();
      if (result === 'done') syncChartMetrics(true);
    });
    void ensureTrainingEventBridge().catch(error => {
      // 启动训练时会再次尝试，并把失败作为 startup 错误展示给用户。
      console.error('Failed to prepare training event bridge:', error);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <>
      <MainLayout />
      <ToastContainer />
      {updateInfo.available && (
        <UpdateNotice version={updateInfo.version} onInstall={installAvailableUpdate} />
      )}
    </>
  );
}
