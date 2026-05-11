use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State, Window};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServiceConfig {
    id: String,
    name: String,
    command: String,
    cwd: String,
    enabled: bool,
    auto_start: bool,
    auto_restart: bool,
    restart_delay_seconds: u64,
    #[serde(default)]
    log_dir: String,
    #[serde(default)]
    stdout_log: String,
    #[serde(default)]
    stderr_log: String,
}

#[derive(Debug, Clone, Serialize)]
struct ServiceView {
    id: String,
    name: String,
    command: String,
    cwd: String,
    enabled: bool,
    auto_start: bool,
    auto_restart: bool,
    restart_delay_seconds: u64,
    log_dir: String,
    stdout_log: String,
    stderr_log: String,
    running: bool,
    pid: Option<u32>,
}

struct RunningProcess {
    pid: u32,
    stop_requested: Arc<AtomicBool>,
    managed: bool,
}

#[derive(Clone, Default)]
struct ServiceManager {
    processes: Arc<Mutex<HashMap<String, RunningProcess>>>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
struct SystemProcessInfo {
    #[serde(rename = "ProcessId")]
    process_id: u32,
    #[serde(rename = "CommandLine")]
    command_line: Option<String>,
}

fn app_data_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("获取应用数据目录失败: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("创建应用数据目录失败: {err}"))?;
    Ok(dir.join("services.json"))
}

fn load_services(app: &AppHandle) -> Result<Vec<ServiceConfig>, String> {
    let file = app_data_file(app)?;
    if !file.exists() {
        fs::write(&file, "[]").map_err(|err| format!("初始化配置文件失败: {err}"))?;
    }
    let text = fs::read_to_string(&file).map_err(|err| format!("读取配置文件失败: {err}"))?;
    let services = serde_json::from_str::<Vec<ServiceConfig>>(&text).map_err(|err| {
        format!(
            "解析配置文件失败: {err}\n文件路径: {}",
            file.to_string_lossy()
        )
    })?;

    Ok(services.into_iter().map(normalize_loaded_service).collect())
}

fn persist_services(app: &AppHandle, services: &[ServiceConfig]) -> Result<(), String> {
    let file = app_data_file(app)?;
    let text = serde_json::to_string_pretty(services)
        .map_err(|err| format!("序列化配置失败: {err}"))?;
    fs::write(&file, text).map_err(|err| format!("写入配置文件失败: {err}"))
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

fn open_append(path: &str) -> Result<File, String> {
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

fn normalize_loaded_service(mut service: ServiceConfig) -> ServiceConfig {
    if service.log_dir.trim().is_empty() {
        service.log_dir = infer_log_dir(&service);
    }
    service
}

fn build_runtime_log_paths(service: &ServiceConfig) -> Result<(String, String), String> {
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

fn update_runtime_logs(
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

fn is_running(manager: &ServiceManager, id: &str) -> Result<bool, String> {
    let processes = manager
        .processes
        .lock()
        .map_err(|_| "进程状态锁被污染。Windows 都没这么阴间。".to_string())?;
    Ok(processes.contains_key(id))
}

#[cfg(target_os = "windows")]
fn apply_windows_creation_flags(command: &mut Command, flags: u32) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(flags);
}

#[cfg(target_os = "windows")]
fn normalize_command_text(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

#[cfg(target_os = "windows")]
fn significant_command_tokens(input: &str) -> Vec<String> {
    input
        .split(|ch: char| {
            ch.is_whitespace()
                || matches!(ch, '"' | '\'' | '`' | '|' | '&' | ';' | '>' | '<' | '(' | ')')
        })
        .filter_map(|part| {
            let token = part
                .trim_matches(|ch: char| matches!(ch, '"' | '\'' | '`' | ',' | '[' | ']'))
                .trim();
            if token.is_empty() || matches!(token, "|" | "&" | "&&" | "||" | ";" | ">") {
                None
            } else {
                Some(token.to_ascii_lowercase())
            }
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn process_match_score(service: &ServiceConfig, process: &SystemProcessInfo) -> usize {
    let process_command = match &process.command_line {
        Some(command) if !command.trim().is_empty() => normalize_command_text(command),
        _ => return 0,
    };
    let service_command = normalize_command_text(&service.command);
    if service_command.is_empty() || process_command.is_empty() {
        return 0;
    }
    if process.process_id == std::process::id() {
        return 0;
    }

    if process_command.contains(&service_command) {
        return 10_000 + service_command.len();
    }

    let tokens = significant_command_tokens(&service.command);
    if tokens.is_empty() {
        return 0;
    }

    let first_token = &tokens[0];
    if !process_command.contains(first_token) {
        return 0;
    }

    let matched_count = tokens
        .iter()
        .filter(|token| process_command.contains(token.as_str()))
        .count();
    let required_matches = match tokens.len() {
        0 => 0,
        1 => 1,
        2 => 2,
        _ => 3,
    };

    if matched_count < required_matches {
        return 0;
    }

    100 + matched_count
}

#[cfg(target_os = "windows")]
fn parse_system_processes(json: &str) -> Result<Vec<SystemProcessInfo>, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(Vec::new());
    }

    let value = serde_json::from_str::<serde_json::Value>(trimmed)
        .map_err(|err| format!("解析系统进程列表失败: {err}"))?;

    match value {
        serde_json::Value::Array(items) => items
            .into_iter()
            .map(serde_json::from_value::<SystemProcessInfo>)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("解析系统进程项失败: {err}")),
        serde_json::Value::Object(_) => serde_json::from_value::<SystemProcessInfo>(value)
            .map(|item| vec![item])
            .map_err(|err| format!("解析系统进程项失败: {err}")),
        _ => Ok(Vec::new()),
    }
}

#[cfg(target_os = "windows")]
fn list_system_processes() -> Result<Vec<SystemProcessInfo>, String> {
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let script = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    apply_windows_creation_flags(&mut command, CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|err| format!("获取系统进程失败: {err}"))?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    parse_system_processes(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(target_os = "windows")]
fn sync_discovered_processes(
    manager: &ServiceManager,
    services: &[ServiceConfig],
) -> Result<(), String> {
    let processes = match list_system_processes() {
        Ok(items) => items,
        Err(_) => return Ok(()),
    };

    let discovered = services
        .iter()
        .filter_map(|service| {
            if service.command.trim().is_empty() {
                return None;
            }

            processes
                .iter()
                .filter_map(|process| {
                    let score = process_match_score(service, process);
                    if score == 0 {
                        None
                    } else {
                        Some((score, process.process_id))
                    }
                })
                .max_by_key(|(score, pid)| (*score, *pid))
                .map(|(_, pid)| (service.id.clone(), pid))
        })
        .collect::<HashMap<_, _>>();

    let mut running = manager
        .processes
        .lock()
        .map_err(|_| "进程状态锁被污染。".to_string())?;

    running.retain(|service_id, proc_info| proc_info.managed || discovered.contains_key(service_id));

    for (service_id, pid) in discovered {
        running
            .entry(service_id)
            .and_modify(|proc_info| {
                if !proc_info.managed {
                    proc_info.pid = pid;
                }
            })
            .or_insert_with(|| RunningProcess {
                pid,
                stop_requested: Arc::new(AtomicBool::new(false)),
                managed: false,
            });
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn sync_discovered_processes(
    _manager: &ServiceManager,
    _services: &[ServiceConfig],
) -> Result<(), String> {
    Ok(())
}

fn running_pid(manager: &ServiceManager, id: &str) -> Result<Option<u32>, String> {
    let processes = manager
        .processes
        .lock()
        .map_err(|_| "进程状态锁被污染。".to_string())?;
    Ok(processes.get(id).map(|item| item.pid))
}

fn start_service_from_config(
    app: &AppHandle,
    manager: ServiceManager,
    service: ServiceConfig,
) -> Result<u32, String> {
    sync_discovered_processes(&manager, std::slice::from_ref(&service))?;

    if let Some(pid) = running_pid(&manager, &service.id)? {
        return Ok(pid);
    }

    spawn_process(app, manager, service)
}

fn spawn_process(
    app: &AppHandle,
    manager: ServiceManager,
    service: ServiceConfig,
) -> Result<u32, String> {
    if service.id.trim().is_empty() {
        return Err("服务 ID 不能为空。".to_string());
    }
    if service.command.trim().is_empty() {
        return Err("启动命令不能为空。".to_string());
    }
    if is_running(&manager, &service.id)? {
        let processes = manager
            .processes
            .lock()
            .map_err(|_| "进程状态锁被污染。".to_string())?;
        if let Some(running) = processes.get(&service.id) {
            return Ok(running.pid);
        }
    }

    let (stdout_log, stderr_log) = build_runtime_log_paths(&service)?;
    let service = update_runtime_logs(app, &service.id, &stdout_log, &stderr_log)?;
    let stdout = open_append(&service.stdout_log)?;
    let stderr = open_append(&service.stderr_log)?;

    let mut cmd = if cfg!(target_os = "windows") {
        let mut command = Command::new("powershell.exe");
        command
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-Command")
            .arg(&service.command);
        command
    } else {
        let mut command = Command::new("sh");
        command.arg("-lc").arg(&service.command);
        command
    };

    if !service.cwd.trim().is_empty() {
        cmd.current_dir(&service.cwd);
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        apply_windows_creation_flags(&mut cmd, CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    let child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|err| format!("启动失败: {err}"))?;

    let pid = child.id();
    let child_ref = Arc::new(Mutex::new(child));
    let stop_requested = Arc::new(AtomicBool::new(false));

    {
        let mut processes = manager
            .processes
            .lock()
            .map_err(|_| "进程状态锁被污染。".to_string())?;
        processes.insert(
            service.id.clone(),
            RunningProcess {
                pid,
                stop_requested: stop_requested.clone(),
                managed: true,
            },
        );
    }

    let watcher_manager = manager.clone();
    let watcher_service = service.clone();
    let watcher_app = app.clone();
    thread::spawn(move || {
        let _ = child_ref.lock().ok().and_then(|mut child| child.wait().ok());

        if let Ok(mut processes) = watcher_manager.processes.lock() {
            processes.remove(&watcher_service.id);
        }

        let should_restart = watcher_service.enabled
            && watcher_service.auto_restart
            && !stop_requested.load(Ordering::SeqCst);

        if should_restart {
            let delay = watcher_service.restart_delay_seconds.max(1);
            thread::sleep(Duration::from_secs(delay));
            let _ = spawn_process(&watcher_app, watcher_manager, watcher_service);
        }
    });

    Ok(pid)
}

#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) -> Result<(), String> {
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut command = Command::new("taskkill");
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_windows_creation_flags(&mut command, CREATE_NO_WINDOW);

    let status = command
        .status()
        .map_err(|err| format!("调用 taskkill 失败: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("taskkill 执行失败，PID={pid}"))
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree(pid: u32) -> Result<(), String> {
    let status = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .map_err(|err| format!("调用 kill 失败: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("kill 执行失败，PID={pid}"))
    }
}

#[tauri::command]
fn list_services(app: AppHandle, manager: State<'_, ServiceManager>) -> Result<Vec<ServiceView>, String> {
    let services = load_services(&app)?;
    sync_discovered_processes(manager.inner(), &services)?;
    let processes = manager
        .processes
        .lock()
        .map_err(|_| "进程状态锁被污染。".to_string())?;

    Ok(services
        .into_iter()
        .map(|svc| {
            let running = processes.get(&svc.id);
            ServiceView {
                id: svc.id,
                name: svc.name,
                command: svc.command,
                cwd: svc.cwd,
                enabled: svc.enabled,
                auto_start: svc.auto_start,
                auto_restart: svc.auto_restart,
                restart_delay_seconds: svc.restart_delay_seconds,
                log_dir: svc.log_dir,
                stdout_log: svc.stdout_log,
                stderr_log: svc.stderr_log,
                running: running.is_some(),
                pid: running.map(|item| item.pid),
            }
        })
        .collect())
}

#[tauri::command]
fn save_services(app: AppHandle, services: Vec<ServiceConfig>) -> Result<(), String> {
    let normalized = services
        .into_iter()
        .map(normalize_loaded_service)
        .collect::<Vec<_>>();
    persist_services(&app, &normalized)
}

#[tauri::command]
fn start_service(
    app: AppHandle,
    manager: State<'_, ServiceManager>,
    id: String,
) -> Result<u32, String> {
    let services = load_services(&app)?;
    let service = services
        .into_iter()
        .find(|svc| svc.id == id)
        .ok_or_else(|| format!("找不到服务: {id}"))?;

    if !service.enabled {
        return Err(format!("服务已禁用: {}", service.name));
    }

    start_service_from_config(&app, manager.inner().clone(), service)
}

fn stop_service_inner(manager: ServiceManager, id: String) -> Result<(), String> {
    let running = {
        let mut processes = manager
            .processes
            .lock()
            .map_err(|_| "进程状态锁被污染。".to_string())?;
        processes.remove(&id)
    };

    if let Some(proc_info) = running {
        proc_info.stop_requested.store(true, Ordering::SeqCst);
        kill_process_tree(proc_info.pid)
    } else {
        Ok(())
    }
}

#[tauri::command]
fn stop_service(manager: State<'_, ServiceManager>, id: String) -> Result<(), String> {
    stop_service_inner(manager.inner().clone(), id)
}

#[tauri::command]
fn restart_service(
    app: AppHandle,
    manager: State<'_, ServiceManager>,
    id: String,
) -> Result<u32, String> {
    let _ = stop_service_inner(manager.inner().clone(), id.clone());
    start_service(app, manager, id)
}

#[tauri::command]
fn read_log(path: String, max_lines: usize) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok("日志路径为空。".to_string());
    }

    let file = File::open(trimmed).map_err(|err| format!("读取日志失败 {trimmed}: {err}"))?;
    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines().map_while(Result::ok).collect();
    let keep = max_lines.max(20);
    let start = lines.len().saturating_sub(keep);
    Ok(lines[start..].join("\n"))
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径为空。".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let target = Path::new(trimmed);
        let mut command = Command::new("explorer.exe");

        if target.is_file() {
            command.arg(format!("/select,{trimmed}"));
        } else {
            command.arg(trimmed);
        }

        command
            .stdin(Stdio::null())
            .spawn()
            .map_err(|err| format!("打开路径失败: {err}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|err| format!("打开路径失败: {err}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|err| format!("打开路径失败: {err}"))?;
    }

    Ok(())
}

#[tauri::command]
fn window_minimize(window: Window) -> Result<(), String> {
    window
        .minimize()
        .map_err(|err| format!("窗口最小化失败: {err}"))
}

#[tauri::command]
fn window_toggle_maximize(window: Window) -> Result<bool, String> {
    let is_maximized = window
        .is_maximized()
        .map_err(|err| format!("读取窗口状态失败: {err}"))?;

    if is_maximized {
        window
            .unmaximize()
            .map_err(|err| format!("窗口还原失败: {err}"))?;
        Ok(false)
    } else {
        window
            .maximize()
            .map_err(|err| format!("窗口放大失败: {err}"))?;
        Ok(true)
    }
}

#[tauri::command]
fn window_close(window: Window) -> Result<(), String> {
    let _ = window.hide();
    window.close().map_err(|err| format!("关闭窗口失败: {err}"))
}

#[tauri::command]
fn window_start_dragging(window: Window) -> Result<(), String> {
    window
        .start_dragging()
        .map_err(|err| format!("窗口拖动失败: {err}"))
}

fn auto_start_services(app: &AppHandle, manager: ServiceManager) {
    match load_services(app) {
        Ok(services) => {
            for service in services {
                if service.enabled && service.auto_start {
                    let _ = start_service_from_config(app, manager.clone(), service);
                }
            }
        }
        Err(err) => {
            eprintln!("自动启动服务失败: {err}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServiceManager::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let manager = app.state::<ServiceManager>().inner().clone();
            auto_start_services(&app.handle(), manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_services,
            save_services,
            start_service,
            stop_service,
            restart_service,
            read_log,
            open_path,
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_start_dragging
        ])
        .run(tauri::generate_context!())
        .expect("error while running lite service manager");
}
