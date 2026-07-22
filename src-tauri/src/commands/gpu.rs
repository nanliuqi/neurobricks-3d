use serde::{Deserialize, Serialize};
use std::process::Command;
use sysinfo::System;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GPUInfo {
    pub available: bool,
    pub device_name: String,
    pub vram_total: u64,  // MB
    pub vram_used: u64,   // MB
    pub cuda_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_integrated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

#[tauri::command]
pub fn detect_devices() -> Vec<GPUInfo> {
    let mut devices: Vec<GPUInfo> = Vec::new();

    // 尝试通过 nvidia-smi 检测 NVIDIA GPU
    if let Ok(nvidia_devices) = detect_nvidia_gpus() {
        devices.extend(nvidia_devices);
    }

    // 添加 CPU 信息
    use sysinfo::SystemExt;
    let mut sys = System::new_with_specifics(sysinfo::RefreshKind::everything());
    sys.refresh_all();

    let cpu_brand = std::env::consts::ARCH.to_string();
    let cores = sys.cpus().len();
    let total_ram_mb = sys.total_memory() / 1024 / 1024;

    devices.push(GPUInfo {
        available: true,
        device_name: format!("CPU · {}核 · {} · {}GB", cores, cpu_brand, total_ram_mb / 1024),
        vram_total: total_ram_mb,
        vram_used: sys.used_memory() / 1024 / 1024,
        cuda_version: String::new(),
        is_integrated: Some(false),
        category: Some("cpu".to_string()),
    });

    devices
}

fn detect_nvidia_gpus() -> Result<Vec<GPUInfo>, String> {
    // 检查 nvidia-smi 是否存在
    let nvidia_smi = which::which("nvidia-smi")
        .map_err(|_| "nvidia-smi not found".to_string())?;

    // 执行 nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version --format=csv,noheader,nounits
    let output = Command::new(nvidia_smi)
        .args([
            "--query-gpu=name,memory.total,memory.used,driver_version",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .map_err(|e| format!("Failed to run nvidia-smi: {}", e))?;

    if !output.status.success() {
        return Err("nvidia-smi command failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut devices = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
        if parts.len() < 4 {
            continue;
        }

        let device_name = parts[0].to_string();
        let vram_total = parts[1].parse::<u64>().unwrap_or(0);
        let vram_used = parts[2].parse::<u64>().unwrap_or(0);
        let driver_version = parts[3].to_string();

        // 尝试获取 CUDA 版本
        let cuda_version = get_cuda_version().unwrap_or_else(|| driver_version.clone());

        devices.push(GPUInfo {
            available: true,
            device_name,
            vram_total,
            vram_used,
            cuda_version,
            is_integrated: Some(false),
            category: Some("discrete".to_string()),
        });
    }

    if devices.is_empty() {
        return Err("No NVIDIA GPU detected".to_string());
    }

    Ok(devices)
}

fn get_cuda_version() -> Option<String> {
    // 尝试从 nvidia-smi 输出中获取 CUDA 版本
    let output = Command::new("nvidia-smi")
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines() {
        if line.contains("CUDA Version") {
            if let Some(version) = line.split(':').nth(1) {
                let v = version.trim();
                // 去掉可能跟在后面的其他文字
                let v = v.split_whitespace().next().unwrap_or(v);
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
    }

    // 备选：读 nvcc --version
    let nvcc_output = Command::new("nvcc")
        .arg("--version")
        .output()
        .ok()?;

    let nvcc_stdout = String::from_utf8_lossy(&nvcc_output.stdout);
    for line in nvcc_stdout.lines() {
        if line.contains("release") {
            if let Some(release) = line.split("release").nth(1) {
                let version = release.trim().split(',').next().unwrap_or("").trim();
                if !version.is_empty() {
                    return Some(version.to_string());
                }
            }
        }
    }

    None
}
