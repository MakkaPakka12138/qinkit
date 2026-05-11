export type ServiceConfig = {
  id: string;
  name: string;
  group_name: string;
  command: string;
  cwd: string;
  enabled: boolean;
  auto_start: boolean;
  auto_restart: boolean;
  restart_delay_seconds: number;
  log_dir: string;
  stdout_log: string;
  stderr_log: string;
};

export type ServiceView = ServiceConfig & {
  running: boolean;
  pid: number | null;
};

export type ImportServicesResult = {
  imported_count: number;
  added_count: number;
  updated_count: number;
  total_count: number;
  services: ServiceConfig[];
};

export type BatchServiceItemResult = {
  id: string;
  status: string;
  pid: number | null;
  error: string | null;
};

export type BatchServiceResult = {
  requested_count: number;
  succeeded_count: number;
  failed_count: number;
  skipped_count: number;
  items: BatchServiceItemResult[];
};

export type LogType = "stdout" | "stderr";
export type ThemeMode = "light" | "dark";
