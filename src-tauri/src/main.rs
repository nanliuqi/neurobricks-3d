// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use commands::gpu::detect_devices;
use commands::training::{start_training, stop_training, pause_training, step_training, run_gradient_diagnosis, predict_image, open_chart_window, TrainingState};
use commands::export::{save_project, load_project, export_model_weights, export_full_model, export_numpy_weights};
use commands::dataset::{import_local_images, import_csv, import_excel};
use commands::cloud::{test_ssh_connection, submit_cloud_training, stop_cloud_training, download_results, poll_cloud_training};

fn main() {
    let training_state = Arc::new(Mutex::new(TrainingState::new()));

    tauri::Builder::default()
        .manage(training_state)
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // GPU
            detect_devices,
            // Training
            start_training,
            stop_training,
            pause_training,
            step_training,
            run_gradient_diagnosis,
            predict_image,
            open_chart_window,

            // Project
            save_project,
            load_project,
            export_model_weights,
            export_full_model,
            export_numpy_weights,

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

        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
