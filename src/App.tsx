import { useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import { useTrainingStore } from './stores/useTrainingStore';

export default function App() {
  useEffect(() => {
    let unlisteners: (() => void)[] = [];

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');

        unlisteners.push(await listen('training-progress', (event) => {
          const data = event.payload as any;
          const store = useTrainingStore.getState();

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
              loss: data.trainLoss ?? 0,
              accuracy: data.valAccuracy ?? 0,
              timestamp: Date.now(),
            });
          } else if (data.type === 'done') {
            store.finishTraining(data.finalAccuracy ?? 0);
          } else if (data.type === 'log') {
            const level = data.level === 'warning' ? 'warn' : data.level || 'info';
            store.addLog(level, data.message ?? '');
          }
        }));

        unlisteners.push(await listen('training-done', () => {
          const store = useTrainingStore.getState();
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
    };
  }, []);

  return <MainLayout />;
}
