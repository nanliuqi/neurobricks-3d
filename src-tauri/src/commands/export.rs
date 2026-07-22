#[tauri::command]
pub fn export_model_weights(path: String) -> Result<(), String> {
    // 在多个可能路径中查找训练产生的权重文件
    let home_dir = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法确定用户目录".to_string())?;
    let user_weights = std::path::PathBuf::from(&home_dir)
        .join(".neurobricks")
        .join("model_weights.pth");

    let possible_paths = [
        user_weights.to_string_lossy().to_string(),
        "src-tauri/sidecars/nb-trainer/model_weights.pth".to_string(),
        "sidecars/nb-trainer/model_weights.pth".to_string(),
        "model_weights.pth".to_string(),
    ];

    let mut source_path: Option<std::path::PathBuf> = None;
    for p in &possible_paths {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() {
            source_path = Some(pb);
            break;
        }
    }

    let source = source_path.ok_or("未找到训练权重文件，请先完成一次训练")?;

    std::fs::copy(&source, &path)
        .map_err(|e| format!("导出权重文件失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn export_full_model(path: String) -> Result<(), String> {
    let home_dir = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法确定用户目录".to_string())?;
    let user_model = std::path::PathBuf::from(&home_dir)
        .join(".neurobricks")
        .join("model_full.pt");

    let possible_paths = [
        user_model.to_string_lossy().to_string(),
        "src-tauri/sidecars/nb-trainer/model_full.pt".to_string(),
        "sidecars/nb-trainer/model_full.pt".to_string(),
        "model_full.pt".to_string(),
    ];

    let mut source_path: Option<std::path::PathBuf> = None;
    for p in &possible_paths {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() {
            source_path = Some(pb);
            break;
        }
    }

    let source = source_path.ok_or("未找到完整模型文件，请先完成一次训练")?;
    std::fs::copy(&source, &path).map_err(|e| format!("导出失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn export_numpy_weights(path: String) -> Result<(), String> {
    let home_dir = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法确定用户目录".to_string())?;
    let user_npz = std::path::PathBuf::from(&home_dir)
        .join(".neurobricks")
        .join("model_weights.npz");

    let possible_paths = [
        user_npz.to_string_lossy().to_string(),
        "src-tauri/sidecars/nb-trainer/model_weights.npz".to_string(),
        "sidecars/nb-trainer/model_weights.npz".to_string(),
        "model_weights.npz".to_string(),
    ];

    let mut source_path: Option<std::path::PathBuf> = None;
    for p in &possible_paths {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() {
            source_path = Some(pb);
            break;
        }
    }

    let source = source_path.ok_or("未找到 NumPy 权重文件，请先完成一次训练")?;
    std::fs::copy(&source, &path).map_err(|e| format!("导出失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn save_project(data: String, path: String) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_project(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

