use serde::{Deserialize, Serialize};
 use std::path::Path;
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DatasetInfo {
    pub name: String,
    pub dataset_type: String,
    pub sample_count: u32,
    pub class_count: u32,
    pub image_width: Option<u32>,
    pub image_height: Option<u32>,
    pub channels: Option<u32>,
    pub columns: Option<Vec<String>>,
    pub preview_rows: Option<Vec<serde_json::Value>>,
}

#[tauri::command]
pub fn import_local_images(dir_path: String) -> Result<DatasetInfo, String> {
    let root = Path::new(&dir_path);
    if !root.is_dir() {
        return Err("Not a directory".to_string());
    }
    
    let dataset_name = root.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    
    let image_extensions = ["jpg", "jpeg", "png", "bmp", "webp", "gif"];
    let mut classes: HashMap<String, u32> = HashMap::new();
    let mut first_image_path: Option<std::path::PathBuf> = None;
    let mut total_count: u32 = 0;
    
    // 遍历子文件夹
    for entry in std::fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if path.is_dir() {
            let class_name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            
            let mut count: u32 = 0;
            for img_entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
                let img_entry = img_entry.map_err(|e| e.to_string())?;
                let img_path = img_entry.path();
                let ext = img_path.extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                
                if image_extensions.contains(&ext.as_str()) {
                    if first_image_path.is_none() {
                        first_image_path = Some(img_path);
                    }
                    count += 1;
                }
            }
            
            if count > 0 {
                classes.insert(class_name, count);
                total_count += count;
            }
        }
    }
    
    // 如果没有子文件夹，直接在根目录扫描
    if classes.is_empty() {
        let mut count: u32 = 0;
        for entry in std::fs::read_dir(root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let ext = path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            
            if image_extensions.contains(&ext.as_str()) {
                if first_image_path.is_none() {
                    first_image_path = Some(path);
                }
                count += 1;
            }
        }
        if count > 0 {
            classes.insert("default".to_string(), count);
            total_count = count;
        }
    }
    
    // 尝试读取第一张图片获取尺寸与真实通道数
    let (width, height, channels) = if let Some(img_path) = first_image_path {
        match image::image_dimensions(&img_path) {
            Ok((w, h)) => {
                // 解码首图获取真实颜色类型（按扩展名猜测不可靠：PNG 可能是灰度或 RGBA）。
                // 统一映射为训练端支持的两种通道模式：
                // 灰度（含带 alpha 的灰度）→ 1；彩色（RGB/RGBA 等）→ 3
                // （torchvision ImageFolder 默认将彩色图转为 RGB，即 3 通道）
                let ch = match image::open(&img_path) {
                    Ok(img) => match img.color() {
                        image::ColorType::L8
                        | image::ColorType::L16
                        | image::ColorType::La8
                        | image::ColorType::La16 => 1u32,
                        _ => 3u32,
                    },
                    // 解码失败时按彩色 3 通道兜底（训练端 ToTensor 默认输出 3 通道）
                    Err(_) => 3u32,
                };
                (Some(w), Some(h), Some(ch))
            },
            Err(_) => (None, None, None),
        }
    } else {
        (None, None, None)
    };
    
    Ok(DatasetInfo {
        name: dataset_name,
        dataset_type: "local_image".to_string(),
        sample_count: total_count,
        class_count: classes.len() as u32,
        image_width: width,
        image_height: height,
        channels,
        columns: Some(classes.keys().cloned().collect()),
        preview_rows: Some(classes.into_iter().map(|(k, v)| serde_json::json!({"class": k, "count": v})).collect()),
    })
}

#[tauri::command]
pub fn import_csv(file_path: String) -> Result<DatasetInfo, String> {
    let path = Path::new(&file_path);
    let name = path.file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut reader = csv::Reader::from_reader(file);
    
    // 获取列名
    let headers = reader.headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|h| h.to_string())
        .collect::<Vec<String>>();
    
    let column_count = headers.len();
    
    // 读取数据行
    let mut preview_rows: Vec<serde_json::Value> = Vec::new();
    let mut total_count: u32 = 0;
    
    for result in reader.records() {
        let record = result.map_err(|e| e.to_string())?;
        total_count += 1;
        
        if preview_rows.len() < 5 {
            let mut row = serde_json::Map::new();
            for (i, field) in record.iter().enumerate() {
                if i < column_count {
                    row.insert(headers[i].clone(), serde_json::Value::String(field.to_string()));
                }
            }
            preview_rows.push(serde_json::Value::Object(row));
        }
    }
    
    // 检测标签列：取最后一列
    let _suggested_label = if column_count > 0 {
        Some(headers[column_count - 1].clone())
    } else {
        None
    };

    let class_count = 10; // 简化，实际应统计标签列唯一值数
    
    Ok(DatasetInfo {
        name,
        dataset_type: "csv".to_string(),
        sample_count: total_count,
        class_count,
        image_width: None,
        image_height: None,
        channels: None,
        columns: Some(headers),
        preview_rows: Some(preview_rows),
    })
}

#[tauri::command]
pub fn import_excel(file_path: String) -> Result<DatasetInfo, String> {
    let path = Path::new(&file_path);
    let name = path.file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    
    // calamine 0.22.x: worksheet_range 返回 Option<Result<Range, Error>>
    use calamine::Reader;
    
    let mut workbook = calamine::open_workbook_auto(path)
        .map_err(|e| format!("{}", e))?;
    
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
        header_row.iter()
            .enumerate()
            .map(|(i, cell)| {
                match cell {
                    calamine::DataType::String(s) => s.clone(),
                    _ => format!("Column_{}", i + 1),
                }
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
    
    Ok(DatasetInfo {
        name,
        dataset_type: "excel".to_string(),
        sample_count: total_count,
        class_count: 10, // 简化
        image_width: None,
        image_height: None,
        channels: None,
        columns: Some(headers),
        preview_rows: Some(preview_rows),
    })
}
