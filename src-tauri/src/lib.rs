mod commands;
mod config;
mod logs;
mod process_manager;
mod types;
mod window_ops;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

use process_manager::auto_start_services;
use types::{ServiceManager, WindowBehaviorState};

const TRAY_SHOW_ID: &str = "tray_show";
const TRAY_EXIT_ID: &str = "tray_exit";

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn close_to_tray_enabled(app: &AppHandle) -> bool {
    app.state::<WindowBehaviorState>()
        .close_to_tray
        .lock()
        .map(|value| *value)
        .unwrap_or(true)
}

fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let show_item =
        MenuItem::with_id(app, TRAY_SHOW_ID, "显示主窗口", true, None::<&str>)
            .map_err(|err| format!("创建托盘菜单失败: {err}"))?;
    let exit_item =
        MenuItem::with_id(app, TRAY_EXIT_ID, "退出程序", true, None::<&str>)
            .map_err(|err| format!("创建托盘菜单失败: {err}"))?;
    let menu = Menu::with_items(app, &[&show_item, &exit_item])
        .map_err(|err| format!("创建托盘菜单失败: {err}"))?;

    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("轻启·服务管理器")
        .show_menu_on_left_click(false)
        .on_menu_event(|app: &AppHandle, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_EXIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event: TrayIconEvent| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(&tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder
        .build(app)
        .map_err(|err| format!("创建系统托盘失败: {err}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServiceManager::default())
        .manage(WindowBehaviorState::default())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if close_to_tray_enabled(&window.app_handle()) {
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            let manager = app.state::<ServiceManager>().inner().clone();
            auto_start_services(&app.handle(), manager);
            setup_tray(&app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_services,
            commands::save_services,
            commands::start_service,
            commands::stop_service,
            commands::restart_service,
            commands::read_log,
            commands::open_path,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::window_start_dragging,
            commands::set_close_to_tray
        ])
        .run(tauri::generate_context!())
        .expect("error while running lite service manager");
}
