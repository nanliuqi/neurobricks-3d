import { useEffect } from 'react';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';

/**
 * UI 测试钩子：将核心 UI 状态通过 Tauri 事件 'ui-state-sync' 推送给 Rust 侧，
 * 供 debug 构建的 get_ui_state 命令读取（供外部自动化测试使用）。
 *
 * 设计说明：
 * - 采用"前端事件桥接 → Rust 共享状态"方案：UI 状态只存在于前端 Zustand store，
 *   Rust 无法直接读取，因此由前端在状态变化时推送快照，Rust 侧仅缓存最新快照。
 * - 200ms 防抖：训练进度更新频率高（每 step 一次），避免高频序列化与事件风暴。
 * - 非 Tauri 环境（纯浏览器）下动态导入失败被静默忽略，不影响业务。
 * - 本 hook 只读取 store 状态并推送，不修改任何 store 数据，无业务副作用。
 *
 * @param activePanel 右列当前激活的面板标识（该状态是 MainLayout 局部状态，需从调用方传入）
 */
export function useUiStateSync(activePanel: string) {
  useEffect(() => {
    // release 构建下整个同步机制不生效（与 Rust 端 get_ui_state 仅 debug 可用保持一致，零开销）
    if (!import.meta.env.DEV) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const buildAndEmit = () => {
      const layerState = useLayerStore.getState();
      const trainingState = useTrainingStore.getState();
      const selected = layerState.selectedId
        ? layerState.layers.find(l => l.id === layerState.selectedId)
        : undefined;

      const snapshot = {
        activePanel,
        layerCount: layerState.layers.length,
        totalParams: layerState.totalParams,
        validationPassed: layerState.validationResult.isValid,
        trainingState: trainingState.status,
        selectedBlockType: selected ? selected.type : null,
        timestamp: Date.now(),
      };

      // 动态导入：非 Tauri 环境下导入失败被捕获，静默忽略
      import('@tauri-apps/api/event')
        .then(({ emit }) => emit('ui-state-sync', snapshot))
        .catch(() => {
          // 非 Tauri 环境或事件发送失败，忽略
        });
    };

    // 节流（trailing throttle）而非防抖：训练时 progress 每 ~100ms 触发一次订阅，
    // 纯防抖会被无限重置导致永不 emit（防抖饥饿），节流保证每 500ms 至少推送一次
    let lastEmit = 0;
    const scheduleEmit = () => {
      if (disposed) return;
      if (timer) return; // 已有待触发的定时器，等它执行（不做重置）
      const wait = Math.max(0, 500 - (Date.now() - lastEmit));
      timer = setTimeout(() => {
        timer = null;
        lastEmit = Date.now();
        buildAndEmit();
      }, wait);
    };

    // 订阅两个 store 的全部变更
    const unsubLayer = useLayerStore.subscribe(scheduleEmit);
    const unsubTraining = useTrainingStore.subscribe(scheduleEmit);

    // 挂载时立即推送一次初始快照
    buildAndEmit();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubLayer();
      unsubTraining();
    };
  }, [activePanel]);
}
