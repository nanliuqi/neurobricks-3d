use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri::Manager;

use super::trainer_runtime::resolve_training_runtime;

/// Windows GUI 程序 spawn 控制台子进程时必须加此标志，否则会弹出黑色 cmd 窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const RUNNING: u8 = 0;
const COMPLETED: u8 = 1;
const FAILED: u8 = 2;
const STOPPED: u8 = 3;

#[derive(Debug, PartialEq, Eq)]
enum CompletionDisposition {
    AcceptClean,
    AcceptWithCleanupWarning,
    RejectUnobservedExit,
}

fn completion_disposition(exit_observed: bool, exit_success: bool) -> CompletionDisposition {
    match (exit_observed, exit_success) {
        (true, true) => CompletionDisposition::AcceptClean,
        (true, false) => CompletionDisposition::AcceptWithCleanupWarning,
        (false, _) => CompletionDisposition::RejectUnobservedExit,
    }
}

fn sha256_artifact(path: &std::path::Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("读取训练产物 {} 失败: {}", path.display(), error))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("读取训练产物 {} 失败: {}", path.display(), error))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

/// 在 sidecar 宣告 done 后由宿主进程重新读取文件，避免仅凭生产者布尔值授予产物可信。
fn verify_done_artifacts(
    payload: &serde_json::Value,
    attempt_id: &str,
    model_id: Option<&str>,
) -> Result<bool, String> {
    let manifest = payload
        .get("artifactManifest")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "done 缺少 artifactManifest".to_string())?;
    let artifact_flags = payload
        .get("artifacts")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "done 缺少 artifacts 状态".to_string())?;
    let home_dir = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法确定用户目录以核验训练产物".to_string())?;
    let attempt_root = std::path::PathBuf::from(&home_dir)
        .join(".neurobricks")
        .join("attempts")
        .join(attempt_id)
        .canonicalize()
        .map_err(|error| format!("无法定位 Attempt 产物目录: {}", error))?;
    let model_alias = model_id.map(|value| {
        std::path::PathBuf::from(&home_dir)
            .join(".neurobricks")
            .join("models")
            .join(format!("{}.pth", value))
    });
    let mut verified_roles = std::collections::HashSet::new();

    for item in manifest {
        let object = item
            .as_object()
            .ok_or_else(|| "artifactManifest 条目必须是对象".to_string())?;
        let path_text = object
            .get("path")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "artifactManifest 条目缺少 path".to_string())?;
        let role = object
            .get("role")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "artifactManifest 条目缺少 role".to_string())?;
        let expected_size = object
            .get("sizeBytes")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| "artifactManifest 条目缺少 sizeBytes".to_string())?;
        let expected_hash = object
            .get("sha256")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "artifactManifest 条目缺少 sha256".to_string())?;
        let canonical = std::path::PathBuf::from(path_text)
            .canonicalize()
            .map_err(|error| format!("训练产物 {} 不可读取: {}", path_text, error))?;
        let allowed = canonical.starts_with(&attempt_root)
            || model_alias
                .as_ref()
                .and_then(|path| path.canonicalize().ok())
                .map(|path| path == canonical)
                .unwrap_or(false);
        if !allowed {
            return Err(format!("训练产物越出 Attempt 隔离目录: {}", path_text));
        }
        let actual_size = std::fs::metadata(&canonical)
            .map_err(|error| format!("读取训练产物元数据失败: {}", error))?
            .len();
        if actual_size != expected_size || sha256_artifact(&canonical)? != expected_hash {
            return Err(format!("训练产物身份校验失败: {}", path_text));
        }
        verified_roles.insert(role.to_string());
    }

    let all_flags = ["weights", "fullModel", "numpy", "perModel"]
        .iter()
        .all(|key| artifact_flags.get(*key).and_then(|value| value.as_bool()) == Some(true));
    let all_roles = [
        "state_dict",
        "full_model",
        "numpy_weights",
        "inference_state_dict",
    ]
    .iter()
    .all(|role| verified_roles.contains(*role));
    Ok(all_flags && all_roles)
}

/// 每个训练进程独享的控制状态。线程只持有自己的 Arc，绝不读取下一次训练的状态，
/// 从根源上避免“旧进程退出事件污染新训练”的竞态。
struct RunControl {
    run_id: String,
    last_activity: Mutex<Instant>,
    grace_until: Instant,
    terminal: AtomicU8,
}

impl RunControl {
    fn new(run_id: String) -> Self {
        Self {
            run_id,
            last_activity: Mutex::new(Instant::now()),
            grace_until: Instant::now() + Duration::from_secs(60),
            terminal: AtomicU8::new(RUNNING),
        }
    }

    fn touch(&self) {
        if let Ok(mut last) = self.last_activity.lock() {
            *last = Instant::now();
        }
    }

    fn is_stalled(&self) -> bool {
        if Instant::now() < self.grace_until {
            return false;
        }
        self.last_activity
            .lock()
            .map(|last| Instant::now().duration_since(*last) > Duration::from_secs(60))
            .unwrap_or(false)
    }

    fn claim_terminal(&self, terminal: u8) -> bool {
        self.terminal
            .compare_exchange(RUNNING, terminal, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    fn terminal(&self) -> u8 {
        self.terminal.load(Ordering::SeqCst)
    }

    fn restore_after_stop_failure(&self) {
        let _ =
            self.terminal
                .compare_exchange(STOPPED, RUNNING, Ordering::SeqCst, Ordering::SeqCst);
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LayerConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub layer_type: String,
    pub params: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationClaimConfig {
    pub claim_id: String,
    pub frozen_hash: String,
    pub model_weights_hash: String,
    pub test_set_hash: String,
    pub task_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_count: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrainConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evaluation_claim: Option<EvaluationClaimConfig>,
    /// 单次运行标识。前端用它拒绝上一进程迟到的事件。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    /// 业务执行标识。run_id 隔离进程事件，attempt_id 记录可追溯执行谱系。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restart_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub study_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub experiment_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset_content_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_policy_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preprocessing_policy_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preprocessing_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_strategy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature_fields: Option<Vec<String>>,
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
    /// SGD 动量（仅 optimizer=sgd 时生效，Python 端默认 0.9）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub momentum: Option<f64>,
    /// 学习率调度器：none / multistep / cosine（Python 端默认 none）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lr_scheduler: Option<String>,
    /// 随机种子：固定后同配置同结果（Python 端默认 42；null 表示不固定）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
    /// 验证集比例（受控训练必须 > 0；测试集只允许 eval-only 解封）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub val_split: Option<f64>,
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

fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn is_safe_protocol_hash(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'-' | b'_' | b'.'))
}

/// IPC 是不可信边界：HTML min/max 可被手改，且 Tauri 命令也可能被脚本直接调用。
/// 在 spawn Python 前拒绝无意义、发散或可造成路径穿越的配置。
fn validate_train_config(config: &TrainConfig) -> Result<(), String> {
    let mode = config.mode.as_deref().unwrap_or("train");
    if !matches!(mode, "train" | "evaluate_claim") {
        return Err(format!("不支持的运行 mode: {}", mode));
    }
    if mode == "evaluate_claim" {
        let claim = config
            .evaluation_claim
            .as_ref()
            .ok_or_else(|| "evaluate_claim 缺少冻结主张协议".to_string())?;
        for (field, value) in [
            ("claimId", claim.claim_id.as_str()),
            ("frozenHash", claim.frozen_hash.as_str()),
            ("modelWeightsHash", claim.model_weights_hash.as_str()),
            ("testSetHash", claim.test_set_hash.as_str()),
        ] {
            let valid = if field == "claimId" {
                is_safe_identifier(value)
            } else {
                is_safe_protocol_hash(value)
            };
            if !valid {
                return Err(format!("{} 格式无效", field));
            }
        }
        if !matches!(
            claim.task_type.as_str(),
            "image_classification" | "tabular_regression"
        ) {
            return Err("evaluationClaim.taskType 无效".to_string());
        }
        if claim.task_type == "image_classification"
            && !matches!(claim.class_count, Some(2..=100_000))
        {
            return Err("分类 evaluationClaim.classCount 必须在 2 到 100000 之间".to_string());
        }
        if config
            .model_id
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            return Err("evaluate_claim 缺少 modelId".to_string());
        }
        for (field, value) in [
            ("attemptId", config.attempt_id.as_deref()),
            ("datasetContentHash", config.dataset_content_hash.as_deref()),
            ("splitPolicyHash", config.split_policy_hash.as_deref()),
            (
                "preprocessingPolicyHash",
                config.preprocessing_policy_hash.as_deref(),
            ),
            ("splitHash", config.split_hash.as_deref()),
            ("preprocessingHash", config.preprocessing_hash.as_deref()),
            ("configHash", config.config_hash.as_deref()),
        ] {
            if value.map(str::trim).unwrap_or("").is_empty() {
                return Err(format!("evaluate_claim 缺少 {}", field));
            }
        }
    } else if config.evaluation_claim.is_some() {
        return Err("训练模式不接受 evaluationClaim".to_string());
    }
    if !(1..=50).contains(&config.epochs) {
        return Err("epochs 必须是 1 到 50 的整数".to_string());
    }
    if !(1..=512).contains(&config.batch_size) {
        return Err("batchSize 必须是 1 到 512 的整数".to_string());
    }
    if !config.learning_rate.is_finite()
        || config.learning_rate <= 0.0
        || config.learning_rate > 1.0
    {
        return Err("learningRate 必须在 (0, 1] 范围内".to_string());
    }
    if config.layers.is_empty() || config.layers.len() > 512 {
        return Err("网络层数量必须在 1 到 512 之间".to_string());
    }
    if !matches!(
        config.dataset.as_str(),
        "mnist" | "cifar10" | "local_image" | "csv"
    ) {
        return Err(format!("当前训练后端不支持数据集: {}", config.dataset));
    }
    if matches!(config.dataset.as_str(), "local_image" | "csv")
        && config
            .data_path
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
    {
        return Err("自定义数据集缺少 dataPath".to_string());
    }
    if config.dataset == "csv" {
        let target = config
            .target_field
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "CSV 训练必须显式指定 targetField".to_string())?;
        let features = config
            .feature_fields
            .as_ref()
            .filter(|values| !values.is_empty())
            .ok_or_else(|| "CSV 训练必须显式指定 featureFields".to_string())?;
        let mut unique = std::collections::HashSet::new();
        for feature in features {
            let trimmed = feature.trim();
            if trimmed.is_empty() || trimmed.len() > 1024 || !unique.insert(trimmed) {
                return Err("featureFields 包含空值、超长值或重复列".to_string());
            }
            if trimmed == target {
                return Err("targetField 不能同时出现在 featureFields 中".to_string());
            }
        }
        if config.group_field.as_deref() == Some(target)
            || config.time_field.as_deref() == Some(target)
        {
            return Err("targetField 不能同时作为 group/time 字段".to_string());
        }
    }
    if let Some(run_id) = config.run_id.as_deref() {
        if !is_safe_identifier(run_id) {
            return Err("runId 只能包含字母、数字、连字符和下划线，且不超过 128 字节".to_string());
        }
    }
    for (field, value) in [
        ("attemptId", config.attempt_id.as_deref()),
        ("parentAttemptId", config.parent_attempt_id.as_deref()),
        ("studyId", config.study_id.as_deref()),
        ("experimentId", config.experiment_id.as_deref()),
    ] {
        if let Some(value) = value {
            if !is_safe_identifier(value) {
                return Err(format!("{} 格式无效", field));
            }
        }
    }
    if config.restart_count.unwrap_or(0) > 10_000 {
        return Err("restartCount 超出允许范围".to_string());
    }
    if let Some(resume_type) = config.resume_type.as_deref() {
        if !matches!(resume_type, "fresh" | "full_state" | "weights_only") {
            return Err(format!("不支持的 resumeType: {}", resume_type));
        }
        if resume_type != "fresh" {
            return Err(
                "当前版本没有完整状态 checkpoint 见证能力；resumeType 只能为 fresh".to_string(),
            );
        }
    }
    if let Some(strategy) = config.split_strategy.as_deref() {
        if !matches!(strategy, "random" | "group" | "temporal" | "predefined") {
            return Err(format!("不支持的 splitStrategy: {}", strategy));
        }
        let compatible = match config.dataset.as_str() {
            "mnist" | "cifar10" => strategy == "predefined",
            "local_image" => matches!(strategy, "random" | "group"),
            "csv" => matches!(strategy, "random" | "group" | "temporal"),
            _ => false,
        };
        if !compatible {
            return Err(format!(
                "数据集 {} 不支持 splitStrategy={}，已拒绝执行语义与留档语义不一致的训练",
                config.dataset, strategy
            ));
        }
        if strategy == "group"
            && config
                .group_field
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
        {
            return Err("group 切分必须指定 groupField".to_string());
        }
        if strategy == "temporal"
            && config
                .time_field
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
        {
            return Err("temporal 切分必须指定 timeField".to_string());
        }
    }
    for (field, value) in [
        ("datasetContentHash", config.dataset_content_hash.as_deref()),
        ("splitPolicyHash", config.split_policy_hash.as_deref()),
        (
            "preprocessingPolicyHash",
            config.preprocessing_policy_hash.as_deref(),
        ),
        ("splitHash", config.split_hash.as_deref()),
        ("preprocessingHash", config.preprocessing_hash.as_deref()),
        ("configHash", config.config_hash.as_deref()),
    ] {
        if let Some(value) = value {
            if !is_safe_protocol_hash(value) {
                return Err(format!("{} 格式无效", field));
            }
        }
    }
    if let Some(model_id) = config.model_id.as_deref() {
        if !is_safe_identifier(model_id) {
            return Err("modelId 格式无效，已拒绝可能的路径穿越".to_string());
        }
    }
    if let Some(optimizer) = config.optimizer.as_deref() {
        if !matches!(optimizer, "adam" | "adamw" | "sgd") {
            return Err(format!("不支持的 optimizer: {}", optimizer));
        }
    }
    if let Some(scheduler) = config.lr_scheduler.as_deref() {
        if !matches!(scheduler, "none" | "multistep" | "cosine") {
            return Err(format!("不支持的 lrScheduler: {}", scheduler));
        }
    }
    if let Some(weight_decay) = config.weight_decay {
        if !weight_decay.is_finite() || !(0.0..=1.0).contains(&weight_decay) {
            return Err("weightDecay 必须在 [0, 1] 范围内".to_string());
        }
    }
    if let Some(momentum) = config.momentum {
        if !momentum.is_finite() || !(0.0..1.0).contains(&momentum) {
            return Err("momentum 必须在 [0, 1) 范围内".to_string());
        }
    }
    if let Some(val_split) = config.val_split {
        if !val_split.is_finite() || !(0.0..=0.5).contains(&val_split) {
            return Err("valSplit 必须在 [0, 0.5] 范围内".to_string());
        }
    }
    if mode == "train" && config.val_split.unwrap_or(0.0) <= 0.0 {
        return Err("受控训练必须设置 valSplit > 0；测试集只能通过冻结主张解封".to_string());
    }
    if let Some(train_ratio) = config.train_ratio {
        if !train_ratio.is_finite() || !(0.5..=0.9).contains(&train_ratio) {
            return Err("trainRatio 必须在 [0.5, 0.9] 范围内".to_string());
        }
    }
    if let Some(shape) = config.input_shape.as_deref() {
        if shape.len() != 3 || shape.iter().any(|dim| *dim == 0 || *dim > 16_384) {
            return Err("inputShape 必须是三个 1 到 16384 之间的正整数".to_string());
        }
    }
    if !matches!(config.device.as_str(), "cpu" | "cuda" | "cuda:0") {
        return Err("单机单卡模式的 device 只能是 cpu、cuda 或 cuda:0".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod train_config_validation_tests {
    use super::*;

    #[test]
    fn committed_result_survives_post_commit_cleanup_failure() {
        assert_eq!(
            completion_disposition(true, true),
            CompletionDisposition::AcceptClean
        );
        assert_eq!(
            completion_disposition(true, false),
            CompletionDisposition::AcceptWithCleanupWarning
        );
        assert_eq!(
            completion_disposition(false, false),
            CompletionDisposition::RejectUnobservedExit
        );
    }

    fn valid_config() -> TrainConfig {
        TrainConfig {
            mode: Some("train".to_string()),
            evaluation_claim: None,
            run_id: Some("run-123".to_string()),
            attempt_id: Some("attempt-123".to_string()),
            parent_attempt_id: None,
            restart_count: Some(0),
            resume_type: Some("fresh".to_string()),
            study_id: Some("study-123".to_string()),
            experiment_id: Some("experiment-123".to_string()),
            dataset_content_hash: Some("sha256:dataset".to_string()),
            split_policy_hash: Some("sha256:split-policy".to_string()),
            preprocessing_policy_hash: Some("sha256:preprocessing-policy".to_string()),
            split_hash: Some("sha256:split".to_string()),
            preprocessing_hash: Some("sha256:preprocessing".to_string()),
            config_hash: Some("sha256:config".to_string()),
            split_strategy: Some("predefined".to_string()),
            group_field: None,
            time_field: None,
            target_field: None,
            feature_fields: None,
            epochs: 1,
            learning_rate: 0.001,
            batch_size: 32,
            dataset: "mnist".to_string(),
            device: "cpu".to_string(),
            layers: vec![LayerConfig {
                id: Some("layer-input".to_string()),
                layer_type: "Input".to_string(),
                params: serde_json::Map::new(),
            }],
            optimizer: Some("adam".to_string()),
            weight_decay: Some(0.0),
            momentum: None,
            lr_scheduler: Some("none".to_string()),
            seed: Some(42),
            val_split: Some(0.5),
            data_path: None,
            train_ratio: Some(0.8),
            input_shape: Some(vec![1, 28, 28]),
            model_id: Some("model-123".to_string()),
        }
    }

    #[test]
    fn accepts_valid_boundary_values() {
        assert!(validate_train_config(&valid_config()).is_ok());
    }

    #[test]
    fn rejects_zero_epochs_and_unsupported_datasets() {
        let mut config = valid_config();
        config.epochs = 0;
        assert!(validate_train_config(&config).is_err());

        config.epochs = 1;
        config.dataset = "excel".to_string();
        assert!(validate_train_config(&config).is_err());
    }

    #[test]
    fn rejects_model_id_path_traversal() {
        let mut config = valid_config();
        config.model_id = Some("../outside".to_string());
        assert!(validate_train_config(&config).is_err());
    }

    #[test]
    fn rejects_devices_outside_the_single_gpu_contract() {
        let mut config = valid_config();
        config.device = "cuda:1".to_string();
        assert!(validate_train_config(&config).is_err());

        config.device = "cuda:0".to_string();
        assert!(validate_train_config(&config).is_ok());
    }

    #[test]
    fn rejects_invalid_attempt_lineage_and_protocol_hashes() {
        let mut config = valid_config();
        config.attempt_id = Some("../attempt".to_string());
        assert!(validate_train_config(&config).is_err());

        config.attempt_id = Some("attempt-123".to_string());
        config.resume_type = Some("magic".to_string());
        assert!(validate_train_config(&config).is_err());

        config.resume_type = Some("fresh".to_string());
        config.config_hash = Some("hash with spaces".to_string());
        assert!(validate_train_config(&config).is_err());

        config.config_hash = Some("sha256:config".to_string());
        config.resume_type = Some("full_state".to_string());
        assert!(validate_train_config(&config).is_err());
    }

    #[test]
    fn training_cannot_use_the_sealed_test_set_as_validation() {
        let mut config = valid_config();
        config.val_split = Some(0.0);
        assert!(validate_train_config(&config).is_err());
    }

    #[test]
    fn rejects_split_strategies_that_do_not_match_dataset_semantics() {
        let mut config = valid_config();
        config.split_strategy = Some("random".to_string());
        assert!(validate_train_config(&config).is_err());

        config.dataset = "local_image".to_string();
        config.data_path = Some("D:/dataset".to_string());
        config.split_strategy = Some("predefined".to_string());
        assert!(validate_train_config(&config).is_err());

        config.split_strategy = Some("group".to_string());
        config.group_field = Some("__image_parent_directory__".to_string());
        assert!(validate_train_config(&config).is_ok());

        config.dataset = "csv".to_string();
        config.split_strategy = Some("temporal".to_string());
        config.group_field = None;
        config.time_field = Some("captured_at".to_string());
        config.target_field = Some("target".to_string());
        config.feature_fields = Some(vec!["feature".to_string()]);
        assert!(validate_train_config(&config).is_ok());
    }

    #[test]
    fn claim_evaluation_requires_complete_frozen_identity() {
        let mut config = valid_config();
        config.mode = Some("evaluate_claim".to_string());
        config.val_split = Some(0.0);
        assert!(validate_train_config(&config).is_err());

        config.evaluation_claim = Some(EvaluationClaimConfig {
            claim_id: "claim-123".to_string(),
            frozen_hash: "sha256:frozen".to_string(),
            model_weights_hash: "sha256:weights".to_string(),
            test_set_hash: "sha256:test".to_string(),
            task_type: "image_classification".to_string(),
            class_count: Some(10),
        });
        assert!(validate_train_config(&config).is_ok());

        config.evaluation_claim.as_mut().unwrap().frozen_hash = "hash with spaces".to_string();
        assert!(validate_train_config(&config).is_err());
    }
}

/// 训练状态管理
pub struct TrainingState {
    child_process: Option<Child>,
    child_stdin: Option<ChildStdin>,
    active_run: Option<Arc<RunControl>>,
    /// 最近一次训练的完整配置 JSON（crashed 后“重新开始训练”按钮用同一 config 重启）
    last_train_config: Option<String>,
}

impl TrainingState {
    pub fn new() -> Self {
        Self {
            child_process: None,
            child_stdin: None,
            active_run: None,
            last_train_config: None,
        }
    }

    /// 应用退出专用：先标记本次运行停止，再移交子进程句柄给退出清理逻辑。
    pub fn take_child_for_shutdown(&mut self) -> Option<Child> {
        if let Some(run) = self.active_run.take() {
            run.claim_terminal(STOPPED);
        }
        self.child_stdin = None;
        self.child_process.take()
    }
}

fn payload_with_run_id(mut payload: serde_json::Value, run_id: &str) -> serde_json::Value {
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "runId".to_string(),
            serde_json::Value::String(run_id.to_string()),
        );
    }
    payload
}

fn emit_run_event(app: &AppHandle, event: &str, payload: serde_json::Value, run_id: &str) {
    let payload = payload_with_run_id(payload, run_id);
    let _ = app
        .get_window("main")
        .and_then(|window| window.emit(event, &payload).ok());
}

#[tauri::command]
pub async fn start_training(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<TrainingState>>>,
    config: TrainConfig,
) -> Result<(), String> {
    // 训练进程启动涉及文件查找、进程 spawn 等操作，放入阻塞线程池避免占用主线程
    let state_inner = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || start_training_blocking(app, state_inner, config))
        .await
        .map_err(|e| format!("训练任务调度失败: {}", e))?
}

fn start_training_blocking(
    app: AppHandle,
    state: Arc<Mutex<TrainingState>>,
    mut config: TrainConfig,
) -> Result<(), String> {
    validate_train_config(&config)?;
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    // 一次只允许一个训练。静默杀掉旧任务会让前端把两次运行混成一次，因此明确拒绝。
    if let Some(child) = state_guard.child_process.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                state_guard.child_process = None;
                state_guard.child_stdin = None;
                state_guard.active_run = None;
            }
            Ok(None) => return Err("已有训练任务正在运行，请先停止后再试".to_string()),
            Err(error) => return Err(format!("无法确认现有训练进程状态: {}", error)),
        }
    }

    let run_id = config
        .run_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    config.run_id = Some(run_id.clone());
    let run_control = Arc::new(RunControl::new(run_id.clone()));

    let requested_cuda = config.device == "cuda" || config.device.starts_with("cuda:");
    let (trainer, runtime_info) =
        resolve_training_runtime(&app, config.dataset == "csv", requested_cuda)?;
    if requested_cuda && !runtime_info.cuda_available {
        return Err(
            "所选 CUDA 设备已不可用。为避免 Attempt 留档与实际执行设备不一致，本次训练未启动；请重新检测运行时并选择 CPU 后重试。"
                .to_string(),
        );
    }
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    let trainer_source = trainer.source.clone();
    let program = trainer.program.clone();
    let args = trainer.args.clone();
    let work_dir = trainer.work_dir.clone();

    // 启动训练进程
    eprintln!(
        "[NeuroBricks] Starting trainer ({}) {:?} {:?}",
        trainer_source, program, args
    );
    eprintln!("[NeuroBricks] Work dir: {:?}", work_dir);

    let mut cmd = trainer.command();
    cmd.args(&args)
        .current_dir(&work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("训练进程启动失败 ({:?}): {}", program, e))?;

    let pid = child.id();
    eprintln!("[NeuroBricks] Python process started, PID: {:?}", pid);

    // 立即发送启动诊断信息到前端（确认事件系统工作 + 显示实际使用的路径）
    emit_run_event(
        &app,
        "training-progress",
        serde_json::json!({
            "type": "log",
            "level": "info",
            "message": format!(
                "训练进程已启动 (PID: {})\n运行时: {} · Python {} · PyTorch {}\n设备: {}",
                pid,
                trainer_source,
                runtime_info.python_version,
                runtime_info.torch_version,
                config.device,
            )
        }),
        &run_id,
    );
    // 在进程进入共享状态前完成所有管道初始化。任何一步失败都必须 kill + wait，不能留下孤儿进程。
    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("无法获取训练进程 stdin".to_string());
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("无法获取训练进程 stdout".to_string());
        }
    };
    let stderr = child.stderr.take();

    use std::io::Write;
    let write_result = stdin
        .write_all(config_json.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush());
    if let Err(error) = write_result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("写入训练配置失败: {}", error));
    }

    state_guard.child_stdin = Some(stdin);
    state_guard.active_run = Some(run_control.clone());
    state_guard.last_train_config = Some(config_json.clone());
    state_guard.child_process = Some(child);
    let expected_attempt_id = config.attempt_id.clone().unwrap_or_default();
    let expected_model_id = config.model_id.clone();
    drop(state_guard);

    // 在新线程中读取 stdout/stderr 并转发事件到前端
    let app_clone = app.clone();
    let state_clone = state.clone();

    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};

        // 共享：stderr 内容缓冲 + 是否收到 done 标记 + 是否收到任何输出
        let stderr_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let got_any_output = Arc::new(AtomicBool::new(false));

        // 15秒启动告警：只属于本次 run；终止后绝不再发送迟到日志。
        {
            let app_timeout = app_clone.clone();
            let output_flag = got_any_output.clone();
            let run_timeout = run_control.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(15));
                if !output_flag.load(Ordering::SeqCst) && run_timeout.terminal() == RUNNING {
                    emit_run_event(
                        &app_timeout,
                        "training-progress",
                        serde_json::json!({
                            "type": "log",
                            "level": "warning",
                            "message": "训练进程启动已15秒但无任何输出，可能是训练模块未正确安装或Python环境缺少依赖"
                        }),
                        &run_timeout.run_id,
                    );
                }
            });
        }

        // stderr 读取线程：收集内容并实时转发到前端（让用户立即看到错误）
        if let Some(stderr) = stderr {
            let app_err = app_clone.clone();
            let buf_clone = stderr_buf.clone();
            let output_flag = got_any_output.clone();
            let run_err = run_control.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line_str in reader.lines().map_while(Result::ok) {
                    output_flag.store(true, Ordering::SeqCst);
                    run_err.touch();
                    eprintln!("[Python stderr] {}", line_str);
                    // 保留最后 50 行
                    let mut buf = buf_clone.lock().unwrap();
                    if buf.len() >= 50 {
                        buf.remove(0);
                    }
                    buf.push(line_str.clone());
                    drop(buf);
                    // 实时转发到前端（作为 error 级别日志）
                    if run_err.terminal() == RUNNING {
                        emit_run_event(
                            &app_err,
                            "training-progress",
                            serde_json::json!({
                            "type": "log",
                            "level": "error",
                            "message": line_str
                            }),
                            &run_err.run_id,
                        );
                    }
                }
            });
        }

        // 单一看门狗：60s 无 stdout/stderr 活动且已过启动豁免期才判定挂起。
        {
            let app_wd = app_clone.clone();
            let state_wd = state_clone.clone();
            let run_wd = run_control.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(5));
                if run_wd.terminal() != RUNNING {
                    break;
                }
                if !run_wd.is_stalled() {
                    continue;
                }
                if !run_wd.claim_terminal(FAILED) {
                    break;
                }

                eprintln!("[NeuroBricks] Watchdog: no activity for 60s (past grace), killing hung trainer");
                let child = if let Ok(mut state) = state_wd.lock() {
                    let is_current = state
                        .active_run
                        .as_ref()
                        .map(|active| Arc::ptr_eq(active, &run_wd))
                        .unwrap_or(false);
                    if is_current {
                        state.child_stdin = None;
                        state.active_run = None;
                        state.child_process.take()
                    } else {
                        None
                    }
                } else {
                    None
                };
                if let Some(mut child) = child {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                emit_run_event(
                    &app_wd,
                    "training-error",
                    serde_json::json!({
                        "type": "error",
                        "errorKind": "hung",
                        "message": "训练进程无响应超过 60 秒（可能已挂起），已自动终止。可点击“重新开始训练”用原配置重试。",
                    }),
                    &run_wd.run_id,
                );
                break;
            });
        }

        let reader = BufReader::new(stdout);
        let mut completed_payload: Option<serde_json::Value> = None;
        let mut failed_payload: Option<serde_json::Value> = None;

        for line in reader.lines() {
            match line {
                Ok(line_str) => {
                    got_any_output.store(true, Ordering::SeqCst);
                    if let Ok(mut json_value) = serde_json::from_str::<serde_json::Value>(&line_str)
                    {
                        if let Some(event_type) = json_value
                            .get("type")
                            .and_then(|value| value.as_str())
                            .map(str::to_owned)
                        {
                            match event_type.as_str() {
                                "progress" | "epoch_end" => {
                                    run_control.touch();
                                    if run_control.terminal() == RUNNING {
                                        emit_run_event(
                                            &app_clone,
                                            "training-progress",
                                            json_value,
                                            &run_control.run_id,
                                        );
                                    }
                                }
                                "heartbeat" => run_control.touch(),
                                "done" | "claim_result" => {
                                    run_control.touch();
                                    if run_control.terminal() == RUNNING
                                        && completed_payload.is_none()
                                    {
                                        if event_type == "done" {
                                            match verify_done_artifacts(
                                                &json_value,
                                                &expected_attempt_id,
                                                expected_model_id.as_deref(),
                                            ) {
                                                Ok(verified) => {
                                                    if let Some(provenance) = json_value
                                                        .get_mut("provenance")
                                                        .and_then(|value| value.as_object_mut())
                                                    {
                                                        provenance.insert(
                                                            "artifactsVerified".to_string(),
                                                            serde_json::Value::Bool(verified),
                                                        );
                                                    }
                                                }
                                                Err(error) => {
                                                    if run_control.claim_terminal(FAILED) {
                                                        failed_payload = Some(serde_json::json!({
                                                            "type": "error",
                                                            "status": "failed",
                                                            "errorKind": "runtime",
                                                            "errorCode": "ARTIFACT_VERIFICATION_FAILED",
                                                            "message": error,
                                                        }));
                                                    }
                                                    break;
                                                }
                                            }
                                        }
                                        // 等进程真正退出并清理句柄后再向前端宣告完成，避免用户立即开始
                                        // 下一次训练时被尚未退出的旧进程拒绝。
                                        completed_payload = Some(json_value);
                                    }
                                }
                                "error" => {
                                    run_control.touch();
                                    if let Some(object) = json_value.as_object_mut() {
                                        object.entry("errorKind".to_string()).or_insert_with(
                                            || serde_json::Value::String("runtime".to_string()),
                                        );
                                    }
                                    if run_control.claim_terminal(FAILED) {
                                        // 与 done 一样，等进程句柄清理完成后再发布终态；否则用户立刻
                                        // 点击重试会撞上仍在退出中的旧进程。
                                        failed_payload = Some(json_value);
                                    }
                                    break;
                                }
                                "log" => {
                                    run_control.touch();
                                    if run_control.terminal() == RUNNING {
                                        emit_run_event(
                                            &app_clone,
                                            "training-progress",
                                            json_value,
                                            &run_control.run_id,
                                        );
                                    }
                                }
                                _ => {
                                    if run_control.claim_terminal(FAILED) {
                                        failed_payload = Some(serde_json::json!({
                                            "type": "error",
                                            "errorKind": "runtime",
                                            "message": format!("训练进程输出了未知协议事件：{}", event_type),
                                        }));
                                    }
                                    break;
                                }
                            }
                        } else {
                            if run_control.claim_terminal(FAILED) {
                                failed_payload = Some(serde_json::json!({
                                    "type": "error",
                                    "errorKind": "runtime",
                                    "message": "训练进程输出的 JSON 缺少 type 字段",
                                }));
                            }
                            break;
                        }
                    } else if run_control.claim_terminal(FAILED) {
                        failed_payload = Some(serde_json::json!({
                            "type": "error",
                            "errorKind": "runtime",
                            "message": format!("训练进程输出了无效协议数据：{}", line_str.chars().take(200).collect::<String>()),
                        }));
                        break;
                    }
                }
                Err(_) => break,
            }
        }

        // stdout 关闭 = 进程已结束。
        // 短暂等待让 stderr 线程收集完最后的输出
        std::thread::sleep(Duration::from_millis(500));

        // 仅当前 run 可以清理共享句柄。若已被 stop/watchdog 取走，这里不会碰下一次训练。
        let child = if let Ok(mut state) = state_clone.lock() {
            let is_current = state
                .active_run
                .as_ref()
                .map(|active| Arc::ptr_eq(active, &run_control))
                .unwrap_or(false);
            if is_current {
                state.child_stdin = None;
                state.active_run = None;
                state.child_process.take()
            } else {
                None
            }
        } else {
            None
        };
        let mut process_exit_observed = false;
        let mut process_exited_successfully = false;
        let mut process_exit_description = "训练进程句柄不可用".to_string();
        if let Some(mut child) = child {
            if run_control.terminal() == FAILED {
                let _ = child.kill();
            }
            match child.wait() {
                Ok(status) => {
                    process_exit_observed = true;
                    process_exited_successfully = status.success();
                    process_exit_description = status
                        .code()
                        .map(|code| format!("退出码 {}", code))
                        .unwrap_or_else(|| "被系统信号终止".to_string());
                }
                Err(error) => {
                    process_exit_description = format!("等待进程退出失败：{}", error);
                    eprintln!("[NeuroBricks] Failed to wait for trainer exit: {}", error);
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }

        if run_control.terminal() == STOPPED {
            eprintln!("[NeuroBricks] Training stopped by user (silent exit)");
        } else if run_control.terminal() == FAILED {
            // stdout 协议错误已抢占 FAILED；清理完成后只发布一次对应错误。
            // 若 FAILED 来自 watchdog，它已在 kill + wait 后自行发布 hung 错误。
            if let Some(payload) = failed_payload {
                emit_run_event(&app_clone, "training-error", payload, &run_control.run_id);
            }
        } else if let Some(payload) = completed_payload {
            // done/claim_result 是 sidecar 的事务提交记录：它只会在权重、哈希和 provenance
            // 全部生成后发出。提交后的解释器/打包运行时清理若返回非零退出码，应显式告警，
            // 但不能把已经完成且可校验的结果伪装成“训练失败”。若连 wait 都未完成，则仍拒收。
            let disposition =
                completion_disposition(process_exit_observed, process_exited_successfully);
            if disposition != CompletionDisposition::RejectUnobservedExit
                && run_control.claim_terminal(COMPLETED)
            {
                if disposition == CompletionDisposition::AcceptWithCleanupWarning {
                    emit_run_event(
                        &app_clone,
                        "training-progress",
                        serde_json::json!({
                            "type": "log",
                            "level": "warning",
                            "message": format!(
                                "训练结果已完成提交，但 sidecar 在提交后的清理阶段异常结束（{}）。结果已采信，建议检查训练日志。",
                                process_exit_description
                            ),
                        }),
                        &run_control.run_id,
                    );
                }
                let event_channel = if payload.get("type").and_then(|value| value.as_str())
                    == Some("claim_result")
                {
                    "claim-evaluation"
                } else {
                    "training-progress"
                };
                emit_run_event(&app_clone, event_channel, payload, &run_control.run_id);
            } else if disposition == CompletionDisposition::RejectUnobservedExit
                && run_control.claim_terminal(FAILED)
            {
                emit_run_event(
                    &app_clone,
                    "training-error",
                    serde_json::json!({
                        "type": "error",
                        "errorKind": "crashed",
                        "message": format!("训练进程报告完成后无法确认进程已经退出，结果未被采信：{}", process_exit_description),
                    }),
                    &run_control.run_id,
                );
            }
        } else if run_control.claim_terminal(FAILED) {
            // 未收到 done/error 且非用户停止 → 崩溃。只允许这一处抢占终态一次。
            let stderr_lines = stderr_buf.lock().unwrap();
            let stderr_tail = {
                let start = stderr_lines.len().saturating_sub(10);
                stderr_lines[start..].join("\n")
            };
            let err_msg = if stderr_lines.is_empty() {
                "训练进程异常退出（无错误输出），请检查网络结构和数据集配置".to_string()
            } else {
                format!("训练进程异常退出：\n{}", stderr_tail)
            };
            emit_run_event(
                &app_clone,
                "training-error",
                serde_json::json!({
                    "type": "error",
                    "errorKind": "crashed",
                    "message": err_msg,
                    "stderrTail": stderr_tail,
                }),
                &run_control.run_id,
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_training(
    state: tauri::State<'_, Arc<Mutex<TrainingState>>>,
    run_id: String,
) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;
    let run = state_guard
        .active_run
        .as_ref()
        .filter(|run| run.run_id == run_id)
        .cloned()
        .ok_or_else(|| "训练任务已结束或 runId 已过期".to_string())?;

    // 先抢占 stopped 终态，stdout/watchdog 随后即使醒来也不会上报崩溃。
    if !run.claim_terminal(STOPPED) {
        return Err("训练任务已进入终态，无法重复停止".to_string());
    }
    if let Some(mut child) = state_guard.child_process.take() {
        match child.try_wait() {
            Ok(Some(_)) => {}
            Ok(None) => {
                if let Err(error) = child.kill() {
                    run.restore_after_stop_failure();
                    state_guard.child_process = Some(child);
                    return Err(format!("无法终止训练进程: {}", error));
                }
            }
            Err(error) => {
                run.restore_after_stop_failure();
                state_guard.child_process = Some(child);
                return Err(format!("无法查询训练进程状态: {}", error));
            }
        }
        if let Err(error) = child.wait() {
            run.restore_after_stop_failure();
            state_guard.child_process = Some(child);
            return Err(format!("等待训练进程退出失败: {}", error));
        }
    }
    // kill/查询失败时必须保留 stdin 与 child 供用户重试停止；只有确认退出后才清空。
    state_guard.child_stdin = None;
    state_guard.active_run = None;

    Ok(())
}

#[tauri::command]
pub fn pause_training(
    state: tauri::State<'_, Arc<Mutex<TrainingState>>>,
    run_id: String,
) -> Result<(), String> {
    eprintln!("[NeuroBricks] pause_training called");
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    let is_current = state_guard
        .active_run
        .as_ref()
        .map(|run| run.run_id == run_id && run.terminal() == RUNNING)
        .unwrap_or(false);
    if !is_current {
        return Err("训练任务已结束或 runId 已过期".to_string());
    }

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
pub fn step_training(
    state: tauri::State<'_, Arc<Mutex<TrainingState>>>,
    run_id: String,
) -> Result<(), String> {
    eprintln!("[NeuroBricks] step_training (resume) called");
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    let is_current = state_guard
        .active_run
        .as_ref()
        .map(|run| run.run_id == run_id && run.terminal() == RUNNING)
        .unwrap_or(false);
    if !is_current {
        return Err("训练任务已结束或 runId 已过期".to_string());
    }

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
    let w = app
        .get_window("chart-view")
        .ok_or("曲线窗口不可用，请重启应用")?;
    w.show().map_err(|e| format!("打开曲线窗口失败: {}", e))?;
    w.set_focus()
        .map_err(|e| format!("聚焦曲线窗口失败: {}", e))?;
    Ok(())
}

/// 在多个已知位置搜索模型权重文件（同 export.rs 逻辑）
fn resolve_model_path(model_path: &str) -> Result<String, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();

    // 非空路径只允许指向规范的 ~/.neurobricks/models/<safe-id>.pth。
    // localStorage 可被手改，不能让卡片路径读取任意权重文件。
    let expanded = if model_path.starts_with("~/") || model_path.starts_with("~\\") {
        format!("{}{}", home, &model_path[1..])
    } else {
        model_path.to_string()
    };
    let expanded_pb = std::path::PathBuf::from(&expanded);
    if !model_path.trim().is_empty() {
        let file_name = expanded_pb
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "模型权重文件名无效".to_string())?;
        let model_id = file_name
            .strip_suffix(".pth")
            .ok_or_else(|| "模型权重必须是 .pth 文件".to_string())?;
        if !is_safe_identifier(model_id) {
            return Err("模型标识格式无效".to_string());
        }

        let canonical_file = expanded_pb
            .canonicalize()
            .map_err(|_| "指定模型权重不存在，请移除失效卡片后重新训练".to_string())?;
        let canonical_models_dir = std::path::PathBuf::from(&home)
            .join(".neurobricks")
            .join("models")
            .canonicalize()
            .map_err(|_| "模型目录不存在，请重新完成训练".to_string())?;
        if canonical_file.parent() != Some(canonical_models_dir.as_path()) {
            return Err("拒绝读取模型目录之外的权重文件".to_string());
        }
        return Ok(canonical_file.to_string_lossy().to_string());
    }

    // 仅保留空路径调用的旧兼容逻辑。
    let candidates = [
        std::path::PathBuf::from(&home)
            .join(".neurobricks")
            .join("model_weights.pth"),
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
    preprocessing: serde_json::Value,
) -> Result<String, String> {
    // 推理需要加载 torch + 模型（数秒至数十秒），放入阻塞线程池执行，避免冻结 UI 主线程
    tauri::async_runtime::spawn_blocking(move || {
        predict_image_blocking(
            app,
            model_path,
            image_path,
            layers,
            input_shape,
            preprocessing,
        )
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
    preprocessing: serde_json::Value,
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
        "preprocessing": preprocessing,
    });
    run_prediction_process(app, config)
}

#[tauri::command]
pub async fn predict_tabular(
    app: AppHandle,
    model_path: String,
    feature_values: Vec<f64>,
    layers: serde_json::Value,
    input_shape: Vec<u32>,
    preprocessing: serde_json::Value,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        predict_tabular_blocking(
            app,
            model_path,
            feature_values,
            layers,
            input_shape,
            preprocessing,
        )
    })
    .await
    .map_err(|e| format!("回归推理任务调度失败: {}", e))?
}

fn predict_tabular_blocking(
    app: AppHandle,
    model_path: String,
    feature_values: Vec<f64>,
    layers: serde_json::Value,
    input_shape: Vec<u32>,
    preprocessing: serde_json::Value,
) -> Result<String, String> {
    if feature_values.is_empty() || feature_values.iter().any(|value| !value.is_finite()) {
        return Err("回归推理特征必须是非空的有限数值列表".to_string());
    }
    let expected_features = input_shape
        .iter()
        .try_fold(1usize, |product, value| {
            product.checked_mul(*value as usize)
        })
        .ok_or_else(|| "回归推理输入形状超过支持范围".to_string())?;
    if input_shape.len() != 3 || expected_features != feature_values.len() {
        return Err(format!(
            "回归推理特征数量与模型输入不一致：需要 {} 个，实际 {} 个",
            expected_features,
            feature_values.len()
        ));
    }
    if !preprocessing.is_object() {
        return Err("回归推理缺少训练时预处理参数".to_string());
    }

    let resolved_model = resolve_model_path(&model_path)?;
    let config = serde_json::json!({
        "mode": "predict_tabular",
        "modelPath": resolved_model,
        "featureValues": feature_values,
        "layers": layers,
        "inputShape": input_shape,
        "preprocessing": preprocessing,
    });
    run_prediction_process(app, config)
}

fn run_prediction_process(app: AppHandle, config: serde_json::Value) -> Result<String, String> {
    let config_str = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    let (trainer, _runtime_info) = resolve_training_runtime(&app, false, true)?;
    let args = trainer.args.clone();
    let work_dir = trainer.work_dir.clone();

    // 通过 stdin 传入配置（同训练方式），读取 stdout 结果
    let mut cmd = trainer.command();
    cmd.args(&args)
        .current_dir(&work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动推理进程: {}", e))?;

    // 写入配置到 stdin
    {
        let stdin = child.stdin.as_mut().ok_or("无法获取 stdin")?;
        use std::io::Write;
        stdin
            .write_all(config_str.as_bytes())
            .map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
    }

    // 等待进程结束，读取 stdout
    let output = child
        .wait_with_output()
        .map_err(|e| format!("等待推理进程失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !stderr.is_empty() {
        eprintln!("[Predict stderr] {}", stderr);
    }

    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(format!("推理无输出。stderr: {}", stderr));
    }

    // Exit status and payload must agree. A structured failure is still a failed
    // inference and must never be returned through the successful IPC branch.
    let parsed = serde_json::from_str::<serde_json::Value>(trimmed)
        .map_err(|e| format!("解析推理结果失败: {} | stdout: {}", e, trimmed))?;
    if !output.status.success()
        || parsed.get("success").and_then(|value| value.as_bool()) == Some(false)
        || parsed.get("type").and_then(|value| value.as_str()) == Some("error")
    {
        let message = parsed
            .get("error")
            .or_else(|| parsed.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("推理进程失败");
        let error_code = parsed
            .get("errorCode")
            .and_then(|value| value.as_str())
            .unwrap_or("PREDICTION_FAILED");
        return Err(format!("{}: {}", error_code, message));
    }

    Ok(trimmed.to_string())
}
