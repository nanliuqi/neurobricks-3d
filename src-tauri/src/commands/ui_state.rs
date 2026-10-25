//! UI 测试钩子：get_ui_state 命令与 UI 状态桥接。
//!
//! 架构说明（事件桥接方案）：
//! - UI 状态只存在于前端 Zustand store，Rust 无法直接读取；
//! - 前端 useUiStateSync hook 在状态变化时通过 'ui-state-sync' 事件推送 JSON 快照；
//! - 本模块在 setup 阶段注册监听，将最新快照缓存到托管状态 UiStateBridge；
//! - get_ui_state 命令直接读取缓存快照（不加锁前端、不阻塞 UI，O(1)）。
//!
//! 构建门控：
//! - get_ui_state 命令仅在 debug_assertions（dev/debug 构建）下编译与注册；
//! - release 构建中该命令不存在，前端调用会被 invoke_handler 拒绝并返回
//!   "command get_ui_state not found"（这是预期行为）；
//! - UiStateBridge 与事件监听在所有构建中存在（开销为一个 Mutex<JSON> 与
//!   低频事件监听，可忽略），以避免 cfg 扩散到 setup/manage 多处。

use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// UI 状态快照缓存（由 'ui-state-sync' 事件更新）
pub struct UiStateBridge {
    pub snapshot: Mutex<serde_json::Value>,
}

impl UiStateBridge {
    pub fn new() -> Self {
        Self {
            snapshot: Mutex::new(serde_json::json!({
                "activePanel": "param",
                "layerCount": 0,
                "totalParams": 0,
                "validationPassed": true,
                "trainingState": "idle",
                "selectedBlockType": null,
                "timestamp": 0
            })),
        }
    }
}

/// 注册 'ui-state-sync' 事件监听，把前端推送的快照写入 UiStateBridge。
/// 在 Builder::setup 中调用。事件由主窗口前端 emit，故监听主窗口即可。
pub fn register_ui_state_listener(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        eprintln!("[NeuroBricks] ui-state-sync listener: main window not found");
        return;
    };
    let handle = app.clone();
    window.listen("ui-state-sync", move |event| {
        let Some(payload) = event.payload() else {
            return;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
            return;
        };
        if let Some(bridge) = handle.try_state::<UiStateBridge>() {
            if let Ok(mut guard) = bridge.snapshot.lock() {
                *guard = value;
            }
        }
    });
}

/// 获取当前核心 UI 状态（仅测试用途）。
///
/// 返回字段：activePanel / layerCount / totalParams / validationPassed /
/// trainingState / selectedBlockType / timestamp。
///
/// 仅 debug 构建注册：release 构建中调用会得到
/// "command get_ui_state not found" 错误（预期行为）。
#[tauri::command]
#[cfg(debug_assertions)]
pub fn get_ui_state(state: tauri::State<'_, UiStateBridge>) -> serde_json::Value {
    state
        .snapshot
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|_| serde_json::json!({ "error": "ui state lock poisoned" }))
}
