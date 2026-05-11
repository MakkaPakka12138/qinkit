export type ServiceConfig = {
  id: string;
  name: string;
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

export type LogType = "stdout" | "stderr";
export type ThemeMode = "light" | "dark";
