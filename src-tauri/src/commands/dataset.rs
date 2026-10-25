use image::ImageDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

const HASH_READ_BUFFER_SIZE: usize = 64 * 1024;
const MAX_DIRECTORY_DEPTH: usize = 64;
const LOCAL_IMAGE_PARENT_GROUP_FIELD: &str = "__image_parent_directory__";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MachineCheck {
    pub check: String,
    pub status: String,
    pub details: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageGroupInfo {
    pub field: String,
    pub label: String,
    pub distinct_count: u32,
    pub grouped_sample_count: u32,
    pub groups_per_class: BTreeMap<String, u32>,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub readiness_warning: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DatasetInfo {
    pub dataset_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub dataset_type: String,
    pub content_hash: String,
    pub imported_at: u64,
    pub sample_unit: String,
    pub sample_independence: String,
    pub sample_unit_declaration: Option<String>,
    pub machine_checks: Vec<MachineCheck>,
    pub sample_count: u32,
    pub class_count: u32,
    pub class_names: Option<Vec<String>>,
    pub image_width: Option<u32>,
    pub image_height: Option<u32>,
    pub channels: Option<u32>,
    pub image_group: Option<ImageGroupInfo>,
    pub columns: Option<Vec<String>>,
    /** 无法整体解释为有限数值的特征列；可作为 group/time 元数据，但不能直接进 MLP。 */
    pub non_numeric_columns: Option<Vec<String>>,
    pub preview_rows: Option<Vec<serde_json::Value>>,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let hex = digest
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    format!("sha256:{}", hex)
}

fn dataset_id_from_hash(content_hash: &str) -> String {
    let suffix = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);
    format!("dataset-{}", suffix.chars().take(24).collect::<String>())
}

fn imported_at_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn collect_image_files(
    directory: &Path,
    image_extensions: &[&str],
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    // 使用显式栈遍历，避免恶意或误建的深层目录通过递归耗尽线程栈。
    let mut pending_directories = vec![(directory.to_path_buf(), 0usize)];
    while let Some((current_directory, depth)) = pending_directories.pop() {
        let entries = std::fs::read_dir(&current_directory)
            .map_err(|error| format!("无法读取目录 {}：{}", current_directory.display(), error))?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                format!("读取目录项 {} 失败：{}", current_directory.display(), error)
            })?;
            let file_type = entry.file_type().map_err(|error| {
                format!("读取文件类型 {} 失败：{}", entry.path().display(), error)
            })?;
            let path = entry.path();
            if file_type.is_symlink() {
                return Err(format!("数据目录不允许符号链接：{}", path.display()));
            }
            if file_type.is_dir() {
                if depth >= MAX_DIRECTORY_DEPTH {
                    return Err(format!(
                        "数据目录嵌套超过 {} 层，请检查是否误选目录或存在循环链接：{}",
                        MAX_DIRECTORY_DEPTH,
                        path.display()
                    ));
                }
                pending_directories.push((path, depth + 1));
            } else if file_type.is_file() {
                let extension = path
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if image_extensions.contains(&extension.as_str()) {
                    files.push(path);
                }
            }
        }
    }
    Ok(())
}

fn inspect_image_metadata(path: &Path) -> Result<(u32, u32, u32), String> {
    // 只读取解码器元数据，不把整张图片展开到内存；超大图片也不会在导入阶段制造内存峰值。
    let reader = image::ImageReader::open(path)
        .and_then(|reader| reader.with_guessed_format())
        .map_err(|error| format!("无法读取首张图片 {}：{}", path.display(), error))?;
    let decoder = reader
        .into_decoder()
        .map_err(|error| format!("无法解析首张图片 {}：{}", path.display(), error))?;
    let (width, height) = decoder.dimensions();
    let channels = match decoder.color_type() {
        image::ColorType::L8
        | image::ColorType::L16
        | image::ColorType::La8
        | image::ColorType::La16 => 1,
        _ => 3,
    };
    Ok((width, height, channels))
}

fn inspect_image_groups(
    class_directories: &[(String, PathBuf, Vec<PathBuf>)],
    total_count: u32,
) -> ImageGroupInfo {
    let mut all_groups = HashSet::new();
    let mut groups_per_class = BTreeMap::new();
    let mut grouped_sample_count = 0u32;

    for (class_name, class_directory, images) in class_directories {
        let mut class_groups = HashSet::new();
        for image in images {
            let relative = image.strip_prefix(class_directory).unwrap_or(image);
            let components = relative.components().collect::<Vec<_>>();
            // 类别内直接文件为 [file]；只有 [group, ..., file] 才具备分组身份。
            if components.len() < 2 {
                continue;
            }
            let group = components[0].as_os_str().to_string_lossy().to_string();
            all_groups.insert(group.clone());
            class_groups.insert(group);
            grouped_sample_count = grouped_sample_count.saturating_add(1);
        }
        groups_per_class.insert(class_name.clone(), class_groups.len() as u32);
    }

    let distinct_count = all_groups.len() as u32;
    let unavailable_reason = if grouped_sample_count != total_count {
        Some(format!(
            "仅 {}/{} 个样本位于类别下的分组子目录；group 切分要求每个样本都有分组身份",
            grouped_sample_count, total_count
        ))
    } else if distinct_count < 3 {
        Some(format!(
            "只检测到 {} 个分组；训练/验证/封存测试三路隔离至少需要 3 个分组",
            distinct_count
        ))
    } else {
        None
    };
    let sparse_classes = groups_per_class
        .iter()
        .filter(|(_, count)| **count < 3)
        .map(|(class_name, count)| format!("{}={}组", class_name, count))
        .collect::<Vec<_>>();
    let readiness_warning = if unavailable_reason.is_none() && !sparse_classes.is_empty() {
        Some(format!(
            "三路分类划分要求每类至少覆盖 3 个独立组；当前 {}。训练前会阻断无法保证全类别覆盖的切分",
            sparse_classes.join("、")
        ))
    } else {
        None
    };

    ImageGroupInfo {
        field: LOCAL_IMAGE_PARENT_GROUP_FIELD.to_string(),
        label: "类别内第一级子目录".to_string(),
        distinct_count,
        grouped_sample_count,
        groups_per_class,
        available: unavailable_reason.is_none(),
        unavailable_reason,
        readiness_warning,
    }
}

/// 路径与文件字节共同参与身份；排序和长度前缀避免遍历顺序及拼接歧义。
fn sort_dataset_files(root: &Path, files: &mut [PathBuf]) {
    files.sort_by(|left, right| {
        left.strip_prefix(root)
            .unwrap_or(left)
            .to_string_lossy()
            .cmp(&right.strip_prefix(root).unwrap_or(right).to_string_lossy())
    });
}

fn hash_dataset_files(root: &Path, files: &mut [PathBuf]) -> Result<String, String> {
    sort_dataset_files(root, files);
    let mut hasher = Sha256::new();
    hasher.update(b"neurobricks-dataset-files-v1\0");
    // 必须在堆上分配。原 1 MiB 栈数组会耗尽 Windows/Tauri 命令线程栈，
    // 只要目录合法进入内容哈希阶段，就可能触发进程级 stack overflow。
    // 在文件循环外复用，避免大型数据集为每个样本重复分配缓冲区。
    let mut buffer = vec![0u8; HASH_READ_BUFFER_SIZE];
    for path in files {
        let relative = path.strip_prefix(root).unwrap_or(path);
        let relative_text = relative.to_string_lossy().replace('\\', "/");
        let path_bytes = relative_text.as_bytes();
        hasher.update((path_bytes.len() as u64).to_le_bytes());
        hasher.update(path_bytes);

        let mut file = std::fs::File::open(path.as_path())
            .map_err(|error| format!("无法读取数据文件 {}: {}", path.display(), error))?;
        let size = file.metadata().map_err(|error| error.to_string())?.len();
        hasher.update(size.to_le_bytes());
        loop {
            let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
    }
    let hex = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    Ok(format!("sha256:{}", hex))
}

#[tauri::command]
pub async fn import_local_images(dir_path: String) -> Result<DatasetInfo, String> {
    // 目录扫描、图片头解析和内容哈希均为阻塞 I/O，移出 UI 命令线程。
    tauri::async_runtime::spawn_blocking(move || import_local_images_blocking(&dir_path))
        .await
        .map_err(|error| format!("图像数据集导入任务异常终止：{}", error))?
}

fn import_local_images_blocking(dir_path: &str) -> Result<DatasetInfo, String> {
    let root = Path::new(dir_path);
    if !root.is_dir() {
        return Err("所选路径不是可读取的文件夹".to_string());
    }

    let dataset_name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let image_extensions = ["jpg", "jpeg", "png", "bmp", "webp", "gif"];
    let mut classes: HashMap<String, u32> = HashMap::new();
    let mut total_count: u32 = 0;
    let mut image_files: Vec<PathBuf> = Vec::new();
    let mut class_directories: Vec<(String, PathBuf, Vec<PathBuf>)> = Vec::new();

    // 遍历子文件夹
    for entry in std::fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            return Err(format!("数据目录不允许符号链接：{}", path.display()));
        }

        if file_type.is_dir() {
            let class_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            let mut class_images = Vec::new();
            collect_image_files(&path, &image_extensions, &mut class_images)?;
            let count = u32::try_from(class_images.len())
                .map_err(|_| format!("类别 {} 的图片数量超过支持范围", class_name))?;
            image_files.extend(class_images.iter().cloned());

            if count > 0 {
                classes.insert(class_name.clone(), count);
                class_directories.push((class_name, path.clone(), class_images));
                total_count = total_count
                    .checked_add(count)
                    .ok_or_else(|| "数据集图片总数超过支持范围".to_string())?;
            }
        }
    }

    // 如果没有子文件夹，直接在根目录扫描
    if classes.is_empty() {
        let mut count: u32 = 0;
        for entry in std::fs::read_dir(root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                return Err(format!("数据目录不允许符号链接：{}", path.display()));
            }
            if !file_type.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();

            if image_extensions.contains(&ext.as_str()) {
                image_files.push(path.clone());
                count += 1;
            }
        }
        if count > 0 {
            classes.insert("default".to_string(), count);
            total_count = count;
        }
    }

    if total_count == 0 {
        return Err("图像目录中没有支持的图片文件".to_string());
    }
    if classes.len() < 2 {
        return Err(
            "监督式图像分类至少需要 2 个类别子目录；请选择同时包含所有类别的上一级文件夹"
                .to_string(),
        );
    }

    // 分类结构通过后再读取首图，避免对本就不合法的单类别目录做无用解码。
    // 先按相对路径排序，避免 read_dir 的平台遍历顺序让通道数与尺寸结果漂移。
    sort_dataset_files(root, &mut image_files);
    let (width, height, channels) = image_files
        .first()
        .map(PathBuf::as_path)
        .ok_or_else(|| "图像目录中没有可读取的图片文件".to_string())
        .and_then(inspect_image_metadata)?;
    let content_hash = hash_dataset_files(root, &mut image_files)?;
    let image_group = inspect_image_groups(&class_directories, total_count);
    let mut class_names = classes.keys().cloned().collect::<Vec<_>>();
    class_names.sort();
    Ok(DatasetInfo {
        dataset_id: dataset_id_from_hash(&content_hash),
        name: dataset_name,
        dataset_type: "local_image".to_string(),
        content_hash,
        imported_at: imported_at_millis(),
        sample_unit: "image".to_string(),
        sample_independence: "iid_assumed".to_string(),
        sample_unit_declaration: None,
        machine_checks: vec![MachineCheck {
            check: "cross_split_exact_duplicate".to_string(),
            status: "not_run".to_string(),
            details: Some("将在确定切分成员后执行".to_string()),
        }],
        sample_count: total_count,
        class_count: classes.len() as u32,
        class_names: Some(class_names.clone()),
        image_width: Some(width),
        image_height: Some(height),
        channels: Some(channels),
        image_group: Some(image_group),
        columns: Some(class_names),
        non_numeric_columns: None,
        preview_rows: Some(
            classes
                .into_iter()
                .map(|(k, v)| serde_json::json!({"class": k, "count": v}))
                .collect(),
        ),
    })
}

#[cfg(test)]
mod dataset_identity_tests {
    use super::*;

    fn temporary_dataset_root(test_name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "neurobricks-{}-{}-{}",
            test_name,
            std::process::id(),
            unique
        ))
    }

    fn write_test_image(path: &Path) {
        let image = image::GrayImage::from_pixel(28, 28, image::Luma([128]));
        image.save(path).unwrap();
    }

    #[test]
    fn sha256_identity_is_stable_and_not_a_filename_hash() {
        assert_eq!(
            sha256_hex(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            dataset_id_from_hash(&sha256_hex(b"abc")),
            "dataset-ba7816bf8f01cfea414140de"
        );
    }

    #[test]
    fn nested_images_are_part_of_the_witnessed_dataset() {
        let root = temporary_dataset_root("dataset-identity");
        let nested = root.join("class-a").join("camera-1");
        std::fs::create_dir_all(&nested).unwrap();
        let image = nested.join("sample.png");
        std::fs::write(&image, b"not-decoded-for-identity-test").unwrap();

        let mut files = Vec::new();
        let result = collect_image_files(&root, &["png"], &mut files);
        let _ = std::fs::remove_dir_all(&root);

        assert!(result.is_ok());
        assert_eq!(files, vec![image]);
    }

    #[test]
    fn excessive_directory_depth_returns_an_error_instead_of_consuming_the_stack() {
        let root = temporary_dataset_root("deep-directory");
        let mut current = root.clone();
        for _ in 0..=MAX_DIRECTORY_DEPTH {
            current = current.join("d");
            std::fs::create_dir_all(&current).unwrap();
        }

        let mut files = Vec::new();
        let result = collect_image_files(&root, &["png"], &mut files);
        let _ = std::fs::remove_dir_all(&root);

        let error = match result {
            Ok(_) => panic!("超深目录不应扫描成功"),
            Err(error) => error,
        };
        assert!(error.contains("数据目录嵌套超过 64 层"));
    }

    #[test]
    fn imports_two_class_image_folder_without_using_the_command_thread_stack() {
        let root = temporary_dataset_root("two-class-import");
        let class_a = root.join("normal");
        let class_b = root.join("defect");
        std::fs::create_dir_all(&class_a).unwrap();
        std::fs::create_dir_all(&class_b).unwrap();
        write_test_image(&class_a.join("normal.png"));
        write_test_image(&class_b.join("defect.png"));

        let result = import_local_images_blocking(root.to_string_lossy().as_ref());
        let _ = std::fs::remove_dir_all(&root);
        let info = result.unwrap();

        assert_eq!(info.sample_count, 2);
        assert_eq!(info.class_count, 2);
        assert_eq!(
            info.class_names,
            Some(vec!["defect".to_string(), "normal".to_string()])
        );
        assert_eq!(info.image_width, Some(28));
        assert_eq!(info.image_height, Some(28));
        assert_eq!(info.channels, Some(1));
        assert!(info.content_hash.starts_with("sha256:"));
        let image_group = info.image_group.unwrap();
        assert!(!image_group.available);
        assert_eq!(image_group.grouped_sample_count, 0);
        assert!(image_group
            .unavailable_reason
            .unwrap()
            .contains("每个样本都有分组身份"));
    }

    #[test]
    fn keeps_top_level_classes_when_images_are_nested_by_capture_group() {
        let root = temporary_dataset_root("nested-import");
        let class_a = root.join("normal").join("camera-1");
        let class_b = root.join("defect").join("camera-4");
        std::fs::create_dir_all(&class_a).unwrap();
        std::fs::create_dir_all(&class_b).unwrap();
        write_test_image(&class_a.join("normal.png"));
        write_test_image(&class_b.join("defect.png"));

        let result = import_local_images_blocking(root.to_string_lossy().as_ref());
        let _ = std::fs::remove_dir_all(&root);
        let info = result.unwrap();

        assert_eq!(info.sample_count, 2);
        assert_eq!(
            info.class_names,
            Some(vec!["defect".to_string(), "normal".to_string()])
        );
        let image_group = info.image_group.unwrap();
        assert_eq!(image_group.distinct_count, 2);
        assert_eq!(image_group.grouped_sample_count, 2);
        assert!(!image_group.available);
        assert!(image_group
            .unavailable_reason
            .unwrap()
            .contains("至少需要 3 个分组"));
    }

    #[test]
    fn exposes_parent_directory_group_when_every_class_has_three_groups() {
        let root = temporary_dataset_root("group-capability");
        for class_name in ["normal", "defect"] {
            for group_name in ["camera-1", "camera-2", "camera-3"] {
                let directory = root.join(class_name).join(group_name);
                std::fs::create_dir_all(&directory).unwrap();
                write_test_image(&directory.join(format!("{}-{}.png", class_name, group_name)));
            }
        }

        let result = import_local_images_blocking(root.to_string_lossy().as_ref());
        let _ = std::fs::remove_dir_all(&root);
        let image_group = result.unwrap().image_group.unwrap();

        assert!(image_group.available);
        assert_eq!(image_group.field, LOCAL_IMAGE_PARENT_GROUP_FIELD);
        assert_eq!(image_group.distinct_count, 3);
        assert_eq!(image_group.grouped_sample_count, 6);
        assert_eq!(image_group.groups_per_class.get("normal"), Some(&3));
        assert_eq!(image_group.groups_per_class.get("defect"), Some(&3));
        assert!(image_group.readiness_warning.is_none());
    }

    #[test]
    fn malformed_first_image_returns_a_readable_error_instead_of_guessing_metadata() {
        let root = temporary_dataset_root("broken-image");
        let class_a = root.join("class-a");
        let class_b = root.join("class-b");
        std::fs::create_dir_all(&class_a).unwrap();
        std::fs::create_dir_all(&class_b).unwrap();
        std::fs::write(class_a.join("broken.png"), b"not-a-png").unwrap();
        write_test_image(&class_b.join("valid.png"));

        let result = import_local_images_blocking(root.to_string_lossy().as_ref());
        let _ = std::fs::remove_dir_all(&root);
        let error = match result {
            Ok(_) => panic!("损坏的首张图片不应导入成功"),
            Err(error) => error,
        };

        assert!(error.contains("无法解析首张图片"));
        assert!(!error.contains("undefined"));
    }

    #[test]
    fn selecting_one_class_directory_returns_an_actionable_error() {
        let root = temporary_dataset_root("single-class-import");
        std::fs::create_dir_all(&root).unwrap();
        write_test_image(&root.join("defect.png"));

        let result = import_local_images_blocking(root.to_string_lossy().as_ref());
        let _ = std::fs::remove_dir_all(&root);

        let error = match result {
            Ok(_) => panic!("单类别目录不应导入成功"),
            Err(error) => error,
        };
        assert_eq!(
            error,
            "监督式图像分类至少需要 2 个类别子目录；请选择同时包含所有类别的上一级文件夹"
        );
    }
}

#[tauri::command]
pub fn import_csv(file_path: String) -> Result<DatasetInfo, String> {
    let path = Path::new(&file_path);
    let name = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    // 读取全部字节并自动识别编码：
    // 中文 Windows 上 Excel 另存的 CSV 默认是 GBK/ANSI 编码，直接按 UTF-8 解析会失败，
    // 因此先尝试 UTF-8（含 BOM），非法时回退 GB18030（GBK 超集）解码
    let bytes = std::fs::read(path).map_err(|e| format!("无法读取文件: {}", e))?;
    if bytes.is_empty() {
        return Err("CSV 文件为空".to_string());
    }

    let content: String = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        // UTF-8 BOM：跳过 BOM 后按 UTF-8 解码
        String::from_utf8(bytes[3..].to_vec()).map_err(|e| format!("UTF-8 解码失败: {}", e))?
    } else {
        match String::from_utf8(bytes.clone()) {
            Ok(s) => s,
            Err(_) => {
                // 非合法 UTF-8 → 按 GB18030（兼容 GBK/GB2312）解码
                let (decoded, _enc, had_errors) = encoding_rs::GB18030.decode(&bytes);
                if had_errors {
                    return Err("无法识别文件编码（既非 UTF-8 也非 GBK），请用 Excel 另存为 UTF-8 的 CSV 后重试".to_string());
                }
                decoded.into_owned()
            }
        }
    };

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(content.as_bytes());

    // 获取列名
    let headers = reader
        .headers()
        .map_err(|e| format!("CSV 解析失败（表头）: {}", e))?
        .iter()
        .map(|h| h.to_string())
        .collect::<Vec<String>>();

    let column_count = headers.len();
    if column_count < 2 {
        return Err("CSV 至少需要 2 列（特征列 + 标签列）".to_string());
    }

    // 导入阶段只建立列画像，不猜测哪一列是目标。目标与特征由用户在前端显式确认，
    // 随后作为训练契约传给 sidecar；否则目标位于首列/中间列时会静默训练错误任务。
    let mut preview_rows: Vec<serde_json::Value> = Vec::new();
    let mut total_count: u32 = 0;
    let mut non_numeric_column_indices = HashSet::new();

    for result in reader.records() {
        let record =
            result.map_err(|e| format!("CSV 解析失败（第 {} 行）: {}", total_count + 2, e))?;
        total_count += 1;

        if record.len() != column_count {
            return Err(format!(
                "CSV 第 {} 行列数不一致：表头有 {} 列，当前行有 {} 列",
                total_count + 1,
                column_count,
                record.len()
            ));
        }

        // NaN/Infinity 无论最终扮演目标、特征还是元数据都没有安全的默认语义，立即拒绝；
        // 普通文本/日期则先画像，后续只能作为 group/time 或经外部编码后成为特征。
        for column_index in 0..column_count {
            let raw = record.get(column_index).unwrap_or("");
            match raw.parse::<f64>() {
                Ok(parsed) if !parsed.is_finite() => {
                    return Err(format!(
                        "CSV 列“{}”包含 NaN/Infinity，第 {} 行无效",
                        headers[column_index],
                        total_count + 1
                    ));
                }
                Ok(_) => {}
                Err(_) => {
                    non_numeric_column_indices.insert(column_index);
                }
            }
        }

        if preview_rows.len() < 5 {
            let mut row = serde_json::Map::new();
            for (i, field) in record.iter().enumerate() {
                if i < column_count {
                    row.insert(
                        headers[i].clone(),
                        serde_json::Value::String(field.to_string()),
                    );
                }
            }
            preview_rows.push(serde_json::Value::Object(row));
        }
    }

    if total_count == 0 {
        return Err("CSV 没有数据行（仅有表头）".to_string());
    }

    let content_hash = sha256_hex(&bytes);
    Ok(DatasetInfo {
        dataset_id: dataset_id_from_hash(&content_hash),
        name,
        dataset_type: "csv".to_string(),
        content_hash,
        imported_at: imported_at_millis(),
        sample_unit: "row".to_string(),
        sample_independence: "iid_assumed".to_string(),
        sample_unit_declaration: None,
        machine_checks: vec![MachineCheck {
            check: "cross_split_exact_duplicate".to_string(),
            status: "not_run".to_string(),
            details: Some("将在确定切分成员后执行".to_string()),
        }],
        sample_count: total_count,
        class_count: 0,
        class_names: None,
        image_width: None,
        image_height: None,
        channels: None,
        image_group: None,
        columns: Some(headers.clone()),
        non_numeric_columns: Some(
            (0..column_count)
                .filter(|index| non_numeric_column_indices.contains(index))
                .map(|index| headers[index].clone())
                .collect(),
        ),
        preview_rows: Some(preview_rows),
    })
}

#[cfg(test)]
mod csv_import_tests {
    use super::*;

    fn temporary_csv_path(test_name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "neurobricks-{}-{}-{}.csv",
            test_name,
            std::process::id(),
            unique
        ))
    }

    #[test]
    fn numeric_regression_csv_import_stays_supported() {
        let path = temporary_csv_path("numeric-regression");
        std::fs::write(&path, b"feature_a,feature_b,target\n1,2,3.5\n").unwrap();

        let result = import_csv(path.to_string_lossy().into_owned());
        let _ = std::fs::remove_file(&path);

        let dataset = result.expect("有限数值回归 CSV 应可导入");
        assert_eq!(dataset.dataset_type, "csv");
        assert_eq!(dataset.sample_count, 1);
        assert_eq!(dataset.class_count, 0);
        assert_eq!(
            dataset.columns,
            Some(vec![
                "feature_a".to_string(),
                "feature_b".to_string(),
                "target".to_string()
            ])
        );
    }

    #[test]
    fn last_column_is_not_silently_assigned_as_the_regression_target() {
        let path = temporary_csv_path("non-numeric-target");
        std::fs::write(&path, b"feature,target\n1,positive\n").unwrap();

        let result = import_csv(path.to_string_lossy().into_owned());
        let _ = std::fs::remove_file(&path);

        let dataset = result.expect("导入阶段只剖析列；目标字段必须在训练前由用户显式选择");
        assert_eq!(
            dataset.non_numeric_columns,
            Some(vec!["target".to_string()])
        );
    }

    #[test]
    fn non_finite_feature_returns_an_actionable_error() {
        let path = temporary_csv_path("infinite-feature");
        std::fs::write(&path, b"glucose,bmi,target\nInf,22.5,1.0\n").unwrap();

        let result = import_csv(path.to_string_lossy().into_owned());
        let _ = std::fs::remove_file(&path);

        assert_eq!(
            result.err().as_deref(),
            Some("CSV 列“glucose”包含 NaN/Infinity，第 2 行无效")
        );
    }

    #[test]
    fn textual_metadata_column_is_profiled_for_group_or_temporal_selection() {
        let path = temporary_csv_path("non-numeric-feature");
        std::fs::write(&path, b"city,income,target\nbeijing,12.5,1.0\n").unwrap();

        let result = import_csv(path.to_string_lossy().into_owned());
        let _ = std::fs::remove_file(&path);

        let dataset = result.expect("文本元数据列应允许导入，并在训练前要求排除或清洗");
        assert_eq!(dataset.non_numeric_columns, Some(vec!["city".to_string()]));
    }
}

#[tauri::command]
pub fn import_excel(file_path: String) -> Result<DatasetInfo, String> {
    let path = Path::new(&file_path);
    let name = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    // calamine 0.22.x: worksheet_range 返回 Option<Result<Range, Error>>
    use calamine::Reader;

    let mut workbook = calamine::open_workbook_auto(path).map_err(|e| format!("{}", e))?;

    // 获取工作表列表
    let sheets = workbook.sheet_names().to_vec();
    if sheets.is_empty() {
        return Err("No sheets in Excel file".to_string());
    }

    let first_sheet = sheets[0].clone();

    // 读取第一个工作表：worksheet_range 返回 Option<Result<Range, Error>>
    let range = match workbook.worksheet_range(&first_sheet) {
        Some(Ok(r)) => r,
        Some(Err(e)) => return Err(format!("Failed to read sheet '{}': {}", first_sheet, e)),
        None => return Err(format!("Sheet '{}' not found", first_sheet)),
    };

    let mut rows = range.rows();

    // 第一行作为列名
    let headers: Vec<String> = if let Some(header_row) = rows.next() {
        header_row
            .iter()
            .enumerate()
            .map(|(i, cell)| match cell {
                calamine::DataType::String(s) => s.clone(),
                _ => format!("Column_{}", i + 1),
            })
            .collect()
    } else {
        return Err("Empty Excel file".to_string());
    };

    let column_count = headers.len();
    let mut preview_rows: Vec<serde_json::Value> = Vec::new();
    let mut total_count: u32 = 0;

    for row in rows {
        total_count += 1;
        if preview_rows.len() < 5 {
            let mut row_map = serde_json::Map::new();
            for (i, cell) in row.iter().enumerate() {
                if i < column_count {
                    let value = match cell {
                        calamine::DataType::String(s) => serde_json::Value::String(s.clone()),
                        calamine::DataType::Float(f) => serde_json::json!(f),
                        calamine::DataType::Int(n) => serde_json::json!(n),
                        calamine::DataType::Bool(b) => serde_json::json!(b),
                        _ => serde_json::Value::String(cell.to_string()),
                    };
                    row_map.insert(headers[i].clone(), value);
                }
            }
            preview_rows.push(serde_json::Value::Object(row_map));
        }
    }

    let file_bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    let content_hash = sha256_hex(&file_bytes);
    Ok(DatasetInfo {
        dataset_id: dataset_id_from_hash(&content_hash),
        name,
        dataset_type: "excel".to_string(),
        content_hash,
        imported_at: imported_at_millis(),
        sample_unit: "row".to_string(),
        sample_independence: "iid_assumed".to_string(),
        sample_unit_declaration: None,
        machine_checks: vec![MachineCheck {
            check: "cross_split_exact_duplicate".to_string(),
            status: "not_run".to_string(),
            details: Some("Excel 不在当前可信训练边界内".to_string()),
        }],
        sample_count: total_count,
        class_count: 10, // 简化
        class_names: None,
        image_width: None,
        image_height: None,
        channels: None,
        image_group: None,
        columns: Some(headers),
        non_numeric_columns: None,
        preview_rows: Some(preview_rows),
    })
}
