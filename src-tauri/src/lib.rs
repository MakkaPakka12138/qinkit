mod commands;
mod config;
mod logs;
mod process_manager;
mod types;
mod window_ops;

use tauri::Manager;

use process_manager::auto_start_services;
use types::ServiceManager;

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
            commands::window_start_dragging
        ])
        .run(tauri::generate_context!())
        .expect("error while running lite service manager");
}
