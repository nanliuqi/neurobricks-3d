// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::cloud::{
    download_results, poll_cloud_training, stop_cloud_training, submit_cloud_training,
    test_ssh_connection,
};
use commands::dataset::{import_csv, import_excel, import_local_images};
use commands::experiment_ledger::{
    append_experiment_ledger_event, hash_experiment_ledger_events, verify_experiment_ledger,
};
use commands::export::{
    export_experiment_package, export_full_model, export_model_weights, export_numpy_weights,
    export_study_report, load_project, save_project,
};
use commands::gpu::detect_devices;
use commands::trainer_runtime::detect_training_runtime;
use commands::training::{
    open_chart_window, pause_training, predict_image, predict_tabular, run_gradient_diagnosis,
    start_training, step_training, stop_training, TrainingState,
};
use commands::ui_state::{register_ui_state_listener, UiStateBridge};
use std::sync::{Arc, Mutex};
use tauri::Manager;
// get_ui_state 仅 debug 构建存在（测试钩子）
#[cfg(debug_assertions)]
use commands::ui_state::get_ui_state;

/// Windows 11 窗口圆角：主窗口是无边框自定义标题栏窗口（decorations=false），
/// DWM 默认不为其应用圆角裁剪，四角呈直角。
/// 这里直接通过 dwmapi 系统库 FFI 设置 DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND：
/// - 零前端/CSS 改动：DWM 对整个窗口表面（含 WebView）做圆角裁剪；
/// - 零新增依赖：仅声明系统库 extern，不引入任何 crate；
/// - Win10 及更早系统无此属性，调用返回错误码，安全忽略（保持直角）。
#[cfg(windows)]
mod rounded_corners {
    use std::os::raw::{c_long, c_void};

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            attribute: u32,
            value: *const c_void,
            size: u32,
        ) -> c_long;
    }

    /// DWMWA_WINDOW_CORNER_PREFERENCE（Windows 11 Build 22000+）
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    /// DWMWCP_ROUND：系统默认圆角
    const DWMWCP_ROUND: u32 = 2;

    pub fn apply(hwnd: *mut c_void) {
        let preference = DWMWCP_ROUND;
        unsafe {
            // 返回值故意忽略：旧系统上属性不存在时失败是预期行为，不影响窗口功能
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const u32 as *const c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

fn main() {
    let training_state = Arc::new(Mutex::new(TrainingState::new()));
    // 应用退出时 kill 训练子进程的句柄（防孤儿进程占 GPU/CPU）
    let training_state_for_exit = training_state.clone();

    let builder = tauri::Builder::default()
        .manage(training_state)
        // 应用退出清理：确保训练子进程不残留。
        // 主窗口 Destroyed = 应用即将退出（本项目仅主窗口关闭即退出的行为）
        .on_window_event(move |event| {
            if let tauri::WindowEvent::Destroyed = event.event() {
                let child = training_state_for_exit
                    .lock()
                    .ok()
                    .and_then(|mut state| state.take_child_for_shutdown());
                if let Some(mut child) = child {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        })
        // UI 测试钩子的状态缓存（事件桥接方案，见 commands/ui_state.rs）
        .manage(UiStateBridge::new())
        .setup(|app| {
            // 曲线窗口已在配置中预创建（隐藏状态，启动时加载 chart.html）。
            // 拦截关闭事件改为隐藏：避免运行时在 IPC 命令内创建 WebView2 窗口
            // 导致的 Windows 主线程死锁（白窗口 + 整个应用冻结）
            if let Some(w) = app.get_window("chart-view") {
                let w_hidden = w.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w_hidden.hide();
                    }
                });
            }
            // Windows 11 圆角：主窗口与预创建的曲线窗口统一应用（已存在的窗口才能拿到 HWND，
            // 两个窗口均由 tauri.conf.json 预创建，setup 时必定存在）
            #[cfg(windows)]
            for label in ["main", "chart-view"] {
                if let Some(window) = app.get_window(label) {
                    if let Ok(hwnd) = window.hwnd() {
                        // HWND 内部类型随 windows crate 版本为 isize 或指针，双重 as 兼容两者
                        rounded_corners::apply(hwnd.0 as isize as *mut std::os::raw::c_void);
                    }
                }
            }
            // UI 测试钩子：监听前端推送的 ui-state-sync 事件，缓存 UI 状态快照
            register_ui_state_listener(&app.handle());
            Ok(())
        });

    // generate_handler! 只解析纯命令路径（不支持 #[cfg] 属性），
    // 故用条件编译双分支：get_ui_state 仅在 debug 构建注册，
    // release 构建中前端调用会得到 "command get_ui_state not found"（预期行为）
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        // GPU
        detect_devices,
        detect_training_runtime,
        // Training
        start_training,
        stop_training,
        pause_training,
        step_training,
        run_gradient_diagnosis,
        predict_image,
        predict_tabular,
        open_chart_window,
        // Project
        save_project,
        load_project,
        export_model_weights,
        export_full_model,
        export_numpy_weights,
        export_experiment_package,
        export_study_report,
        append_experiment_ledger_event,
        hash_experiment_ledger_events,
        verify_experiment_ledger,
        // Dataset
        import_local_images,
        import_csv,
        import_excel,
        // Cloud/SSH
        test_ssh_connection,
        submit_cloud_training,
        stop_cloud_training,
        download_results,
        poll_cloud_training,
        // UI 测试钩子（仅 debug 构建）
        get_ui_state,
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        // GPU
        detect_devices,
        detect_training_runtime,
        // Training
        start_training,
        stop_training,
        pause_training,
        step_training,
        run_gradient_diagnosis,
        predict_image,
        predict_tabular,
        open_chart_window,
        // Project
        save_project,
        load_project,
        export_model_weights,
        export_full_model,
        export_numpy_weights,
        export_experiment_package,
        export_study_report,
        append_experiment_ledger_event,
        hash_experiment_ledger_events,
        verify_experiment_ledger,
        // Dataset
        import_local_images,
        import_csv,
        import_excel,
        // Cloud/SSH
        test_ssh_connection,
        submit_cloud_training,
        stop_cloud_training,
        download_results,
        poll_cloud_training,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
