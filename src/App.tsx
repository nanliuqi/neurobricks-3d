import { useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import { useTrainingStore } from './stores/useTrainingStore';
import { useLayerStore } from './stores/useLayerStore';

const AUTOSAVE_KEY = 'neurobricks_autosave';

export default function App() {
  const layers = useLayerStore(state => state.layers);

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

  // 启动时检查自动保存数据，提示用户恢复
  useEffect(() => {
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
    if (layers.length === 0) {
      try {
        localStorage.removeItem(AUTOSAVE_KEY);
      } catch {}
    }
  }, [layers.length]);

  // Tauri 训练事件监听 + 心跳超时保护
  useEffect(() => {
    let unlisteners: (() => void)[] = [];
    let lastProgressTime = Date.now();

    // 心跳检测：每 15 秒检查一次，60 秒无任何进度更新则判定超时
    const heartbeatTimer = setInterval(() => {
      const store = useTrainingStore.getState();
      if (store.isTraining && Date.now() - lastProgressTime > 60000) {
        store.setError('训练超时：60 秒内无进度更新，训练进程可能已停止响应');
      }
    }, 15000);

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');

        unlisteners.push(await listen('training-progress', (event) => {
          const data = event.payload as any;
          const store = useTrainingStore.getState();

          // 更新心跳时间戳
          lastProgressTime = Date.now();

          if (data.type === 'progress') {
            store.updateProgress({
              epoch: data.epoch ?? 0,
              step: data.step ?? 0,
              loss: data.loss ?? 0,
              accuracy: data.accuracy ?? 0,
              timestamp: Date.now(),
            });
          } else if (data.type === 'epoch_end') {
            store.updateProgress({
              epoch: data.epoch ?? 0,
              step: 0,
              loss: data.trainLoss ?? data.train_loss ?? 0,
              accuracy: data.valAccuracy ?? data.val_accuracy ?? 0,
              timestamp: Date.now(),
            });
          } else if (data.type === 'done') {
            // 仅在训练进行中时处理，避免与 training-done 事件重复调用
            if (store.isTraining) {
              store.finishTraining(data.finalAccuracy ?? data.final_accuracy ?? 0);
            }
          } else if (data.type === 'log') {
            const level = data.level === 'warning' ? 'warn' : data.level || 'info';
            store.addLog(level, data.message ?? '');
          }
        }));

        unlisteners.push(await listen('training-done', () => {
          const store = useTrainingStore.getState();
          // 仅在训练进行中时处理（“done”消息已处理过时不再重复调用）
          if (store.isTraining) {
            store.finishTraining(store.currentAccuracy ?? 0);
          }
        }));

        unlisteners.push(await listen('training-error', (event) => {
          const data = event.payload as any;
          const store = useTrainingStore.getState();
          store.setError(data.message ?? '训练出错');
        }));
      } catch {
        // 非 Tauri 环境，忽略
      }
    })();

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
      clearInterval(heartbeatTimer);
    };
  }, []);

  return <MainLayout />;
}
