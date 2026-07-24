use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LayerConfig {
    #[serde(rename = "type")]
    pub layer_type: String,
    pub params: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrainConfig {
    pub epochs: u32,
    pub learning_rate: f64,
    pub batch_size: u32,
    pub dataset: String,
    pub device: String,
    pub layers: Vec<LayerConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub optimizer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight_decay: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub train_ratio: Option<f64>,
    /// Input 层形状 [C, H, W]：Python 端 local_image 数据集据此 Resize / 灰度化，
    /// 使数据与模型输入一致（缺失时 Python 回退 3×224×224）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_shape: Option<Vec<u32>>,
}

/// 训练状态管理
pub struct TrainingState {
    pub child_process: Option<Child>,
    pub child_stdin: Option<ChildStdin>,  // 单独保存 stdin 句柄
    pub _is_paused: bool,
}

impl TrainingState {
    pub fn new() -> Self {
        Self {
            child_process: None,
            child_stdin: None,
            _is_paused: false,
        }
    }
}

/// 查找训练 sidecar 可执行文件（优先 exe，回退 Python）
fn find_trainer_exe(script_dir: &std::path::Path) -> Option<(std::path::PathBuf, Vec<String>)> {

    // 优先查找打包后的 exe（onedir 模式）
    let exe_path = script_dir.join("nb-trainer.exe");
    let exe_path_alt = script_dir.join("nb-trainer").join("nb-trainer.exe");

    if exe_path.exists() {
        eprintln!("[NeuroBricks] Found packaged exe: {:?}", exe_path);
        return Some((exe_path, vec![]));
    }
    if exe_path_alt.exists() {
        eprintln!("[NeuroBricks] Found packaged exe (alt): {:?}", exe_path_alt);
        return Some((exe_path_alt, vec![]));
    }

    // 回退到 Python 解释器
    let python_path = std::env::var("PYTHON").unwrap_or_else(|_| "python".to_string());
    let main_py = script_dir.join("main.py");
    if main_py.exists() {
        eprintln!("[NeuroBricks] Using Python interpreter: {} with {:?}", python_path, main_py);
        return Some((PathBuf::from(python_path), vec![main_py.to_string_lossy().to_string()]));
    }

    None
}

#[tauri::command]
pub fn start_training(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<TrainingState>>>,
    config: TrainConfig,
) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    // 如果已有进程在运行，先停止
    if let Some(mut child) = state_guard.child_process.take() {
        let _ = child.kill();
    }

    // 序列化配置为 JSON
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    // 获取 sidecar 目录路径
    // 优先用 resolve_resource，失败时用可执行文件目录 fallback
    let sidecar_path = app
        .path_resolver()
        .resolve_resource("sidecars/nb-trainer")
        .or_else(|| {
            // Fallback: 相对于当前可执行文件目录
            std::env::current_exe().ok().and_then(|exe| {
                exe.parent().map(|p| {
                    let mut path = p.to_path_buf();
                    // dev 模式: exe 在 src-tauri/target/debug/
                    // 需要往上找到 src-tauri/
                    if path.ends_with("debug") || path.ends_with("release") {
                        path.pop(); // target/
                        path.pop(); // src-tauri/
                    }
                    path.join("sidecars").join("nb-trainer")
                })
            })
        })
        .ok_or("Failed to resolve sidecar path. Add 'sidecars/nb-trainer/*' to bundle.resources in tauri.conf.json")?;
    
    eprintln!("[NeuroBricks] Sidecar path: {:?}", sidecar_path);
    
    let _script_path = sidecar_path.join("main.py");
    
    
    let work_dir = sidecar_path.clone();

    // 查找可执行文件（优先 exe，回退 Python）
    // 生产环境中 exe 在 sidecars/dist/nb-trainer/ 下，开发环境在 sidecars/nb-trainer/ 下
    let (program, args) = find_trainer_exe(&sidecar_path)
        .or_else(|| {
            // 生产环境：exe 在 sidecars/dist/nb-trainer/ 目录
            sidecar_path.parent().and_then(|parent| {
                let dist_path = parent.join("dist").join("nb-trainer");
                eprintln!("[NeuroBricks] Trying dist path: {:?}", dist_path);
                find_trainer_exe(&dist_path)
            })
        })
        .ok_or_else(|| "找不到训练 sidecar（nb-trainer.exe 或 main.py）".to_string())?;

    // 启动训练进程
    eprintln!("[NeuroBricks] Starting trainer: {:?} {:?}", program, args);
    
    let mut child = Command::new(program)
        .args(&args)
        .current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start training process: {}", e))?;
    
    eprintln!("[NeuroBricks] Python process started, PID: {:?}", child.id());

    // 写入配置到 stdin,但保留句柄
    {
        let stdin = child.stdin.as_mut().ok_or("Failed to get stdin")?;
        use std::io::Write;
        stdin
            .write_all(config_json.as_bytes())
            .map_err(|e| format!("Failed to write config: {}", e))?;
        stdin
            .write_all(b"\n")
            .map_err(|e| format!("Failed to write newline: {}", e))?;
        stdin.flush().map_err(|e| format!("Failed to flush stdin: {}", e))?;
    }

    // 保存 stdin 句柄(不从 child 中拿走)
    if let Some(stdin) = child.stdin.take() {
        state_guard.child_stdin = Some(stdin);
    }

    // 保存进程句柄
    state_guard.child_process = Some(child);
    drop(state_guard);

    // 在新线程中读取 stdout
    let app_clone = app.clone();
    let state_clone = state.inner().clone();

    std::thread::spawn(move || {
        let mut state_guard = state_clone.lock().unwrap();
        let stdout = match state_guard.child_process.as_mut() {
            Some(child) => child.stdout.take(),
            None => return,
        };
        // 同时取走 stderr
        let stderr = state_guard.child_process.as_mut().and_then(|c| c.stderr.take());
        drop(state_guard);

        // stderr 单独读取线程
        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stderr);
                for line_str in reader.lines().map_while(Result::ok) {
                    eprintln!("[Python stderr] {}", line_str);
                }
            });
        }

        let stdout = stdout.unwrap();
        
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            match line {
                Ok(line_str) => {
                    // 尝试解析 JSON
                    if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(&line_str) {
                        if let Some(event_type) = json_value.get("type").and_then(|v| v.as_str()) {
                            match event_type {
                                "progress" | "epoch_end" | "done" => {
                                    let _ = app_clone.get_window("main").and_then(|w| w.emit("training-progress", &json_value).ok());
                                }
                                "error" => {
                                    let _ = app_clone.get_window("main").and_then(|w| w.emit("training-error", &json_value).ok());
                                    break;
                                }
                                "log" => {
                                    let _ = app_clone.get_window("main").and_then(|w| w.emit("training-progress", &json_value).ok());
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }

        // stdout 关闭 = 进程已结束
        // 检查进程退出状态，异常退出时发送 error 事件
        let exit_status = state_clone.lock().unwrap()
            .child_process.as_mut()
            .and_then(|c| c.try_wait().ok().flatten());

        if let Some(status) = exit_status {
            if !status.success() {
                let _ = app_clone.get_window("main").and_then(|w| {
                    w.emit("training-error", &serde_json::json!({
                        "type": "error",
                        "message": "训练进程异常退出，请检查网络结构是否正确"
                    })).ok()
                });
            }
        }

        // 无论正常还是异常，都发 done 让前端结束训练状态
        let _ = app_clone.get_window("main").and_then(|w| w.emit("training-done", &serde_json::json!({})).ok());
    });

    Ok(())
}

#[tauri::command]
pub fn stop_training(state: tauri::State<'_, Arc<Mutex<TrainingState>>>) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    // 先关闭 stdin(通知 Python 进程停止)
    state_guard.child_stdin = None;

    // 再 kill 进程
    if let Some(mut child) = state_guard.child_process.take() {
        child.kill().map_err(|e| format!("Failed to stop training: {}", e))?;
        // 等待进程完全退出，避免快速连续停止→开始时拿到旧进程
        let _ = child.wait();
    }

    Ok(())
}

#[tauri::command]
pub fn pause_training(state: tauri::State<'_, Arc<Mutex<TrainingState>>>) -> Result<(), String> {
    eprintln!("[NeuroBricks] pause_training called");
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    if let Some(stdin) = state_guard.child_stdin.as_mut() {
        use std::io::Write;
        let command = serde_json::json!({"type": "pause"});
        let cmd_str = serde_json::to_string(&command).unwrap();
        eprintln!("[NeuroBricks] Sending to Python: {}", cmd_str);
        stdin
            .write_all(cmd_str.as_bytes())
            .map_err(|e| format!("Failed to send pause command: {}", e))?;
        stdin
            .write_all(b"\n")
            .map_err(|e| format!("Failed to send newline: {}", e))?;
        stdin
            .flush()
            .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        eprintln!("[NeuroBricks] Pause command sent successfully");
    } else {
        eprintln!("[NeuroBricks] pause_training: no child_stdin available!");
        return Err("训练进程不可用（未启动或已结束）".to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn step_training(state: tauri::State<'_, Arc<Mutex<TrainingState>>>) -> Result<(), String> {
    eprintln!("[NeuroBricks] step_training (resume) called");
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    if let Some(stdin) = state_guard.child_stdin.as_mut() {
        use std::io::Write;
        let command = serde_json::json!({"type": "resume"});
        let cmd_str = serde_json::to_string(&command).unwrap();
        eprintln!("[NeuroBricks] Sending to Python: {}", cmd_str);
        stdin
            .write_all(cmd_str.as_bytes())
            .map_err(|e| format!("Failed to send resume command: {}", e))?;
        stdin
            .write_all(b"\n")
            .map_err(|e| format!("Failed to send newline: {}", e))?;
        stdin
            .flush()
            .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        eprintln!("[NeuroBricks] Resume command sent successfully");
    } else {
        eprintln!("[NeuroBricks] step_training: no child_stdin available!");
        return Err("训练进程不可用（未启动或已结束）".to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn run_gradient_diagnosis() -> Result<String, String> {
    Err("梯度诊断功能尚未实现，将在后续版本中支持".to_string())
}

/// 在多个已知位置搜索模型权重文件（同 export.rs 逻辑）
fn resolve_model_path(model_path: &str) -> Result<String, String> {
    // 如果前端传了具体路径且存在，直接用
    let direct = std::path::PathBuf::from(model_path);
    if direct.exists() {
        return Ok(direct.to_string_lossy().to_string());
    }

    // 展开 ~ 为用户目录
    let expanded = if model_path.starts_with("~/") || model_path.starts_with("~\\") {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_default();
        format!("{}{}", home, &model_path[1..])
    } else {
        model_path.to_string()
    };
    let expanded_pb = std::path::PathBuf::from(&expanded);
    if expanded_pb.exists() {
        return Ok(expanded_pb.to_string_lossy().to_string());
    }

    // 多路径搜索（同 export_model_weights）
    let home_dir = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    let candidates = [
        std::path::PathBuf::from(&home_dir).join(".neurobricks").join("model_weights.pth"),
        std::path::PathBuf::from("src-tauri/sidecars/nb-trainer/model_weights.pth"),
        std::path::PathBuf::from("sidecars/nb-trainer/model_weights.pth"),
        std::path::PathBuf::from("model_weights.pth"),
    ];
    for c in &candidates {
        if c.exists() {
            return Ok(c.to_string_lossy().to_string());
        }
    }

    Err("未找到模型权重文件，请先完成一次训练".to_string())
}

#[tauri::command]
pub fn predict_image(
    app: AppHandle,
    model_path: String,
    image_path: String,
    layers: serde_json::Value,
    input_shape: Vec<u32>,
) -> Result<String, String> {
    // 解析模型权重路径（多位置搜索）
    let resolved_model = resolve_model_path(&model_path)?;

    // 构建 config JSON
    let config = serde_json::json!({
        "modelPath": resolved_model,
        "imagePath": image_path,
        "layers": layers,
        "inputShape": input_shape,
    });
    let config_str = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    // 查找 sidecar 目录
    let sidecar_path = app
        .path_resolver()
        .resolve_resource("sidecars/nb-trainer")
        .or_else(|| {
            std::env::current_exe().ok().and_then(|exe| {
                exe.parent().map(|p| {
                    let mut path = p.to_path_buf();
                    if path.ends_with("debug") || path.ends_with("release") {
                        path.pop();
                        path.pop();
                    }
                    path.join("sidecars").join("nb-trainer")
                })
            })
        })
        .ok_or("找不到 sidecar 目录")?;

    // 查找 Python
    let python_path = std::env::var("PYTHON").unwrap_or_else(|_| "python".to_string());
    let script_path = sidecar_path.join("predict.py");

    if !script_path.exists() {
        return Err(format!("predict.py 不存在: {:?}", script_path));
    }

    // 执行 Python 脚本
    let output = Command::new(&python_path)
        .arg(&script_path)
        .arg(&config_str)
        .current_dir(&sidecar_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("启动推理进程失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !stderr.is_empty() {
        eprintln!("[Predict stderr] {}", stderr);
    }

    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(format!("推理无输出。stderr: {}", stderr));
    }

    // 验证 stdout 是合法 JSON（修正：不能用 parse::<String>，那要求 JSON 引号字符串）
    serde_json::from_str::<serde_json::Value>(trimmed)
        .map_err(|e| format!("解析推理结果失败: {} | stdout: {}", e, trimmed))?;

    Ok(trimmed.to_string())
}
