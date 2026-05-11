use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc, Mutex},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ServiceConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) command: String,
    pub(crate) cwd: String,
    pub(crate) enabled: bool,
    pub(crate) auto_start: bool,
    pub(crate) auto_restart: bool,
    pub(crate) restart_delay_seconds: u64,
    #[serde(default)]
    pub(crate) log_dir: String,
    #[serde(default)]
    pub(crate) stdout_log: String,
    #[serde(default)]
    pub(crate) stderr_log: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ServiceView {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) command: String,
    pub(crate) cwd: String,
    pub(crate) enabled: bool,
    pub(crate) auto_start: bool,
    pub(crate) auto_restart: bool,
    pub(crate) restart_delay_seconds: u64,
    pub(crate) log_dir: String,
    pub(crate) stdout_log: String,
    pub(crate) stderr_log: String,
    pub(crate) running: bool,
    pub(crate) pid: Option<u32>,
}

pub(crate) struct RunningProcess {
    pub(crate) pid: u32,
    pub(crate) stop_requested: Arc<AtomicBool>,
    pub(crate) managed: bool,
}

#[derive(Clone, Default)]
pub(crate) struct ServiceManager {
    pub(crate) processes: Arc<Mutex<HashMap<String, RunningProcess>>>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
pub(crate) struct SystemProcessInfo {
    #[serde(rename = "ProcessId")]
    pub(crate) process_id: u32,
    #[serde(rename = "CommandLine")]
    pub(crate) command_line: Option<String>,
}
