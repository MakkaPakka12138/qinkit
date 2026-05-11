import type { ServiceConfig, ServiceForm, ServiceView } from "../types";

export function toServiceConfig(service: ServiceConfig | ServiceView): ServiceConfig {
  const { id, name, group_name, command, cwd, enabled, auto_start, auto_restart, restart_delay_seconds, log_dir, stdout_log, stderr_log } =
    service;
  return {
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
  };
}

export function buildDefaultLogDir(cwd: string) {
  const root = cwd.trim().replace(/[\\/]+$/, "");
  if (!root) return "";
  return `${root}\\logs`;
}

export function blankForm(): ServiceForm {
  const id = `svc_${Date.now()}`;
  return {
    id,
    name: "新服务",
    group_name: "",
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

function normalizeRestartDelaySeconds(value: ServiceForm["restart_delay_seconds"]) {
  if (value === "") {
    return 3;
  }

  return Number.isFinite(value) ? Math.max(1, value) : 3;
}

export function normalizeService(input: ServiceForm): ServiceConfig {
  const id = input.id.trim() || `svc_${Date.now()}`;
  return {
    ...input,
    id,
    name: input.name.trim() || id,
    group_name: input.group_name.trim(),
    command: input.command.trim(),
    cwd: input.cwd.trim(),
    log_dir: input.log_dir.trim(),
    stdout_log: input.stdout_log.trim(),
    stderr_log: input.stderr_log.trim(),
    restart_delay_seconds: normalizeRestartDelaySeconds(input.restart_delay_seconds)
  };
}
