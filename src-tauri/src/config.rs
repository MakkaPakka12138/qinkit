use crate::types::ServiceConfig;
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DATABASE_FILE_NAME: &str = "services.db";

pub(crate) fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("获取应用数据目录失败: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("创建应用数据目录失败: {err}"))?;
    Ok(dir)
}

pub(crate) fn database_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(DATABASE_FILE_NAME))
}

pub(crate) fn load_services(app: &AppHandle) -> Result<Vec<ServiceConfig>, String> {
    load_services_from_db_path(database_file(app)?)
}

pub(crate) fn persist_services(app: &AppHandle, services: &[ServiceConfig]) -> Result<(), String> {
    persist_services_to_db_path(database_file(app)?, services)
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

fn open_database(path: impl AsRef<Path>) -> Result<Connection, String> {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("创建数据库目录失败 {}: {err}", parent.display()))?;
    }

    let connection = Connection::open(path)
        .map_err(|err| format!("打开 SQLite 数据库失败 {}: {err}", path.display()))?;
    ensure_schema(&connection)?;
    Ok(connection)
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS services (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                group_name TEXT NOT NULL DEFAULT '',
                command TEXT NOT NULL,
                cwd TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                auto_start INTEGER NOT NULL,
                auto_restart INTEGER NOT NULL,
                restart_delay_seconds INTEGER NOT NULL,
                log_dir TEXT NOT NULL DEFAULT '',
                stdout_log TEXT NOT NULL DEFAULT '',
                stderr_log TEXT NOT NULL DEFAULT '',
                sort_index INTEGER NOT NULL DEFAULT 0
            );
            ",
        )
        .map_err(|err| format!("初始化 SQLite 表失败: {err}"))?;

    let columns = connection
        .prepare("PRAGMA table_info(services)")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(|err| format!("读取 SQLite 表结构失败: {err}"))?;

    if !columns.iter().any(|column| column == "group_name") {
        connection
            .execute(
                "ALTER TABLE services ADD COLUMN group_name TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|err| format!("升级 SQLite 表结构失败: {err}"))?;
    }

    if !columns.iter().any(|column| column == "sort_index") {
        connection
            .execute(
                "ALTER TABLE services ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|err| format!("升级 SQLite 表结构失败: {err}"))?;
    }

    Ok(())
}

fn row_to_service(row: &rusqlite::Row<'_>) -> rusqlite::Result<ServiceConfig> {
    Ok(normalize_loaded_service(ServiceConfig {
        id: row.get(0)?,
        name: row.get(1)?,
        group_name: row.get(2)?,
        command: row.get(3)?,
        cwd: row.get(4)?,
        enabled: row.get::<_, i64>(5)? != 0,
        auto_start: row.get::<_, i64>(6)? != 0,
        auto_restart: row.get::<_, i64>(7)? != 0,
        restart_delay_seconds: row.get(8)?,
        log_dir: row.get(9)?,
        stdout_log: row.get(10)?,
        stderr_log: row.get(11)?,
    }))
}

fn load_services_from_db_path(path: impl AsRef<Path>) -> Result<Vec<ServiceConfig>, String> {
    let connection = open_database(path)?;
    let mut statement = connection
        .prepare(
            "
            SELECT
                id,
                name,
                group_name,
                command,
                cwd,
                enabled,
                auto_start,
                auto_restart,
                restart_delay_seconds,
                log_dir,
                stdout_log,
                stderr_log
            FROM services
            ORDER BY sort_index ASC, id ASC
            ",
        )
        .map_err(|err| format!("查询服务列表失败: {err}"))?;

    statement
        .query_map([], row_to_service)
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|err| format!("读取服务列表失败: {err}"))
}

fn load_service_by_id(connection: &Connection, id: &str) -> Result<Option<ServiceConfig>, String> {
    connection
        .query_row(
            "
            SELECT
                id,
                name,
                group_name,
                command,
                cwd,
                enabled,
                auto_start,
                auto_restart,
                restart_delay_seconds,
                log_dir,
                stdout_log,
                stderr_log
            FROM services
            WHERE id = ?1
            ",
            [id],
            row_to_service,
        )
        .optional()
        .map_err(|err| format!("查询服务失败: {err}"))
}

fn persist_services_to_db_path(
    path: impl AsRef<Path>,
    services: &[ServiceConfig],
) -> Result<(), String> {
    let mut connection = open_database(path)?;
    let transaction = connection
        .transaction()
        .map_err(|err| format!("开启 SQLite 事务失败: {err}"))?;

    transaction
        .execute("DELETE FROM services", [])
        .map_err(|err| format!("清空旧服务数据失败: {err}"))?;

    {
        let mut statement = transaction
            .prepare(
                "
                INSERT INTO services (
                    id,
                    name,
                    group_name,
                    command,
                    cwd,
                    enabled,
                    auto_start,
                    auto_restart,
                    restart_delay_seconds,
                    log_dir,
                    stdout_log,
                    stderr_log,
                    sort_index
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                ",
            )
            .map_err(|err| format!("准备写入 SQLite 语句失败: {err}"))?;

        for (index, service) in services.iter().cloned().map(normalize_loaded_service).enumerate() {
            statement
                .execute(params![
                    service.id,
                    service.name,
                    service.group_name,
                    service.command,
                    service.cwd,
                    if service.enabled { 1 } else { 0 },
                    if service.auto_start { 1 } else { 0 },
                    if service.auto_restart { 1 } else { 0 },
                    service.restart_delay_seconds,
                    service.log_dir,
                    service.stdout_log,
                    service.stderr_log,
                    index as i64,
                ])
                .map_err(|err| format!("写入服务配置失败: {err}"))?;
        }
    }

    transaction
        .commit()
        .map_err(|err| format!("提交 SQLite 事务失败: {err}"))
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
    service.group_name = service.group_name.trim().to_string();
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
    let connection = open_database(database_file(app)?)?;
    connection
        .execute(
            "UPDATE services SET stdout_log = ?1, stderr_log = ?2 WHERE id = ?3",
            params![stdout_log, stderr_log, id],
        )
        .map_err(|err| format!("更新服务日志路径失败: {err}"))?;

    load_service_by_id(&connection, id)?.ok_or_else(|| format!("找不到服务: {id}"))
}

#[cfg(test)]
mod tests {
    use super::{
        load_services_from_db_path, load_services_from_path, persist_services_to_db_path,
        ServiceConfig,
    };
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static UNIQUE_ID: AtomicU64 = AtomicU64::new(0);

    fn temp_path(name: &str, extension: &str) -> PathBuf {
        let unique = UNIQUE_ID.fetch_add(1, Ordering::Relaxed);
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_millis();
        std::env::temp_dir().join(format!("lite_service_manager_{name}_{millis}_{unique}.{extension}"))
    }

    fn sample_service(id: &str, group_name: &str) -> ServiceConfig {
        ServiceConfig {
            id: id.to_string(),
            name: format!("Service {id}"),
            group_name: group_name.to_string(),
            command: "npm run dev".to_string(),
            cwd: "E:\\workspace\\demo".to_string(),
            enabled: true,
            auto_start: false,
            auto_restart: true,
            restart_delay_seconds: 3,
            log_dir: String::new(),
            stdout_log: String::new(),
            stderr_log: String::new(),
        }
    }

    #[test]
    fn sqlite_round_trip_preserves_group_and_order() {
        let db_path = temp_path("services_round_trip", "db");
        let services = vec![
            sample_service("svc_b", "第二组"),
            sample_service("svc_a", "第一组"),
        ];

        persist_services_to_db_path(&db_path, &services).expect("persist services");
        let loaded = load_services_from_db_path(&db_path).expect("load services");

        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "svc_b");
        assert_eq!(loaded[0].group_name, "第二组");
        assert_eq!(loaded[1].id, "svc_a");
        assert_eq!(loaded[1].group_name, "第一组");

        let _ = fs::remove_file(db_path);
    }

    #[test]
    fn sqlite_load_empty_database_returns_empty_list() {
        let db_path = temp_path("services_empty", "db");
        let loaded = load_services_from_db_path(&db_path).expect("load services");
        assert!(loaded.is_empty());

        let _ = fs::remove_file(db_path);
    }

    #[test]
    fn json_import_normalizes_missing_group_name() {
        let json_path = temp_path("services_import", "json");
        let json = r#"
        [
          {
            "id": "svc_1",
            "name": "ERP",
            "command": "python main.py",
            "cwd": "E:\\project\\erp",
            "enabled": true,
            "auto_start": true,
            "auto_restart": true,
            "restart_delay_seconds": 5,
            "log_dir": "",
            "stdout_log": "",
            "stderr_log": ""
          }
        ]
        "#;
        fs::write(&json_path, json).expect("write import json");

        let loaded = load_services_from_path(&json_path).expect("load import json");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].group_name, "");
        assert_eq!(loaded[0].log_dir, "E:\\project\\erp\\logs");

        let _ = fs::remove_file(json_path);
    }
}
