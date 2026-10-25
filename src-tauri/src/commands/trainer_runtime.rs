use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use std::{io::Read, io::Write};
use tauri::AppHandle;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const PROBE_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone)]
pub struct TrainerLaunch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub work_dir: PathBuf,
    pub source: String,
}

impl TrainerLaunch {
    pub fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        if self.source == "bundled" {
            // A release must not become functional only because the end user
            // happens to have Conda/Python DLLs on PATH.
            #[cfg(windows)]
            {
                let mut runtime_paths = self
                    .program
                    .parent()
                    .map(|parent| vec![parent.join("_internal")])
                    .unwrap_or_default();
                if let Some(system_root) = std::env::var_os("SystemRoot") {
                    let system_root = PathBuf::from(system_root);
                    runtime_paths.push(system_root.join("System32"));
                    runtime_paths.push(system_root);
                }
                if let Ok(runtime_path) = std::env::join_paths(runtime_paths) {
                    command.env("PATH", runtime_path);
                }
                command.env_remove("PYTHONPATH");
                command.env_remove("PYTHONHOME");
            }
        }
        command
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingRuntimeInfo {
    pub available: bool,
    pub source: String,
    pub python_version: String,
    pub torch_version: String,
    pub cuda_build_version: Option<String>,
    pub cuda_available: bool,
    pub cuda_device_name: Option<String>,
    pub image_classification_available: bool,
    pub csv_regression_available: bool,
    pub issues: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCapabilityPayload {
    #[serde(rename = "type")]
    message_type: String,
    available: bool,
    python_version: String,
    torch_version: String,
    cuda_build_version: Option<String>,
    cuda_available: bool,
    cuda_device_name: Option<String>,
    image_classification_available: bool,
    csv_regression_available: bool,
    #[serde(default)]
    issues: Vec<String>,
}

#[derive(Clone)]
struct CachedRuntime {
    launch: TrainerLaunch,
    info: TrainingRuntimeInfo,
}

static RUNTIME_CACHE: OnceLock<Mutex<Option<CachedRuntime>>> = OnceLock::new();

fn runtime_cache() -> &'static Mutex<Option<CachedRuntime>> {
    RUNTIME_CACHE.get_or_init(|| Mutex::new(None))
}

pub fn resolve_sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path_resolver()
        .resolve_resource("sidecars/nb-trainer")
        .or_else(|| {
            std::env::current_exe().ok().and_then(|exe| {
                exe.parent().map(|parent| {
                    let mut path = parent.to_path_buf();
                    if path.ends_with("debug") || path.ends_with("release") {
                        path.pop();
                        path.pop();
                    }
                    path.join("sidecars").join("nb-trainer")
                })
            })
        })
        .ok_or_else(|| "找不到内置训练器资源目录；安装包可能不完整，请重新安装应用".to_string())
}

fn packaged_candidates(sidecar_path: &Path) -> Vec<TrainerLaunch> {
    let work_dir = sidecar_path.to_path_buf();
    let mut directories = Vec::new();
    if let Some(sidecars_dir) = sidecar_path.parent() {
        directories.push(sidecars_dir.join("dist").join("nb-trainer"));
    }
    directories.push(sidecar_path.to_path_buf());

    directories
        .into_iter()
        .flat_map(|directory| {
            [
                directory.join("nb-trainer.exe"),
                directory.join("nb-trainer").join("nb-trainer.exe"),
            ]
        })
        .filter(|program| program.is_file())
        .map(|program| TrainerLaunch {
            work_dir: if work_dir.is_dir() {
                work_dir.clone()
            } else {
                program.parent().unwrap_or(sidecar_path).to_path_buf()
            },
            program,
            args: Vec::new(),
            source: "bundled".to_string(),
        })
        .collect()
}

fn push_python_candidate(
    candidates: &mut Vec<TrainerLaunch>,
    seen: &mut Vec<PathBuf>,
    program: PathBuf,
    prefix_args: Vec<String>,
    source: &str,
    sidecar_path: &Path,
) {
    if !program.is_file() || seen.iter().any(|existing| existing == &program) {
        return;
    }
    let main_py = sidecar_path.join("main.py");
    if !main_py.is_file() {
        return;
    }
    seen.push(program.clone());
    let mut args = prefix_args;
    args.push(main_py.to_string_lossy().to_string());
    candidates.push(TrainerLaunch {
        program,
        args,
        work_dir: sidecar_path.to_path_buf(),
        source: source.to_string(),
    });
}

fn development_candidates(sidecar_path: &Path) -> Vec<TrainerLaunch> {
    let mut candidates = Vec::new();
    let mut seen = Vec::new();

    for variable in ["NEUROBRICKS_PYTHON", "PYTHON"] {
        if let Ok(value) = std::env::var(variable) {
            let trimmed = value.trim().trim_matches('"');
            if !trimmed.is_empty() {
                push_python_candidate(
                    &mut candidates,
                    &mut seen,
                    PathBuf::from(trimmed),
                    Vec::new(),
                    "development-explicit-python",
                    sidecar_path,
                );
            }
        }
    }

    push_python_candidate(
        &mut candidates,
        &mut seen,
        sidecar_path
            .join(".venv")
            .join("Scripts")
            .join("python.exe"),
        Vec::new(),
        "development-project-venv",
        sidecar_path,
    );

    for (variable, source) in [
        ("VIRTUAL_ENV", "development-active-venv"),
        ("CONDA_PREFIX", "development-active-conda"),
    ] {
        if let Ok(prefix) = std::env::var(variable) {
            push_python_candidate(
                &mut candidates,
                &mut seen,
                PathBuf::from(prefix).join("python.exe"),
                Vec::new(),
                source,
                sidecar_path,
            );
        }
    }

    if let Ok(profile) = std::env::var("USERPROFILE") {
        for (directory, source) in [
            ("anaconda3", "development-anaconda"),
            ("miniconda3", "development-miniconda"),
        ] {
            push_python_candidate(
                &mut candidates,
                &mut seen,
                PathBuf::from(&profile).join(directory).join("python.exe"),
                Vec::new(),
                source,
                sidecar_path,
            );
        }
    }

    for (command, prefix_args, source) in [
        ("python", Vec::new(), "development-path-python"),
        ("python3", Vec::new(), "development-path-python3"),
        ("py", vec!["-3".to_string()], "development-py-launcher"),
    ] {
        if let Ok(program) = which::which(command) {
            push_python_candidate(
                &mut candidates,
                &mut seen,
                program,
                prefix_args,
                source,
                sidecar_path,
            );
        }
    }

    candidates.extend(packaged_candidates(sidecar_path));
    candidates
}

fn parse_capability_payload(stdout: &str) -> Result<RuntimeCapabilityPayload, String> {
    stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<RuntimeCapabilityPayload>(line).ok())
        .find(|payload| payload.message_type == "runtime_capabilities")
        .ok_or_else(|| "训练器未返回 runtime_capabilities，可能是旧版本或文件不完整".to_string())
}

fn probe_candidate(candidate: &TrainerLaunch) -> Result<TrainingRuntimeInfo, String> {
    let mut command = candidate.command();
    command
        .args(&candidate.args)
        .current_dir(&candidate.work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动候选训练器：{}", error))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(b"{\"mode\":\"capabilities\"}\n")
            .map_err(|error| format!("无法向训练器发送能力探测：{}", error))?;
    }

    let deadline = Instant::now() + PROBE_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("训练器能力探测超时".to_string());
            }
            Err(error) => return Err(format!("无法读取训练器能力探测状态：{}", error)),
        }
    };

    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut stream) = child.stdout.take() {
        let _ = stream.read_to_string(&mut stdout);
    }
    if let Some(mut stream) = child.stderr.take() {
        let _ = stream.read_to_string(&mut stderr);
    }
    let payload = parse_capability_payload(&stdout).map_err(|error| {
        let detail = stderr.lines().last().unwrap_or("无 stderr 详情");
        format!("{}；{}", error, detail)
    })?;
    if !status.success() || !payload.available {
        return Err(payload.issues.join("；"));
    }

    Ok(TrainingRuntimeInfo {
        available: payload.available,
        source: candidate.source.clone(),
        python_version: payload.python_version,
        torch_version: payload.torch_version,
        cuda_build_version: payload.cuda_build_version,
        cuda_available: payload.cuda_available,
        cuda_device_name: payload.cuda_device_name,
        image_classification_available: payload.image_classification_available,
        csv_regression_available: payload.csv_regression_available,
        issues: payload.issues,
    })
}

fn runtime_satisfies(info: &TrainingRuntimeInfo, require_csv: bool, prefer_cuda: bool) -> bool {
    info.available
        && info.image_classification_available
        && (!require_csv || info.csv_regression_available)
        && (!prefer_cuda || info.cuda_available)
}

pub fn resolve_training_runtime(
    app: &AppHandle,
    require_csv: bool,
    prefer_cuda: bool,
) -> Result<(TrainerLaunch, TrainingRuntimeInfo), String> {
    if let Ok(cache) = runtime_cache().lock() {
        if let Some(cached) = cache.as_ref() {
            if cached.launch.program.is_file()
                && runtime_satisfies(&cached.info, require_csv, prefer_cuda)
            {
                return Ok((cached.launch.clone(), cached.info.clone()));
            }
        }
    }

    let sidecar_path = resolve_sidecar_path(app)?;
    let candidates = if cfg!(debug_assertions) {
        development_candidates(&sidecar_path)
    } else {
        // 正式安装包绝不暗中借用用户 Python。内置训练器缺失或不完整时应明确失败。
        packaged_candidates(&sidecar_path)
    };
    if candidates.is_empty() {
        return Err(if cfg!(debug_assertions) {
            "没有找到可启动的开发 Python 或内置训练器".to_string()
        } else {
            "安装包内置训练器缺失，请重新安装应用".to_string()
        });
    }

    let mut fallback: Option<(TrainerLaunch, TrainingRuntimeInfo)> = None;
    let mut failures = Vec::new();
    for candidate in candidates {
        match probe_candidate(&candidate) {
            Ok(info) if runtime_satisfies(&info, require_csv, prefer_cuda) => {
                let selected = (candidate, info);
                if let Ok(mut cache) = runtime_cache().lock() {
                    *cache = Some(CachedRuntime {
                        launch: selected.0.clone(),
                        info: selected.1.clone(),
                    });
                }
                return Ok(selected);
            }
            Ok(info)
                if info.available
                    && info.image_classification_available
                    && (!require_csv || info.csv_regression_available) =>
            {
                if fallback.is_none() {
                    fallback = Some((candidate, info));
                }
            }
            Ok(info) => failures.push(format!("{}: {}", candidate.source, info.issues.join("；"))),
            Err(error) => failures.push(format!("{}: {}", candidate.source, error)),
        }
    }

    if let Some(selected) = fallback {
        if let Ok(mut cache) = runtime_cache().lock() {
            *cache = Some(CachedRuntime {
                launch: selected.0.clone(),
                info: selected.1.clone(),
            });
        }
        return Ok(selected);
    }

    Err(format!(
        "没有满足当前任务的训练运行时：{}",
        failures.join(" | ")
    ))
}

#[tauri::command]
pub async fn detect_training_runtime(app: AppHandle) -> Result<TrainingRuntimeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        resolve_training_runtime(&app, false, true).map(|(_, info)| info)
    })
    .await
    .map_err(|error| format!("训练运行时探测任务失败：{}", error))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(cuda: bool, csv: bool) -> TrainingRuntimeInfo {
        TrainingRuntimeInfo {
            available: true,
            source: "test".to_string(),
            python_version: "3.12".to_string(),
            torch_version: "2".to_string(),
            cuda_build_version: cuda.then(|| "12.8".to_string()),
            cuda_available: cuda,
            cuda_device_name: cuda.then(|| "GPU".to_string()),
            image_classification_available: true,
            csv_regression_available: csv,
            issues: Vec::new(),
        }
    }

    #[test]
    fn task_requirements_are_checked_separately_from_hardware_preference() {
        assert!(runtime_satisfies(&info(true, true), true, true));
        assert!(!runtime_satisfies(&info(true, false), true, true));
        assert!(!runtime_satisfies(&info(false, true), true, true));
        assert!(runtime_satisfies(&info(false, true), true, false));
    }

    #[test]
    fn capability_parser_ignores_other_protocol_lines() {
        let payload = parse_capability_payload(
            "{\"type\":\"heartbeat\"}\n{\"type\":\"runtime_capabilities\",\"available\":true,\"pythonVersion\":\"3.12\",\"torchVersion\":\"2\",\"cudaBuildVersion\":null,\"cudaAvailable\":false,\"cudaDeviceName\":null,\"imageClassificationAvailable\":true,\"csvRegressionAvailable\":true,\"issues\":[]}",
        )
        .expect("capabilities");
        assert!(payload.available);
        assert!(!payload.cuda_available);
    }
}
