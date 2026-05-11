import type { ServiceConfig, ServiceView } from "../types";

export function toServiceConfig(service: ServiceConfig | ServiceView): ServiceConfig {
  const { id, name, command, cwd, enabled, auto_start, auto_restart, restart_delay_seconds, log_dir, stdout_log, stderr_log } =
    service;
  return {
    id,
    name,
    command,
    cwd,
    enabled,
    auto_start,
    auto_restart,
    restart_delay_seconds,
    log_dir,
    stdout_log,
    stderr_log
  };
}

export function buildDefaultLogDir(cwd: string) {
  const root = cwd.trim().replace(/[\\/]+$/, "");
  if (!root) return "";
  return `${root}\\logs`;
}

export function blankForm(): ServiceConfig {
  const id = `svc_${Date.now()}`;
  return {
    id,
    name: "新服务",
    command: "",
    cwd: "",
    enabled: true,
    auto_start: false,
    auto_restart: true,
    restart_delay_seconds: 3,
    log_dir: "",
    stdout_log: "",
    stderr_log: ""
  };
}

export function normalizeService(input: ServiceConfig): ServiceConfig {
  const id = input.id.trim() || `svc_${Date.now()}`;
  return {
    ...input,
    id,
    name: input.name.trim() || id,
    command: input.command.trim(),
    cwd: input.cwd.trim(),
    log_dir: input.log_dir.trim(),
    stdout_log: input.stdout_log.trim(),
    stderr_log: input.stderr_log.trim(),
    restart_delay_seconds: Math.max(1, Number(input.restart_delay_seconds || 3))
  };
}
