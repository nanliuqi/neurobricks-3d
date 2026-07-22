// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::sync::{Arc, Mutex};
use commands::gpu::detect_devices;
use commands::training::{start_training, stop_training, pause_training, step_training, run_gradient_diagnosis, TrainingState};
use commands::export::{save_project, load_project, export_model_weights, export_full_model, export_numpy_weights};
use commands::dataset::{import_local_images, import_csv, import_excel};
use commands::cloud::{test_ssh_connection, submit_cloud_training, stop_cloud_training, download_results, poll_cloud_training};

fn main() {
    let training_state = Arc::new(Mutex::new(TrainingState::new()));

    tauri::Builder::default()
        .manage(training_state)
        .invoke_handler(tauri::generate_handler![
            // GPU
            detect_devices,
            // Training
            start_training,
            stop_training,
            pause_training,
            step_training,
            run_gradient_diagnosis,

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
