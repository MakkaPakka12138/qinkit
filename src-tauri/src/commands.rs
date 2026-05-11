use crate::{
    config::{load_services, persist_services},
    logs::read_log_tail,
    process_manager::{
        start_service_from_config, stop_service_inner, sync_discovered_processes,
    },
    types::{ServiceConfig, ServiceManager, ServiceView},
    window_ops,
};
use tauri::{AppHandle, State, Window};

#[tauri::command]
pub(crate) fn list_services(
    app: AppHandle,
    manager: State<'_, ServiceManager>,
) -> Result<Vec<ServiceView>, String> {
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
pub(crate) fn save_services(
    app: AppHandle,
    services: Vec<ServiceConfig>,
) -> Result<(), String> {
    let normalized = services
        .into_iter()
        .map(crate::config::normalize_loaded_service)
        .collect::<Vec<_>>();
    persist_services(&app, &normalized)
}

#[tauri::command]
pub(crate) fn start_service(
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

#[tauri::command]
pub(crate) fn stop_service(
    manager: State<'_, ServiceManager>,
    id: String,
) -> Result<(), String> {
    stop_service_inner(manager.inner().clone(), id)
}

#[tauri::command]
pub(crate) fn restart_service(
    app: AppHandle,
    manager: State<'_, ServiceManager>,
    id: String,
) -> Result<u32, String> {
    let _ = stop_service_inner(manager.inner().clone(), id.clone());
    start_service(app, manager, id)
}

#[tauri::command]
pub(crate) fn read_log(path: String, max_lines: usize) -> Result<String, String> {
    read_log_tail(&path, max_lines)
}

#[tauri::command]
pub(crate) fn open_path(path: String) -> Result<(), String> {
    window_ops::open_path(path)
}

#[tauri::command]
pub(crate) fn window_minimize(window: Window) -> Result<(), String> {
    window_ops::window_minimize(window)
}

#[tauri::command]
pub(crate) fn window_toggle_maximize(window: Window) -> Result<bool, String> {
    window_ops::window_toggle_maximize(window)
}

#[tauri::command]
pub(crate) fn window_close(window: Window) -> Result<(), String> {
    window_ops::window_close(window)
}

#[tauri::command]
pub(crate) fn window_start_dragging(window: Window) -> Result<(), String> {
    window_ops::window_start_dragging(window)
}
