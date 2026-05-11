use crate::{
    config::{load_services, load_services_from_path, persist_services},
    logs::read_log_tail,
    process_manager::{
        start_service_from_config, stop_service_inner, sync_discovered_processes,
    },
    types::{
        BatchServiceItemResult, BatchServiceResult, ImportServicesResult, ServiceConfig,
        ServiceManager, ServiceView, WindowBehaviorState,
    },
    window_ops,
};
use std::{collections::HashSet, path::PathBuf};
use tauri::{AppHandle, State, Window};

fn unique_ids(ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut ordered = Vec::new();

    for id in ids {
        if seen.insert(id.clone()) {
            ordered.push(id);
        }
    }

    ordered
}

fn is_tracked_running(manager: &ServiceManager, id: &str) -> Result<bool, String> {
    let processes = manager
        .processes
        .lock()
        .map_err(|_| "进程状态锁被污染。".to_string())?;
    Ok(processes.contains_key(id))
}

#[tauri::command]
pub(crate) fn list_services(
    app: AppHandle,
    manager: State<'_, ServiceManager>,
    scan_processes: Option<bool>,
) -> Result<Vec<ServiceView>, String> {
    let services = load_services(&app)?;
    if scan_processes.unwrap_or(false) {
        sync_discovered_processes(manager.inner(), &services)?;
    }
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
                group_name: svc.group_name,
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
pub(crate) fn import_services(
    app: AppHandle,
    path: String,
) -> Result<ImportServicesResult, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("导入路径不能为空。".to_string());
    }
    let import_path = PathBuf::from(trimmed_path);

    let mut current_services = load_services(&app)?;
    let imported_services = load_services_from_path(&import_path)?;

    let mut deduped_imports = Vec::new();
    for imported in imported_services {
        if let Some(index) = deduped_imports
            .iter()
            .position(|service: &ServiceConfig| service.id == imported.id)
        {
            deduped_imports[index] = imported;
        } else {
            deduped_imports.push(imported);
        }
    }

    let imported_count = deduped_imports.len();
    let mut added_count = 0usize;
    let mut updated_count = 0usize;

    for imported in deduped_imports {
        if let Some(index) = current_services.iter().position(|service| service.id == imported.id) {
            current_services[index] = imported;
            updated_count += 1;
        } else {
            current_services.push(imported);
            added_count += 1;
        }
    }

    persist_services(&app, &current_services)?;

    Ok(ImportServicesResult {
        imported_count,
        added_count,
        updated_count,
        total_count: current_services.len(),
        services: current_services,
    })
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
    stop_service_inner(manager.inner().clone(), id.clone())?;
    start_service(app, manager, id)
}

#[tauri::command]
pub(crate) fn start_services(
    app: AppHandle,
    manager: State<'_, ServiceManager>,
    ids: Vec<String>,
) -> Result<BatchServiceResult, String> {
    let services = load_services(&app)?;
    let ids = unique_ids(ids);
    let mut succeeded_count = 0usize;
    let mut failed_count = 0usize;
    let mut items = Vec::with_capacity(ids.len());

    for id in &ids {
        let Some(service) = services.iter().find(|service| service.id == *id) else {
            failed_count += 1;
            items.push(BatchServiceItemResult {
                id: id.clone(),
                status: "error".to_string(),
                pid: None,
                error: Some(format!("找不到服务: {id}")),
            });
            continue;
        };

        if !service.enabled {
            failed_count += 1;
            items.push(BatchServiceItemResult {
                id: id.clone(),
                status: "error".to_string(),
                pid: None,
                error: Some(format!("服务已禁用: {}", service.name)),
            });
            continue;
        }

        match start_service_from_config(&app, manager.inner().clone(), service.clone()) {
            Ok(pid) => {
                succeeded_count += 1;
                items.push(BatchServiceItemResult {
                    id: id.clone(),
                    status: "success".to_string(),
                    pid: Some(pid),
                    error: None,
                });
            }
            Err(error) => {
                failed_count += 1;
                items.push(BatchServiceItemResult {
                    id: id.clone(),
                    status: "error".to_string(),
                    pid: None,
                    error: Some(error),
                });
            }
        }
    }

    Ok(BatchServiceResult {
        requested_count: ids.len(),
        succeeded_count,
        failed_count,
        skipped_count: 0,
        items,
    })
}

#[tauri::command]
pub(crate) fn stop_services(
    manager: State<'_, ServiceManager>,
    ids: Vec<String>,
) -> Result<BatchServiceResult, String> {
    let ids = unique_ids(ids);
    let mut succeeded_count = 0usize;
    let mut failed_count = 0usize;
    let mut skipped_count = 0usize;
    let mut items = Vec::with_capacity(ids.len());

    for id in &ids {
        let was_running = is_tracked_running(manager.inner(), id)?;
        match stop_service_inner(manager.inner().clone(), id.clone()) {
            Ok(()) if was_running => {
                succeeded_count += 1;
                items.push(BatchServiceItemResult {
                    id: id.clone(),
                    status: "success".to_string(),
                    pid: None,
                    error: None,
                });
            }
            Ok(()) => {
                skipped_count += 1;
                items.push(BatchServiceItemResult {
                    id: id.clone(),
                    status: "skipped".to_string(),
                    pid: None,
                    error: None,
                });
            }
            Err(error) => {
                failed_count += 1;
                items.push(BatchServiceItemResult {
                    id: id.clone(),
                    status: "error".to_string(),
                    pid: None,
                    error: Some(error),
                });
            }
        }
    }

    Ok(BatchServiceResult {
        requested_count: ids.len(),
        succeeded_count,
        failed_count,
        skipped_count,
        items,
    })
}

#[tauri::command]
pub(crate) fn restart_services(
    app: AppHandle,
    manager: State<'_, ServiceManager>,
    ids: Vec<String>,
) -> Result<BatchServiceResult, String> {
    let services = load_services(&app)?;
    let ids = unique_ids(ids);
    let mut succeeded_count = 0usize;
    let mut failed_count = 0usize;
    let mut items = Vec::with_capacity(ids.len());

    for id in &ids {
        let Some(service) = services.iter().find(|service| service.id == *id) else {
            failed_count += 1;
            items.push(BatchServiceItemResult {
                id: id.clone(),
                status: "error".to_string(),
                pid: None,
                error: Some(format!("找不到服务: {id}")),
            });
            continue;
        };

        if !service.enabled {
            failed_count += 1;
            items.push(BatchServiceItemResult {
                id: id.clone(),
                status: "error".to_string(),
                pid: None,
                error: Some(format!("服务已禁用: {}", service.name)),
            });
            continue;
        }

        if let Err(error) = stop_service_inner(manager.inner().clone(), id.clone()) {
            failed_count += 1;
            items.push(BatchServiceItemResult {
                id: id.clone(),
                status: "error".to_string(),
                pid: None,
                error: Some(error),
            });
            continue;
        }

        match start_service_from_config(&app, manager.inner().clone(), service.clone()) {
            Ok(pid) => {
                succeeded_count += 1;
                items.push(BatchServiceItemResult {
                    id: id.clone(),
                    status: "success".to_string(),
                    pid: Some(pid),
                    error: None,
                });
            }
            Err(error) => {
                failed_count += 1;
                items.push(BatchServiceItemResult {
                    id: id.clone(),
                    status: "error".to_string(),
                    pid: None,
                    error: Some(error),
                });
            }
        }
    }

    Ok(BatchServiceResult {
        requested_count: ids.len(),
        succeeded_count,
        failed_count,
        skipped_count: 0,
        items,
    })
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

#[tauri::command]
pub(crate) fn set_close_to_tray(
    state: State<'_, WindowBehaviorState>,
    enabled: bool,
) -> Result<(), String> {
    let mut close_to_tray = state
        .close_to_tray
        .lock()
        .map_err(|_| "关闭行为状态锁被污染。".to_string())?;
    *close_to_tray = enabled;
    Ok(())
}
