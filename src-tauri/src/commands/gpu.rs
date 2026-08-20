use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows GUI 程序 spawn 控制台子进程时必须加此标志，否则会弹出黑色 cmd 窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

/// 带超时保护运行外部命令（超时强杀进程，返回 None）
/// 避免 nvidia-smi 等外部进程挂起时阻塞应用
fn run_with_timeout(program: &Path, args: &[&str], timeout: Duration) -> Option<std::process::Output> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().ok()?;

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break, // 进程已退出，收集输出
            Ok(None) => {
                if Instant::now() >= deadline {
                    eprintln!("[NeuroBricks] Command timed out after {:?}: {:?}", timeout, program);
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
    child.wait_with_output().ok()
}

/// 检测命令入口：异步执行，绝不阻塞 UI 主线程
#[tauri::command]
pub async fn detect_devices() -> Vec<GPUInfo> {
    tauri::async_runtime::spawn_blocking(detect_devices_blocking)
        .await
        .unwrap_or_default()
}

/// 获取系统内存信息（直接调用 Windows API，绝不挂起）
#[cfg(windows)]
fn get_system_memory_mb() -> (u64, u64) {
    #[repr(C)]
    struct MEMORYSTATUSEX {
        dw_length: u32,
        dw_memory_load: u32,
        ull_total_phys: u64,
        ull_avail_phys: u64,
        ull_total_page_file: u64,
        ull_avail_page_file: u64,
        ull_total_virtual: u64,
        ull_avail_virtual: u64,
        ull_avail_extended_virtual: u64,
    }

    extern "system" {
        fn GlobalMemoryStatusEx(lp_buffer: *mut MEMORYSTATUSEX) -> i32;
    }

    let mut status = MEMORYSTATUSEX {
        dw_length: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        dw_memory_load: 0,
        ull_total_phys: 0,
        ull_avail_phys: 0,
        ull_total_page_file: 0,
        ull_avail_page_file: 0,
        ull_total_virtual: 0,
        ull_avail_virtual: 0,
        ull_avail_extended_virtual: 0,
    };

    unsafe {
        if GlobalMemoryStatusEx(&mut status) != 0 {
            let total_mb = status.ull_total_phys / 1024 / 1024;
            let used_mb = (status.ull_total_phys - status.ull_avail_phys) / 1024 / 1024;
            return (total_mb, used_mb);
        }
    }
    (0, 0)
}

#[cfg(not(windows))]
fn get_system_memory_mb() -> (u64, u64) {
    (0, 0)
}

fn detect_devices_blocking() -> Vec<GPUInfo> {
    let mut devices: Vec<GPUInfo> = Vec::new();

    // 尝试通过 nvidia-smi 检测 NVIDIA GPU（带超时保护）
    devices.extend(detect_nvidia_gpus());

    // CPU 信息：使用纯 Rust std + Windows API，不依赖 sysinfo（后者在部分 Windows 机器上可能挂起）
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(0);
    let cpu_arch = std::env::consts::ARCH;
    let (total_ram_mb, used_ram_mb) = get_system_memory_mb();

    devices.push(GPUInfo {
        available: true,
        device_name: format!("CPU · {}核 · {} · {}GB", cores, cpu_arch, total_ram_mb / 1024),
        vram_total: total_ram_mb,
        vram_used: used_ram_mb,
        cuda_version: String::new(),
        is_integrated: Some(false),
        category: Some("cpu".to_string()),
    });

    devices
}

fn detect_nvidia_gpus() -> Vec<GPUInfo> {
    // 检查 nvidia-smi 是否存在
    let Ok(nvidia_smi) = which::which("nvidia-smi") else {
        return Vec::new();
    };

    // 执行查询（5 秒超时保护）
    let Some(output) = run_with_timeout(
        &nvidia_smi,
        &[
            "--query-gpu=name,memory.total,memory.used,driver_version",
            "--format=csv,noheader,nounits",
        ],
        Duration::from_secs(5),
    ) else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
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

        // 尝试获取 CUDA 版本（复用同一个 nvidia-smi 路径，带超时）
        let cuda_version = get_cuda_version(&nvidia_smi).unwrap_or(driver_version);

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

    devices
}

fn get_cuda_version(nvidia_smi: &Path) -> Option<String> {
    // 从 nvidia-smi 完整输出中提取 CUDA Version（5 秒超时保护）
    let output = run_with_timeout(nvidia_smi, &[], Duration::from_secs(5))?;
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

    None
}
