use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri::Manager;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows GUI 程序 spawn 控制台子进程时必须加此标志，否则会弹出黑色 cmd 窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
    /// 模型唯一标识：Python 端据此将权重另存到 ~/.neurobricks/models/<model_id>.pth，
    /// 支持多模型卡片化推理（缺失时仅存默认 model_weights.pth）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
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
pub async fn start_training(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<TrainingState>>>,
    config: TrainConfig,
) -> Result<(), String> {
    // 训练进程启动涉及文件查找、进程 spawn 等操作，放入阻塞线程池避免占用主线程
    let state_inner = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        start_training_blocking(app, state_inner, config)
    })
    .await
    .map_err(|e| format!("训练任务调度失败: {}", e))?
}

fn start_training_blocking(
    app: AppHandle,
    state: Arc<Mutex<TrainingState>>,
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

    // 查找可执行文件：优先 sidecars/dist/nb-trainer/ 下打包好的 exe（生产环境，自包含 CPU-only torch，
    // 不依赖用户 Python 环境），回退 Python 解释器 + main.py（开发环境）
    let (program, args) = sidecar_path
        .parent()
        .map(|parent| parent.join("dist").join("nb-trainer"))
        .as_ref()
        .and_then(|dist_path| {
            eprintln!("[NeuroBricks] Trying dist path: {:?}", dist_path);
            find_trainer_exe(dist_path)
        })
        .or_else(|| find_trainer_exe(&sidecar_path))
        .ok_or_else(|| "训练模块未正确安装。请重新安装应用。".to_string())?;

    // 工作目录：优先 sidecar 源码目录（含 data/ 内置数据集），不存在时用 exe 所在目录
    let work_dir = if sidecar_path.exists() {
        sidecar_path.clone()
    } else {
        program.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| sidecar_path.clone())
    };

    // 启动训练进程
    eprintln!("[NeuroBricks] Starting trainer: {:?} {:?}", program, args);
    eprintln!("[NeuroBricks] Work dir: {:?}", work_dir);
    
    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .current_dir(&work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn()
        .map_err(|e| format!("训练进程启动失败 ({:?}): {}", program, e))?;
    
    let pid = child.id();
    eprintln!("[NeuroBricks] Python process started, PID: {:?}", pid);

    // 立即发送启动诊断信息到前端（确认事件系统工作 + 显示实际使用的路径）
    let _ = app.get_window("main").and_then(|w| {
        w.emit("training-progress", &serde_json::json!({
            "type": "log",
            "level": "info",
            "message": format!("训练进程已启动 (PID: {})\n程序: {}\n工作目录: {}", pid, program.display(), work_dir.display())
        })).ok()
    });

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

    // 在新线程中读取 stdout/stderr 并转发事件到前端
    let app_clone = app.clone();
    let state_clone = state.clone();

    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        use std::sync::atomic::{AtomicBool, Ordering};

        let mut state_guard = state_clone.lock().unwrap();
        let stdout = match state_guard.child_process.as_mut() {
            Some(child) => child.stdout.take(),
            None => return,
        };
        let stderr = state_guard.child_process.as_mut().and_then(|c| c.stderr.take());
        drop(state_guard);

        // 共享：stderr 内容缓冲 + 是否收到 done 标记 + 是否收到任何输出
        let stderr_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let got_done = Arc::new(AtomicBool::new(false));
        let got_any_output = Arc::new(AtomicBool::new(false));

        // 15秒启动超时检测：如果进程启动后15秒无任何输出，发送警告
        {
            let app_timeout = app_clone.clone();
            let output_flag = got_any_output.clone();
            let done_flag = got_done.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(15));
                if !output_flag.load(Ordering::SeqCst) && !done_flag.load(Ordering::SeqCst) {
                    let _ = app_timeout.get_window("main").and_then(|w| {
                        w.emit("training-progress", &serde_json::json!({
                            "type": "log",
                            "level": "warning",
                            "message": "训练进程启动已15秒但无任何输出，可能是训练模块未正确安装或Python环境缺少依赖"
                        })).ok()
                    });
                }
            });
        }

        // stderr 读取线程：收集内容并实时转发到前端（让用户立即看到错误）
        if let Some(stderr) = stderr {
            let app_err = app_clone.clone();
            let buf_clone = stderr_buf.clone();
            let output_flag = got_any_output.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line_str in reader.lines().map_while(Result::ok) {
                    output_flag.store(true, Ordering::SeqCst);
                    eprintln!("[Python stderr] {}", line_str);
                    // 保留最后 50 行
                    let mut buf = buf_clone.lock().unwrap();
                    if buf.len() >= 50 { buf.remove(0); }
                    buf.push(line_str.clone());
                    drop(buf);
                    // 实时转发到前端（作为 error 级别日志）
                    let _ = app_err.get_window("main").and_then(|w| {
                        w.emit("training-progress", &serde_json::json!({
                            "type": "log",
                            "level": "error",
                            "message": line_str
                        })).ok()
                    });
                }
            });
        }

        let stdout = stdout.unwrap();
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            match line {
                Ok(line_str) => {
                    got_any_output.store(true, Ordering::SeqCst);
                    if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(&line_str) {
                        if let Some(event_type) = json_value.get("type").and_then(|v| v.as_str()) {
                            match event_type {
                                "progress" | "epoch_end" => {
                                    let _ = app_clone.get_window("main").and_then(|w| w.emit("training-progress", &json_value).ok());
                                }
                                "done" => {
                                    got_done.store(true, Ordering::SeqCst);
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
        // 短暂等待让 stderr 线程收集完最后的输出
        std::thread::sleep(Duration::from_millis(500));

        let received_done = got_done.load(Ordering::SeqCst);

        if !received_done {
            // 未收到 done 消息 → 进程异常退出，将 stderr 内容作为错误信息发给前端
            let stderr_lines = stderr_buf.lock().unwrap();
            let err_msg = if stderr_lines.is_empty() {
                "训练进程异常退出（无错误输出），请检查网络结构和数据集配置".to_string()
            } else {
                // 取最后 10 行 stderr 作为错误摘要
                let start = stderr_lines.len().saturating_sub(10);
                format!("训练进程异常退出：\n{}", stderr_lines[start..].join("\n"))
            };
            let _ = app_clone.get_window("main").and_then(|w| {
                w.emit("training-error", &serde_json::json!({
                    "type": "error",
                    "message": err_msg
                })).ok()
            });
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

/// 打开独立训练曲线窗口。
/// 窗口在应用启动时已预创建（隐藏状态，见 tauri.conf.json 与 main.rs setup），
/// 此处只做 show + focus——绝不在 IPC 命令内运行时创建 WebView2 窗口
/// （那会在 Windows 上死锁主线程，导致白窗口 + 整个应用冻结）。
/// 曲线数据由主窗口写入 localStorage（同源共享），chart.html 轮询读取。
#[tauri::command]
pub fn open_chart_window(app: AppHandle) -> Result<(), String> {
    let w = app.get_window("chart-view").ok_or("曲线窗口不可用，请重启应用")?;
    w.show().map_err(|e| format!("打开曲线窗口失败: {}", e))?;
    w.set_focus().map_err(|e| format!("聚焦曲线窗口失败: {}", e))?;
    Ok(())
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
pub async fn predict_image(
    app: AppHandle,
    model_path: String,
    image_path: String,
    layers: serde_json::Value,
    input_shape: Vec<u32>,
) -> Result<String, String> {
    // 推理需要加载 torch + 模型（数秒至数十秒），放入阻塞线程池执行，避免冻结 UI 主线程
    tauri::async_runtime::spawn_blocking(move || {
        predict_image_blocking(app, model_path, image_path, layers, input_shape)
    })
    .await
    .map_err(|e| format!("推理任务调度失败: {}", e))?
}

fn predict_image_blocking(
    app: AppHandle,
    model_path: String,
    image_path: String,
    layers: serde_json::Value,
    input_shape: Vec<u32>,
) -> Result<String, String> {
    // 解析模型权重路径（多位置搜索）
    let resolved_model = resolve_model_path(&model_path)?;

    // 构建 predict 配置（添加 mode 字段区分训练/推理）
    let config = serde_json::json!({
        "mode": "predict",
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

    // 查找 nb-trainer 可执行文件（优先 dist/ 下打包好的 exe，回退 Python + main.py）
    let (program, args) = sidecar_path
        .parent()
        .map(|parent| parent.join("dist").join("nb-trainer"))
        .as_ref()
        .and_then(|dist_path| find_trainer_exe(dist_path))
        .or_else(|| find_trainer_exe(&sidecar_path))
        .ok_or_else(|| "推理模块未正确安装。请重新安装应用。".to_string())?;

    // 工作目录：优先 sidecar 源码目录，不存在时用 exe 所在目录
    let work_dir = if sidecar_path.exists() {
        sidecar_path.clone()
    } else {
        program.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| sidecar_path.clone())
    };

    // 通过 stdin 传入配置（同训练方式），读取 stdout 结果
    let mut cmd = Command::new(program);
    cmd.args(&args)
        .current_dir(&work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn()
        .map_err(|e| format!("无法启动推理进程: {}", e))?;

    // 写入配置到 stdin
    {
        let stdin = child.stdin.as_mut().ok_or("无法获取 stdin")?;
        use std::io::Write;
        stdin.write_all(config_str.as_bytes()).map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
    }

    // 等待进程结束，读取 stdout
    let output = child.wait_with_output().map_err(|e| format!("等待推理进程失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !stderr.is_empty() {
        eprintln!("[Predict stderr] {}", stderr);
    }

    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(format!("推理无输出。stderr: {}", stderr));
    }

    // 验证 stdout 是合法 JSON
    serde_json::from_str::<serde_json::Value>(trimmed)
        .map_err(|e| format!("解析推理结果失败: {} | stdout: {}", e, trimmed))?;

    Ok(trimmed.to_string())
}
