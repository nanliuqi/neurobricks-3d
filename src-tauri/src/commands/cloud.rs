use serde::{Deserialize, Serialize};
use std::net::TcpStream;
use std::time::Duration;
use ssh2::Session;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SSHConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
    pub remote_work_dir: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloudResultFile {
    pub name: String,
    pub remote_path: String,
    pub local_path: Option<String>,
    pub size: u64,
    pub downloaded: bool,
}

#[tauri::command]
pub fn test_ssh_connection(config: SSHConfig) -> Result<(), String> {
    // 建立 TCP 连接
    let tcp = TcpStream::connect_timeout(
        &format!("{}:{}", config.host, config.port).parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_secs(10),
    ).map_err(|e| format!("连接失败: {}", e))?;
    
    tcp.set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| e.to_string())?;
    
    // 创建 SSH Session
    let mut session = Session::new().map_err(|e| e.to_string())?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|e| format!("SSH 握手失败: {}", e))?;
    
    // 认证
    match config.auth_type.as_str() {
        "password" => {
            let password = config.password.as_deref().unwrap_or("");
            session.userauth_password(&config.username, password)
                .map_err(|e| format!("密码认证失败: {}", e))?;
        }
        "private_key" => {
            let key_path = config.private_key_path.as_deref().unwrap_or("");
            let passphrase = config.passphrase.as_deref();
            session.userauth_pubkey_file(
                &config.username,
                None,
                std::path::Path::new(key_path),
                passphrase,
            ).map_err(|e| format!("私钥认证失败: {}", e))?;
        }
        _ => return Err(format!("未知认证方式: {}", config.auth_type)),
    }
    
    if !session.authenticated() {
        return Err("认证失败".to_string());
    }
    
    // 断开
    session.disconnect(None, "Test complete", None)
        .unwrap_or(());
    
    Ok(())
}

#[tauri::command]
pub fn submit_cloud_training(
    server_config: SSHConfig,
    train_config: crate::commands::training::TrainConfig,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // 生成任务 ID
    let task_id = uuid::Uuid::new_v4().to_string();
    
    // 建立 SSH 连接
    let tcp = TcpStream::connect_timeout(
        &format!("{}:{}", server_config.host, server_config.port).parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_secs(10),
    ).map_err(|e| format!("连接失败: {}", e))?;
    
    let mut session = Session::new().map_err(|e| e.to_string())?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|e| format!("SSH 握手失败: {}", e))?;
    
    // 认证
    authenticate_session(&session, &server_config)?;
    
    // 上传训练文件
    upload_training_files(&session, &server_config, &train_config)?;
    
    // 启动远程训练
    let pid = start_remote_training(&session, &server_config.remote_work_dir)?;
    
    // 断开连接
    session.disconnect(None, "Training submitted", None).unwrap_or(());
    
    // 通知前端
    let _ = app_handle.emit_all("cloud-training-started", serde_json::json!({
        "taskId": task_id,
        "pid": pid
    }));

    Ok(task_id)
}

#[tauri::command]
pub fn stop_cloud_training(
    server_config: SSHConfig,
    remote_pid: String,
) -> Result<(), String> {
    // 建立 SSH 连接
    let tcp = TcpStream::connect_timeout(
        &format!("{}:{}", server_config.host, server_config.port).parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_secs(10),
    ).map_err(|e| format!("连接失败: {}", e))?;
    
    let mut session = Session::new().map_err(|e| e.to_string())?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|e| format!("SSH 握手失败: {}", e))?;
    
    // 认证
    authenticate_session(&session, &server_config)?;
    
    // 停止远程进程
    let mut channel = session.channel_session().map_err(|e| e.to_string())?;
    let command = format!("kill {}", remote_pid);
    channel.exec(&command).map_err(|e| e.to_string())?;
    channel.wait_close().map_err(|e| e.to_string())?;
    
    session.disconnect(None, "Training stopped", None).unwrap_or(());
    
    Ok(())
}

#[tauri::command]
pub fn download_results(
    server_config: SSHConfig,
    remote_dir: String,
) -> Result<Vec<CloudResultFile>, String> {
    use std::path::PathBuf;
    
    // 建立 SSH 连接
    let tcp = TcpStream::connect_timeout(
        &format!("{}:{}", server_config.host, server_config.port).parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_secs(10),
    ).map_err(|e| format!("连接失败: {}", e))?;
    
    let mut session = Session::new().map_err(|e| e.to_string())?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|e| format!("SSH 握手失败: {}", e))?;
    
    // 认证
    authenticate_session(&session, &server_config)?;
    
    // 获取 SFTP
    let sftp = session.sftp().map_err(|e| e.to_string())?;
    
    // 列出远程文件
    let remote_path = std::path::Path::new(&remote_dir);
    let files = sftp.readdir(remote_path).map_err(|e| format!("读取目录失败: {}", e))?;
    
    // 创建本地下载目录
    let local_base = PathBuf::from("downloads").join(&server_config.id);
    std::fs::create_dir_all(&local_base).map_err(|e| e.to_string())?;
    
    // 下载文件
    let mut result_files = Vec::new();
    for (entry, _) in files {
        if let Some(name) = entry.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".pth") || name.ends_with(".log") || name.ends_with(".json") {
                let remote_file_path = remote_dir.clone() + "/" + name;
                let local_file_path = local_base.join(name);
                
                // 下载文件
                download_file(&sftp, &remote_file_path, &local_file_path)?;
                
                let file_size = std::fs::metadata(&local_file_path).map(|m| m.len()).unwrap_or(0);
                
                result_files.push(CloudResultFile {
                    name: name.to_string(),
                    remote_path: remote_file_path,
                    local_path: Some(local_file_path.to_string_lossy().to_string()),
                    size: file_size,
                    downloaded: true,
                });
            }
        }
    }
    
    session.disconnect(None, "Download complete", None).unwrap_or(());
    
    Ok(result_files)
}

// 辅助函数：认证 SSH 会话
fn authenticate_session(session: &Session, config: &SSHConfig) -> Result<(), String> {
    match config.auth_type.as_str() {
        "password" => {
            let password = config.password.as_deref().unwrap_or("");
            session.userauth_password(&config.username, password)
                .map_err(|e| format!("密码认证失败: {}", e))?;
        }
        "private_key" => {
            let key_path = config.private_key_path.as_deref().unwrap_or("");
            let passphrase = config.passphrase.as_deref();
            session.userauth_pubkey_file(
                &config.username,
                None,
                std::path::Path::new(key_path),
                passphrase,
            ).map_err(|e| format!("私钥认证失败: {}", e))?;
        }
        _ => return Err(format!("未知认证方式: {}", config.auth_type)),
    }
    
    if !session.authenticated() {
        return Err("认证失败".to_string());
    }
    
    Ok(())
}

// 辅助函数：上传单个文件
fn upload_file(sftp: &ssh2::Sftp, local_path: &str, remote_path: &str) -> Result<(), String> {
    let content = std::fs::read(local_path).map_err(|e| format!("读取文件失败: {}", e))?;
    upload_bytes(sftp, &content, remote_path)
}

// 辅助函数：上传字节数据
fn upload_bytes(sftp: &ssh2::Sftp, data: &[u8], remote_path: &str) -> Result<(), String> {
    use std::io::Write;
    
    let mut remote_file = sftp.create(std::path::Path::new(remote_path))
        .map_err(|e| format!("创建远程文件失败: {}", e))?;
    remote_file.write_all(data).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

// 辅助函数：下载单个文件
fn download_file(sftp: &ssh2::Sftp, remote_path: &str, local_path: &std::path::Path) -> Result<(), String> {
    use std::io::Read;
    
    let mut remote_file = sftp.open(std::path::Path::new(remote_path))
        .map_err(|e| format!("打开远程文件失败: {}", e))?;
    
    let mut content = Vec::new();
    remote_file.read_to_end(&mut content).map_err(|e| format!("读取文件失败: {}", e))?;
    
    std::fs::write(local_path, &content).map_err(|e| format!("写入本地文件失败: {}", e))?;
    
    Ok(())
}

// 辅助函数：上传训练文件
fn upload_training_files(
    session: &Session,
    config: &SSHConfig,
    train_config: &crate::commands::training::TrainConfig,
) -> Result<(), String> {
    let sftp = session.sftp().map_err(|e| e.to_string())?;
    let remote_dir = &config.remote_work_dir;
    
    // 创建远程目录
    sftp.mkdir(std::path::Path::new(remote_dir), 0o755).ok();
    
    // 上传 Python 文件
    let files = ["main.py", "models.py", "train.py", "requirements.txt"];
    for file in &files {
        let local_path = format!("sidecars/nb-trainer/{}", file);
        let remote_path = format!("{}/{}", remote_dir, file);
        upload_file(&sftp, &local_path, &remote_path)?;
    }
    
    // 上传训练配置
    let config_json = serde_json::to_string(train_config).map_err(|e| e.to_string())?;
    let remote_config_path = format!("{}/config.json", remote_dir);
    upload_bytes(&sftp, config_json.as_bytes(), &remote_config_path)?;
    
    Ok(())
}

// 辅助函数：启动远程训练
fn start_remote_training(session: &Session, remote_dir: &str) -> Result<String, String> {
    use std::io::Read;
    
    let mut channel = session.channel_session().map_err(|e| e.to_string())?;
    
    // 使用 nohup 后台运行
    let command = format!(
        "cd {} && pip install -q -r requirements.txt && nohup python main.py < config.json > train.log 2>&1 & echo $!",
        remote_dir
    );
    
    channel.exec(&command).map_err(|e| e.to_string())?;
    channel.wait_close().map_err(|e| e.to_string())?;
    
    // 读取 PID
    let mut pid = String::new();
    channel.read_to_string(&mut pid).map_err(|e| e.to_string())?;
    let pid = pid.trim().to_string();
    
    Ok(pid)
}

#[tauri::command]
pub fn poll_cloud_training(
    server_config: SSHConfig,
    remote_pid: String,
) -> Result<serde_json::Value, String> {
    use std::io::Read;
    
    // SSH 连接
    let tcp = TcpStream::connect_timeout(
        &format!("{}:{}", server_config.host, server_config.port).parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_secs(10),
    ).map_err(|e| format!("连接失败: {}", e))?;

    let mut session = Session::new().map_err(|e| e.to_string())?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|e| format!("SSH 握手失败: {}", e))?;
    authenticate_session(&session, &server_config)?;

    // 检查进程是否还在运行
    let mut channel = session.channel_session().map_err(|e| e.to_string())?;
    channel.exec(&format!("kill -0 {} 2>/dev/null && echo 'running' || echo 'stopped'", remote_pid))
        .map_err(|e| e.to_string())?;
    channel.wait_close().map_err(|e| e.to_string())?;
    let mut status_output = String::new();
    channel.read_to_string(&mut status_output).map_err(|e| e.to_string())?;
    let is_running = status_output.trim() == "running";

    // 读取日志最后几行
    let mut log_channel = session.channel_session().map_err(|e| e.to_string())?;
    log_channel.exec(&format!("tail -n 5 {}/train.log 2>/dev/null", server_config.remote_work_dir))
        .map_err(|e| e.to_string())?;
    log_channel.wait_close().map_err(|e| e.to_string())?;
    let mut log_output = String::new();
    log_channel.read_to_string(&mut log_output).map_err(|e| e.to_string())?;

    session.disconnect(None, "Poll done", None).unwrap_or(());

    // 解析日志中的 JSON 行
    let mut last_metrics = Vec::new();
    for line in log_output.lines() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            last_metrics.push(json);
        }
    }

    Ok(serde_json::json!({
        "status": if is_running { "running" } else { "completed" },
        "metrics": last_metrics,
    }))
}
