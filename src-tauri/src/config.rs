use crate::types::ServiceConfig;
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub(crate) fn app_data_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("获取应用数据目录失败: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("创建应用数据目录失败: {err}"))?;
    Ok(dir.join("services.json"))
}

pub(crate) fn load_services(app: &AppHandle) -> Result<Vec<ServiceConfig>, String> {
    let file = app_data_file(app)?;
    if !file.exists() {
        fs::write(&file, "[]").map_err(|err| format!("初始化配置文件失败: {err}"))?;
    }
    load_services_from_path(&file)
}

pub(crate) fn persist_services(app: &AppHandle, services: &[ServiceConfig]) -> Result<(), String> {
    let file = app_data_file(app)?;
    let text = serde_json::to_string_pretty(services)
        .map_err(|err| format!("序列化配置失败: {err}"))?;
    fs::write(&file, text).map_err(|err| format!("写入配置文件失败: {err}"))
}

pub(crate) fn load_services_from_path(path: impl AsRef<Path>) -> Result<Vec<ServiceConfig>, String> {
    let path = path.as_ref();
    let text = fs::read_to_string(path).map_err(|err| format!("读取配置文件失败: {err}"))?;
    let services = serde_json::from_str::<Vec<ServiceConfig>>(&text).map_err(|err| {
        format!(
            "解析配置文件失败: {err}\n文件路径: {}",
            path.to_string_lossy()
        )
    })?;

    Ok(services.into_iter().map(normalize_loaded_service).collect())
}

fn ensure_parent(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    if let Some(parent) = Path::new(trimmed).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("创建日志目录失败 {}: {err}", parent.display()))?;
        }
    }
    Ok(())
}

fn ensure_dir(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    fs::create_dir_all(trimmed).map_err(|err| format!("创建日志目录失败 {trimmed}: {err}"))
}

pub(crate) fn open_append(path: &str) -> Result<File, String> {
    ensure_parent(path)?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|err| format!("打开日志文件失败 {path}: {err}"))
}

fn default_log_dir(cwd: &str) -> String {
    let root = cwd.trim().trim_end_matches(['\\', '/']);
    if root.is_empty() {
        String::new()
    } else {
        format!("{root}\\logs")
    }
}

fn infer_log_dir(service: &ServiceConfig) -> String {
    let configured = service.log_dir.trim();
    if !configured.is_empty() {
        return configured.to_string();
    }

    for log_path in [&service.stdout_log, &service.stderr_log] {
        let trimmed = log_path.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(parent) = Path::new(trimmed).parent() {
            if !parent.as_os_str().is_empty() {
                return parent.to_string_lossy().to_string();
            }
        }
    }

    default_log_dir(&service.cwd)
}

pub(crate) fn normalize_loaded_service(mut service: ServiceConfig) -> ServiceConfig {
    if service.log_dir.trim().is_empty() {
        service.log_dir = infer_log_dir(&service);
    }
    service
}

pub(crate) fn build_runtime_log_paths(service: &ServiceConfig) -> Result<(String, String), String> {
    let log_dir = infer_log_dir(service);
    if log_dir.trim().is_empty() {
        return Err("日志目录不能为空。".to_string());
    }

    ensure_dir(&log_dir)?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("获取日志时间戳失败: {err}"))?
        .as_millis();

    let safe_id = service
        .id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    Ok((
        format!("{log_dir}\\{safe_id}_{timestamp}.out.log"),
        format!("{log_dir}\\{safe_id}_{timestamp}.err.log"),
    ))
}

pub(crate) fn update_runtime_logs(
    app: &AppHandle,
    id: &str,
    stdout_log: &str,
    stderr_log: &str,
) -> Result<ServiceConfig, String> {
    let mut services = load_services(app)?;
    let index = services
        .iter()
        .position(|svc| svc.id == id)
        .ok_or_else(|| format!("找不到服务: {id}"))?;

    services[index].stdout_log = stdout_log.to_string();
    services[index].stderr_log = stderr_log.to_string();
    let updated = services[index].clone();
    persist_services(app, &services)?;
    Ok(updated)
}
