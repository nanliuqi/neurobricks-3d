use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::io::Write;
use std::io::{BufRead, BufReader};
use std::sync::Mutex;
use tauri::AppHandle;

static LEDGER_WRITE_LOCK: Mutex<()> = Mutex::new(());
const MAX_EVENT_BYTES: usize = 256 * 1024;

fn ledger_file_name(ledger_id: &str) -> Result<String, String> {
    if ledger_id.is_empty()
        || ledger_id.len() > 128
        || !ledger_id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
    {
        return Err("ledgerId 格式无效".to_string());
    }
    // 文件名只使用固定前缀和 ledgerId 哈希，既隔离不同浏览器/安装状态的序列，
    // 又不让来自 WebView localStorage 的标识参与路径解析。
    let identity_hash = format!("{:x}", Sha256::digest(ledger_id.as_bytes()));
    Ok(format!("experiment-events-v1-{}.jsonl", identity_hash))
}

fn ledger_path(app: &AppHandle, ledger_id: &str) -> Result<std::path::PathBuf, String> {
    let file_name = ledger_file_name(ledger_id)?;
    let data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "无法解析应用数据目录".to_string())?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("创建 ledger 目录失败: {}", error))?;
    Ok(data_dir.join(file_name))
}

fn required_string<'a>(
    event: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a str, String> {
    event
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 256)
        .ok_or_else(|| format!("ledger event {} 无效", key))
}

fn validate_event(event: &Value) -> Result<(u64, String), String> {
    let object = event
        .as_object()
        .ok_or_else(|| "ledger event 必须是对象".to_string())?;
    if object.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
        return Err("拒绝未知 ledger protocolVersion".to_string());
    }
    let event_id = required_string(object, "eventId")?.to_string();
    let entity_type = required_string(object, "entityType")?;
    if !matches!(
        entity_type,
        "dataset" | "study" | "experiment" | "attempt" | "claim"
    ) {
        return Err("ledger event entityType 无效".to_string());
    }
    required_string(object, "entityId")?;
    required_string(object, "eventType")?;
    let sequence = object.get("sequence").and_then(Value::as_u64).unwrap_or(0);
    if sequence == 0 {
        return Err("ledger event sequence 无效".to_string());
    }
    if object
        .get("occurredAt")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        == 0
    {
        return Err("ledger event occurredAt 无效".to_string());
    }
    if !object.get("payload").map(Value::is_object).unwrap_or(false) {
        return Err("ledger event payload 必须是对象".to_string());
    }
    Ok((sequence, event_id))
}

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonical_json).collect()),
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut canonical = serde_json::Map::new();
            for key in keys {
                canonical.insert(key.clone(), canonical_json(&object[key]));
            }
            Value::Object(canonical)
        }
        _ => value.clone(),
    }
}

/// 将已经由前端状态机产生的事件追加到应用数据目录。
/// 这是 provenance 审计轨迹，不是密码学防篡改：本机所有者仍可编辑文件。
#[tauri::command]
pub fn append_experiment_ledger_event(
    app: AppHandle,
    ledger_id: String,
    event: Value,
) -> Result<(), String> {
    let (sequence, event_id) = validate_event(&event)?;

    let serialized = serde_json::to_vec(&event).map_err(|error| error.to_string())?;
    if serialized.len() > MAX_EVENT_BYTES {
        return Err("单条 ledger event 超过 256 KiB 限制".to_string());
    }
    let path = ledger_path(&app, &ledger_id)?;
    let _guard = LEDGER_WRITE_LOCK
        .lock()
        .map_err(|_| "ledger 写锁已损坏".to_string())?;
    if path.exists() {
        let file =
            std::fs::File::open(&path).map_err(|error| format!("读取 ledger 失败: {}", error))?;
        let mut last_event: Option<(u64, String)> = None;
        for line in BufReader::new(file).lines() {
            let line = line.map_err(|error| format!("读取 ledger 失败: {}", error))?;
            if line.trim().is_empty() {
                continue;
            }
            let value: Value = serde_json::from_str(&line)
                .map_err(|_| "ledger 尾部前存在损坏 JSONL 记录".to_string())?;
            last_event = Some(validate_event(&value)?);
        }
        if let Some((last_sequence, last_event_id)) = last_event {
            if last_sequence == sequence && last_event_id == event_id {
                return Ok(());
            }
            if sequence != last_sequence + 1 {
                return Err(format!(
                    "拒绝非连续 ledger append：期望 {}，实际 {}",
                    last_sequence + 1,
                    sequence
                ));
            }
        } else if sequence != 1 {
            return Err(format!(
                "空 ledger 的首条 sequence 必须为 1，实际 {}",
                sequence
            ));
        }
    } else if sequence != 1 {
        return Err(format!(
            "新 ledger 的首条 sequence 必须为 1，实际 {}",
            sequence
        ));
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("打开 ledger 失败: {}", error))?;
    file.write_all(&serialized)
        .map_err(|error| format!("写入 ledger 失败: {}", error))?;
    file.write_all(b"\n")
        .map_err(|error| format!("写入 ledger 换行失败: {}", error))?;
    file.sync_data()
        .map_err(|error| format!("同步 ledger 失败: {}", error))?;
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerAuditStatus {
    event_count: u64,
    last_event_id: Option<String>,
    content_hash: String,
}

fn audit_status_for_events(events: &[Value]) -> Result<LedgerAuditStatus, String> {
    let mut event_ids = HashSet::new();
    let mut content_hasher = Sha256::new();
    content_hasher.update(b"[");
    for (index, value) in events.iter().enumerate() {
        let (sequence, event_id) =
            validate_event(value).map_err(|error| format!("ledger 记录校验失败: {}", error))?;
        let expected_sequence = index as u64 + 1;
        if sequence != expected_sequence {
            return Err(format!(
                "ledger sequence 不连续：期望 {}，实际 {}",
                expected_sequence, sequence
            ));
        }
        if !event_ids.insert(event_id) {
            return Err("ledger 含重复 eventId".to_string());
        }
        if index > 0 {
            content_hasher.update(b",");
        }
        let canonical = serde_json::to_vec(&canonical_json(value))
            .map_err(|error| format!("ledger 规范化失败: {}", error))?;
        content_hasher.update(&canonical);
    }
    content_hasher.update(b"]");
    Ok(LedgerAuditStatus {
        event_count: events.len() as u64,
        last_event_id: events
            .last()
            .and_then(Value::as_object)
            .and_then(|event| event.get("eventId"))
            .and_then(Value::as_str)
            .map(str::to_string),
        content_hash: format!("sha256:{:x}", content_hasher.finalize()),
    })
}

/// 用 Rust 与磁盘验证完全相同的规范化规则计算前端事件快照。
/// 跨语言可信协议不能依赖 JS 与 serde_json 对浮点数等细节恰好序列化一致。
#[tauri::command]
pub fn hash_experiment_ledger_events(events: Vec<Value>) -> Result<LedgerAuditStatus, String> {
    let serialized_size = serde_json::to_vec(&events)
        .map_err(|error| format!("ledger 快照序列化失败: {}", error))?
        .len();
    if serialized_size > 512 * 1024 * 1024 {
        return Err("ledger 快照超过 512 MiB 安全校验限制".to_string());
    }
    audit_status_for_events(&events)
}

#[tauri::command]
pub fn verify_experiment_ledger(
    app: AppHandle,
    ledger_id: String,
) -> Result<LedgerAuditStatus, String> {
    let path = ledger_path(&app, &ledger_id)?;
    if !path.exists() {
        return Ok(LedgerAuditStatus {
            event_count: 0,
            last_event_id: None,
            content_hash: format!("sha256:{:x}", Sha256::digest(b"[]")),
        });
    }
    let metadata =
        std::fs::metadata(&path).map_err(|error| format!("读取 ledger 元数据失败: {}", error))?;
    if metadata.len() > 512 * 1024 * 1024 {
        return Err("ledger 超过 512 MiB 安全读取限制".to_string());
    }
    let file = std::fs::File::open(path).map_err(|error| format!("打开 ledger 失败: {}", error))?;
    let mut events = Vec::new();
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|error| format!("读取 ledger 失败: {}", error))?;
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > MAX_EVENT_BYTES {
            return Err("ledger 含超长事件，审计失败".to_string());
        }
        events
            .push(serde_json::from_str(&line).map_err(|_| "ledger 含损坏 JSONL 记录".to_string())?);
    }
    audit_status_for_events(&events)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversized_or_incomplete_events_before_touching_disk() {
        let missing = serde_json::json!({"protocolVersion": 1});
        let object = missing.as_object().unwrap();
        assert!(required_string(object, "eventId").is_err());

        let oversized = serde_json::json!({"payload": "x".repeat(MAX_EVENT_BYTES + 1)});
        assert!(serde_json::to_vec(&oversized).unwrap().len() > MAX_EVENT_BYTES);

        let invalid_entity = serde_json::json!({
            "protocolVersion": 1,
            "eventId": "event-1",
            "sequence": 1,
            "occurredAt": 1,
            "entityType": "owner",
            "entityId": "id-1",
            "eventType": "changed",
            "payload": {}
        });
        assert!(validate_event(&invalid_entity).is_err());

        let unordered = serde_json::json!({"z": 1, "a": {"y": 2, "b": 3}});
        assert_eq!(
            serde_json::to_string(&canonical_json(&unordered)).unwrap(),
            r#"{"a":{"b":3,"y":2},"z":1}"#,
        );

        assert_ne!(
            ledger_file_name("ledger-install-a").unwrap(),
            ledger_file_name("ledger-install-b").unwrap()
        );
        assert!(ledger_file_name("../escape").is_err());
    }

    #[test]
    fn hashes_frontend_snapshots_with_the_same_rules_as_disk_verification() {
        let events = vec![
            serde_json::json!({
                "protocolVersion": 1,
                "eventId": "event-1",
                "sequence": 1,
                "occurredAt": 1,
                "entityType": "claim",
                "entityId": "claim-1",
                "eventType": "claim_frozen",
                "payload": {"threshold": 0.95, "label": "缺陷召回"}
            }),
            serde_json::json!({
                "protocolVersion": 1,
                "eventId": "event-2",
                "sequence": 2,
                "occurredAt": 2,
                "entityType": "claim",
                "entityId": "claim-1",
                "eventType": "claim_unsealed",
                "payload": {"unsealSequence": 1}
            }),
        ];
        let status = audit_status_for_events(&events).unwrap();
        assert_eq!(status.event_count, 2);
        assert_eq!(status.last_event_id.as_deref(), Some("event-2"));
        assert!(status.content_hash.starts_with("sha256:"));
    }
}
