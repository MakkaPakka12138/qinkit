use crate::{
    config::{
        build_runtime_log_paths, load_services, open_append, update_runtime_logs,
    },
    types::{RunningProcess, ServiceConfig, ServiceManager, SystemProcessInfo},
};
use std::{
    collections::HashMap,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::AppHandle;

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
fn command_tokens(input: &str) -> Vec<String> {
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
fn contains_token_sequence(process_tokens: &[String], service_tokens: &[String]) -> bool {
    if service_tokens.is_empty() {
        return false;
    }

    let mut search_start = 0usize;
    for service_token in service_tokens {
        let Some(found_offset) = process_tokens[search_start..]
            .iter()
            .position(|process_token| process_token.contains(service_token))
        else {
            return false;
        };
        search_start += found_offset + 1;
    }

    true
}

#[cfg(target_os = "windows")]
fn process_match_score(service: &ServiceConfig, process: &SystemProcessInfo) -> usize {
    let process_command_raw = match &process.command_line {
        Some(command) if !command.trim().is_empty() => command,
        _ => return 0,
    };
    let service_command = normalize_command_text(&service.command);
    let process_command = normalize_command_text(process_command_raw);
    if service_command.is_empty()
        || process_command.is_empty()
        || process.process_id == std::process::id()
    {
        return 0;
    }

    if process_command.contains(&service_command) {
        return 10_000 + service_command.len();
    }

    let service_tokens = command_tokens(&service.command);
    if service_tokens.is_empty() {
        return 0;
    }

    let process_tokens = command_tokens(process_command_raw);
    if process_tokens.is_empty() {
        return 0;
    }

    if !contains_token_sequence(&process_tokens, &service_tokens) {
        return 0;
    }

    1_000 + service_tokens.len()
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
pub(crate) fn sync_discovered_processes(
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

    running.retain(|service_id, proc_info| {
        proc_info.managed || discovered.contains_key(service_id)
    });

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
pub(crate) fn sync_discovered_processes(
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

pub(crate) fn start_service_from_config(
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

pub(crate) fn stop_service_inner(manager: ServiceManager, id: String) -> Result<(), String> {
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

pub(crate) fn auto_start_services(app: &AppHandle, manager: ServiceManager) {
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
