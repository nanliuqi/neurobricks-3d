use sha2::{Digest, Sha256};
use std::io::Read;

fn attempt_artifact_path(attempt_id: &str, file_name: &str) -> Result<std::path::PathBuf, String> {
    if attempt_id.is_empty()
        || attempt_id.len() > 128
        || !attempt_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
    {
        return Err("Attempt 标识无效，拒绝访问产物目录".to_string());
    }
    let home_dir = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法确定用户目录".to_string())?;
    Ok(std::path::PathBuf::from(&home_dir)
        .join(".neurobricks")
        .join("attempts")
        .join(attempt_id)
        .join(file_name))
}

fn copy_attempt_artifact(
    attempt_id: &str,
    file_name: &str,
    destination: &str,
) -> Result<(), String> {
    let source = attempt_artifact_path(attempt_id, file_name)?;
    if !source.is_file() {
        return Err(format!(
            "未找到 Attempt {} 的产物 {}",
            attempt_id, file_name
        ));
    }
    std::fs::copy(&source, destination)
        .map_err(|error| format!("导出 {} 失败: {}", file_name, error))?;
    Ok(())
}

fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("读取 {} 失败: {}", path.display(), error))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("读取 {} 失败: {}", path.display(), error))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

#[tauri::command]
pub fn export_model_weights(path: String, attempt_id: String) -> Result<(), String> {
    // 每个 Attempt 只读取自己的不可变目录，避免后来一次训练覆盖早期权重。
    copy_attempt_artifact(&attempt_id, "model_weights.pth", &path)
}

#[tauri::command]
pub fn export_full_model(path: String, attempt_id: String) -> Result<(), String> {
    copy_attempt_artifact(&attempt_id, "model_full.pt", &path)
}

#[tauri::command]
pub fn export_numpy_weights(path: String, attempt_id: String) -> Result<(), String> {
    copy_attempt_artifact(&attempt_id, "model_weights.npz", &path)
}

#[tauri::command]
pub fn save_project(data: String, path: String) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

/// 导出完整实验包（目录形式）：model.py / train.py / requirements.txt / README.md / results/metrics.csv
/// 前端生成全部文本内容，Rust 只负责落盘（与 save_project 同权限模型，路径来自系统目录选择对话框）
#[tauri::command]
pub fn export_experiment_package(
    dir_path: String,
    model_py: String,
    train_py: String,
    requirements_txt: String,
    readme_md: String,
    metrics_csv: Option<String>,
    manifest_json: Option<String>,
    attempt_id: Option<String>,
    preprocessing_json: Option<String>,
    verify_package_py: String,
) -> Result<(), String> {
    if model_py.len() > 5 * 1024 * 1024
        || train_py.len() > 5 * 1024 * 1024
        || requirements_txt.len() > 1024 * 1024
        || readme_md.len() > 5 * 1024 * 1024
        || metrics_csv.as_ref().map(|value| value.len()).unwrap_or(0) > 100 * 1024 * 1024
        || manifest_json.as_ref().map(|value| value.len()).unwrap_or(0) > 50 * 1024 * 1024
        || preprocessing_json
            .as_ref()
            .map(|value| value.len())
            .unwrap_or(0)
            > 5 * 1024 * 1024
        || verify_package_py.len() > 1024 * 1024
    {
        return Err("实验包内容超过安全大小限制".to_string());
    }
    let mut parsed_manifest = if let Some(manifest) = manifest_json.as_ref() {
        let parsed: serde_json::Value = serde_json::from_str(manifest)
            .map_err(|error| format!("manifest.json 无效: {}", error))?;
        if parsed
            .get("protocolVersion")
            .and_then(|value| value.as_u64())
            != Some(1)
            || parsed.get("manifestType").and_then(|value| value.as_str())
                != Some("neurobricks-experiment-package-v1")
        {
            return Err("拒绝未知实验 manifest 协议".to_string());
        }
        Some(parsed)
    } else {
        None
    };
    let base = std::path::PathBuf::from(&dir_path);
    if base.exists() {
        return Err("实验包目标目录已存在，拒绝静默覆盖".to_string());
    }
    std::fs::create_dir_all(&base).map_err(|e| format!("创建目录失败: {}", e))?;

    let files: Vec<(&str, &str)> = vec![
        ("model.py", &model_py),
        ("train.py", &train_py),
        ("requirements.txt", &requirements_txt),
        ("README.md", &readme_md),
        ("verify_package.py", &verify_package_py),
    ];
    for (name, content) in files {
        let path = base.join(name);
        std::fs::write(&path, content.as_bytes())
            .map_err(|e| format!("写入 {} 失败: {}", name, e))?;
    }

    let source_attempt_id = attempt_id
        .as_deref()
        .ok_or_else(|| "实验复现包必须绑定一个已完成的 Attempt".to_string())?;
    let preprocessing = preprocessing_json
        .as_deref()
        .ok_or_else(|| "Attempt 缺少冻结预处理协议，拒绝生成伪复现包".to_string())?;
    let parsed_preprocessing: serde_json::Value = serde_json::from_str(preprocessing)
        .map_err(|error| format!("preprocessing.json 无效: {}", error))?;
    if !parsed_preprocessing.is_object() {
        return Err("preprocessing.json 必须是对象".to_string());
    }
    let artifacts_dir = base.join("artifacts");
    std::fs::create_dir_all(&artifacts_dir)
        .map_err(|error| format!("创建 artifacts 目录失败: {}", error))?;
    let source_artifacts = parsed_manifest
        .as_ref()
        .and_then(|manifest| manifest.get("sourceRunArtifacts"));
    let expected_artifacts = [
        ("weights", "model_weights.pth"),
        ("fullModel", "model_full.pt"),
        ("numpy", "model_weights.npz"),
    ];
    for (flag, file_name) in expected_artifacts {
        let expected = source_artifacts
            .and_then(|value| value.get(flag))
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if expected {
            let source = attempt_artifact_path(source_attempt_id, file_name)?;
            if !source.is_file() {
                return Err(format!(
                    "manifest 声明 Attempt {} 存在 {}，但磁盘产物缺失",
                    source_attempt_id, file_name
                ));
            }
            std::fs::copy(&source, artifacts_dir.join(file_name))
                .map_err(|error| format!("复制 {} 失败: {}", file_name, error))?;
        }
    }
    if !artifacts_dir.join("model_weights.pth").is_file() {
        return Err("复现包缺少受控运行原始权重，已拒绝导出".to_string());
    }
    let encoded_preprocessing = serde_json::to_vec_pretty(&parsed_preprocessing)
        .map_err(|error| format!("序列化 preprocessing.json 失败: {}", error))?;
    std::fs::write(base.join("preprocessing.json"), encoded_preprocessing)
        .map_err(|error| format!("写入 preprocessing.json 失败: {}", error))?;

    if let Some(csv) = metrics_csv {
        let results_dir = base.join("results");
        std::fs::create_dir_all(&results_dir)
            .map_err(|e| format!("创建 results 目录失败: {}", e))?;
        std::fs::write(results_dir.join("metrics.csv"), csv.as_bytes())
            .map_err(|e| format!("写入 metrics.csv 失败: {}", e))?;
    }
    if let Some(manifest) = parsed_manifest.as_mut() {
        let exported_files = [
            ("model.py", "model_definition"),
            ("train.py", "training_entrypoint"),
            ("requirements.txt", "dependency_lock"),
            ("README.md", "human_report"),
            ("verify_package.py", "integrity_verifier"),
            ("results/metrics.csv", "completed_metrics"),
            ("preprocessing.json", "preprocessing_contract"),
            ("artifacts/model_weights.pth", "state_dict"),
            ("artifacts/model_full.pt", "full_model"),
            ("artifacts/model_weights.npz", "numpy_weights"),
        ]
        .iter()
        .filter_map(|(relative_path, role)| {
            let path = base.join(relative_path);
            if !path.is_file() {
                return None;
            }
            Some((relative_path, role, path))
        })
        .map(|(relative_path, role, path)| {
            let size = std::fs::metadata(&path)
                .map_err(|error| format!("读取 {} 元数据失败: {}", path.display(), error))?
                .len();
            Ok(serde_json::json!({
                "path": relative_path,
                "role": role,
                "sizeBytes": size,
                "sha256": sha256_file(&path)?,
                "sourceAttemptId": source_attempt_id,
            }))
        })
        .collect::<Result<Vec<serde_json::Value>, String>>()?;
        manifest["exportedArtifacts"] = serde_json::Value::Array(exported_files);
        let encoded = serde_json::to_vec_pretty(manifest)
            .map_err(|error| format!("序列化 manifest.json 失败: {}", error))?;
        std::fs::write(base.join("manifest.json"), encoded)
            .map_err(|error| format!("写入 manifest.json 失败: {}", error))?;
    }

    Ok(())
}

fn write_new_report_file(path: &std::path::Path, content: &[u8]) -> Result<(), String> {
    if path.exists() {
        return Err(format!("报告目标已存在，拒绝静默覆盖: {}", path.display()));
    }
    std::fs::write(path, content)
        .map_err(|error| format!("写入 {} 失败: {}", path.display(), error))
}

/// 导出 Study 级证据包。固定文件名 + 拒绝覆盖，避免路径输入影响包内结构。
#[tauri::command]
pub fn export_study_report(
    dir_path: String,
    readme_md: String,
    manifest_json: String,
    comparison_csv: String,
) -> Result<(), String> {
    if readme_md.len() > 5 * 1024 * 1024 || manifest_json.len() > 50 * 1024 * 1024 {
        return Err("Study 报告超过安全大小限制".to_string());
    }
    if comparison_csv.len() > 100 * 1024 * 1024 {
        return Err("comparison.csv 超过安全大小限制".to_string());
    }
    let manifest: serde_json::Value = serde_json::from_str(&manifest_json)
        .map_err(|error| format!("manifest.json 无效: {}", error))?;
    if manifest
        .get("protocolVersion")
        .and_then(|value| value.as_u64())
        != Some(1)
        || manifest
            .get("manifestType")
            .and_then(|value| value.as_str())
            != Some("neurobricks-study-report-v1")
    {
        return Err("拒绝未知 Study manifest 协议".to_string());
    }

    let base = std::path::PathBuf::from(dir_path);
    if base.exists() {
        return Err("Study 报告目录已存在，请选择新的导出名称".to_string());
    }
    std::fs::create_dir_all(&base).map_err(|error| format!("创建报告目录失败: {}", error))?;
    write_new_report_file(&base.join("README.md"), readme_md.as_bytes())?;
    write_new_report_file(&base.join("manifest.json"), manifest_json.as_bytes())?;
    let results = base.join("results");
    std::fs::create_dir_all(&results)
        .map_err(|error| format!("创建 results 目录失败: {}", error))?;
    write_new_report_file(&results.join("comparison.csv"), comparison_csv.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub fn load_project(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
