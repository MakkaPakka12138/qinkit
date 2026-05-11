use std::{
    path::Path,
    process::{Command, Stdio},
};
use tauri::Window;

pub(crate) fn open_path(path: String) -> Result<(), String> {
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

pub(crate) fn window_minimize(window: Window) -> Result<(), String> {
    window
        .minimize()
        .map_err(|err| format!("窗口最小化失败: {err}"))
}

pub(crate) fn window_toggle_maximize(window: Window) -> Result<bool, String> {
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

pub(crate) fn window_close(window: Window) -> Result<(), String> {
    window.close().map_err(|err| format!("关闭窗口失败: {err}"))
}

pub(crate) fn window_start_dragging(window: Window) -> Result<(), String> {
    window
        .start_dragging()
        .map_err(|err| format!("窗口拖动失败: {err}"))
}
