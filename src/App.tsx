import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";

type ServiceConfig = {
  id: string;
  name: string;
  command: string;
  cwd: string;
  enabled: boolean;
  auto_start: boolean;
  auto_restart: boolean;
  restart_delay_seconds: number;
  stdout_log: string;
  stderr_log: string;
};

type ServiceView = ServiceConfig & {
  running: boolean;
  pid: number | null;
};

type LogType = "stdout" | "stderr";

const appWindow = getCurrentWindow();

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function toServiceConfig(service: ServiceConfig | ServiceView): ServiceConfig {
  const { id, name, command, cwd, enabled, auto_start, auto_restart, restart_delay_seconds, stdout_log, stderr_log } =
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
    stdout_log,
    stderr_log
  };
}

function buildDefaultLogPath(cwd: string, id: string, stream: "out" | "err") {
  const root = cwd.trim().replace(/[\\/]+$/, "");
  if (!root) return "";
  return `${root}\\logs\\${id}.${stream}.log`;
}

function blankForm(): ServiceConfig {
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
    stdout_log: "",
    stderr_log: ""
  };
}

function normalizeService(input: ServiceConfig): ServiceConfig {
  const id = input.id.trim() || `svc_${Date.now()}`;
  return {
    ...input,
    id,
    name: input.name.trim() || id,
    command: input.command.trim(),
    cwd: input.cwd.trim(),
    stdout_log: input.stdout_log.trim(),
    stderr_log: input.stderr_log.trim(),
    restart_delay_seconds: Math.max(1, Number(input.restart_delay_seconds || 3))
  };
}

export default function App() {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const servicesRef = useRef<ServiceView[]>([]);
  const selectedIdRef = useRef("");
  const logServiceIdRef = useRef("");
  const activeLogTypeRef = useRef<LogType>("stdout");
  const noticeTimerRef = useRef<number | undefined>(undefined);

  const [services, setServices] = useState<ServiceView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorText, setErrorText] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingSourceId, setEditingSourceId] = useState("");
  const [form, setForm] = useState<ServiceConfig>(() => blankForm());
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logServiceId, setLogServiceId] = useState("");
  const [activeLogType, setActiveLogType] = useState<LogType>("stdout");
  const [logText, setLogText] = useState("");
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 80, y: 80 });
  const [glowVisible, setGlowVisible] = useState(false);

  const logService = useMemo(
    () => services.find((service) => service.id === logServiceId) ?? null,
    [services, logServiceId]
  );
  const runningCount = useMemo(() => services.filter((service) => service.running).length, [services]);
  const enabledCount = useMemo(() => services.filter((service) => service.enabled).length, [services]);
  const activeLogPath = useMemo(() => {
    if (!logService) return "";
    return activeLogType === "stdout" ? logService.stdout_log : logService.stderr_log;
  }, [activeLogType, logService]);

  useEffect(() => {
    servicesRef.current = services;
  }, [services]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    logServiceIdRef.current = logServiceId;
  }, [logServiceId]);

  useEffect(() => {
    activeLogTypeRef.current = activeLogType;
  }, [activeLogType]);

  useEffect(() => {
    void refresh(true);

    const refreshTimer = window.setInterval(() => {
      void refresh(true);
    }, 5000);

    let unlistenResize: (() => void) | undefined;

    void appWindow.isMaximized().then(setWindowMaximized).catch(() => undefined);
    void appWindow.onResized(async () => {
      try {
        setWindowMaximized(await appWindow.isMaximized());
      } catch {
        // ignore window sync failures
      }
    }).then((fn) => {
      unlistenResize = fn;
    });

    return () => {
      window.clearInterval(refreshTimer);
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
      unlistenResize?.();
    };
  }, []);

  useEffect(() => {
    if (!logModalOpen || !logServiceId) return undefined;

    void readActiveLog();
    const timer = window.setInterval(() => {
      void readActiveLog();
    }, 1200);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeLogType, logModalOpen, logServiceId]);

  const cursorGlowStyle = {
    transform: `translate(${mousePosition.x - 44}px, ${mousePosition.y - 44}px)`
  } as React.CSSProperties;

  function flash(message: string, isError = false) {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }

    if (isError) {
      setErrorText(message);
      setNotice("");
    } else {
      setNotice(message);
      setErrorText("");
    }

    noticeTimerRef.current = window.setTimeout(() => {
      if (isError) {
        setErrorText((current) => (current === message ? "" : current));
      } else {
        setNotice((current) => (current === message ? "" : current));
      }
    }, 3200);
  }

  async function refresh(quiet = false) {
    try {
      const list = await invoke<ServiceView[]>("list_services");
      setServices(list);

      const currentSelectedId = selectedIdRef.current;
      if (!currentSelectedId && list.length > 0) {
        setSelectedId(list[0].id);
      } else if (currentSelectedId && !list.some((item) => item.id === currentSelectedId)) {
        setSelectedId(list[0]?.id ?? "");
      }

      const currentLogServiceId = logServiceIdRef.current;
      if (currentLogServiceId && !list.some((item) => item.id === currentLogServiceId)) {
        setLogModalOpen(false);
        setLogServiceId("");
        setLogText("");
      }
    } catch (error) {
      if (!quiet) {
        flash(String(error), true);
      }
    }
  }

  function updateFormField<K extends keyof ServiceConfig>(key: K, value: ServiceConfig[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectService(service: ServiceView) {
    setSelectedId(service.id);
  }

  function openCreateModal() {
    const next = blankForm();
    setEditorMode("create");
    setEditingSourceId("");
    setForm(next);
    setEditorOpen(true);
  }

  function openEditModal(service: ServiceView) {
    setSelectedId(service.id);
    setEditorMode("edit");
    setEditingSourceId(service.id);
    setForm(toServiceConfig(service));
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
  }

  function applyLogPaths() {
    setForm((current) => {
      const nextId = current.id.trim() || `svc_${Date.now()}`;
      return {
        ...current,
        id: nextId,
        stdout_log: buildDefaultLogPath(current.cwd, nextId, "out"),
        stderr_log: buildDefaultLogPath(current.cwd, nextId, "err")
      };
    });
  }

  async function saveCurrent() {
    setBusy(true);
    try {
      const item = normalizeService(form);
      if (!item.command) {
        throw new Error("启动命令不能为空。");
      }

      const pureServices = servicesRef.current.map((service) => toServiceConfig(service));
      const withoutSource = editingSourceId
        ? pureServices.filter((service) => service.id !== editingSourceId)
        : pureServices;
      const index = withoutSource.findIndex((service) => service.id === item.id);

      if (index >= 0) {
        withoutSource[index] = item;
      } else {
        withoutSource.push(item);
      }

      await invoke("save_services", { services: withoutSource });
      setSelectedId(item.id);
      setEditorOpen(false);
      await refresh(true);
      flash(editorMode === "create" ? "服务已新增。" : "服务已更新。");
    } catch (error) {
      flash(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function startService(id: string) {
    setBusy(true);
    try {
      await invoke("start_service", { id });
      await refresh(true);
      flash("服务已启动。");
    } catch (error) {
      flash(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function stopService(id: string) {
    setBusy(true);
    try {
      await invoke("stop_service", { id });
      await refresh(true);
      flash("服务已停止。");
    } catch (error) {
      flash(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function toggleService(service: ServiceView) {
    if (service.running) {
      await stopService(service.id);
    } else {
      await startService(service.id);
    }
  }

  async function startAll() {
    const enabledServices = servicesRef.current.filter((service) => service.enabled);
    if (enabledServices.length === 0) {
      flash("没有可启动的已启用服务。", true);
      return;
    }

    setBusy(true);
    try {
      for (const service of enabledServices) {
        try {
          await invoke("start_service", { id: service.id });
        } catch {
          // keep starting the rest
        }
      }

      await refresh(true);
      flash("已执行一键启动。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteService(id: string) {
    const service = servicesRef.current.find((item) => item.id === id);
    if (!service) return;

    if (service.running) {
      flash("请先停止服务后再删除。", true);
      return;
    }

    const confirmed = await confirm(`删除服务“${service.name}”？`, {
      title: "删除服务",
      kind: "warning"
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const nextServices = servicesRef.current
        .filter((item) => item.id !== id)
        .map((item) => toServiceConfig(item));
      await invoke("save_services", { services: nextServices });

      if (selectedIdRef.current === id) {
        setSelectedId(nextServices[0]?.id ?? "");
      }
      if (logServiceIdRef.current === id) {
        setLogModalOpen(false);
        setLogServiceId("");
        setLogText("");
      }

      await refresh(true);
      flash("服务已删除。");
    } catch (error) {
      flash(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function openPath(path: string) {
    if (!path.trim()) return;
    try {
      await invoke("open_path", { path });
    } catch (error) {
      flash(String(error), true);
    }
  }

  async function readActiveLog() {
    const target = servicesRef.current.find((service) => service.id === logServiceIdRef.current);
    if (!target) {
      setLogText("服务不存在或已被删除。");
      return;
    }

    const logPath =
      activeLogTypeRef.current === "stdout" ? target.stdout_log.trim() : target.stderr_log.trim();
    if (!logPath) {
      setLogText("当前未配置日志路径。");
      return;
    }

    try {
      const content = await invoke<string>("read_log", { path: logPath, maxLines: 600 });
      setLogText(content || "日志文件为空。");
    } catch (error) {
      setLogText(String(error));
    }
  }

  function openLogModal(service: ServiceView, type: LogType = "stdout") {
    setSelectedId(service.id);
    setLogServiceId(service.id);
    setActiveLogType(type);
    setLogText("");
    setLogModalOpen(true);
  }

  function closeLogModal() {
    setLogModalOpen(false);
  }

  async function pickDirectory() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "选择工作目录",
      defaultPath: form.cwd || undefined
    });

    if (typeof picked !== "string" || !picked) return;

    setForm((current) => {
      const nextId = current.id.trim() || `svc_${Date.now()}`;
      return {
        ...current,
        id: nextId,
        cwd: picked,
        stdout_log: current.stdout_log || buildDefaultLogPath(picked, nextId, "out"),
        stderr_log: current.stderr_log || buildDefaultLogPath(picked, nextId, "err")
      };
    });
  }

  async function pickLogFile(target: "stdout_log" | "stderr_log") {
    const fallbackName = `${form.id.trim() || "service"}.${target === "stdout_log" ? "out" : "err"}.log`;
    const picked = await save({
      title: target === "stdout_log" ? "选择 stdout 日志文件" : "选择 stderr 日志文件",
      defaultPath:
        form[target] || (form.cwd ? `${form.cwd.replace(/[\\/]+$/, "")}\\logs\\${fallbackName}` : fallbackName),
      filters: [{ name: "Log", extensions: ["log", "txt"] }]
    });

    if (!picked) return;
    updateFormField(target, picked);
  }

  async function toggleWindowMaximize() {
    try {
      const next = await invoke<boolean>("window_toggle_maximize");
      setWindowMaximized(next);
    } catch {
      // ignore
    }
  }

  async function minimizeWindow() {
    try {
      await invoke("window_minimize");
    } catch {
      // ignore
    }
  }

  async function closeWindow() {
    try {
      await invoke("window_close");
    } catch {
      // ignore
    }
  }

  async function handleTitlebarMouseDown(event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) {
      return;
    }

    try {
      event.preventDefault();
      await invoke("window_start_dragging");
    } catch {
      // ignore
    }
  }

  async function handleTitlebarDoubleClick(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) {
      return;
    }

    try {
      await toggleWindowMaximize();
    } catch {
      // ignore
    }
  }

  function handleWorkspacePointerMove(event: React.MouseEvent<HTMLElement>) {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return;

    setMousePosition({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
  }

  return (
    <main ref={shellRef} className="shell">
      <div className="app-frame">
        <header
          className="titlebar"
          data-tauri-drag-region=""
          onMouseDownCapture={(event) => {
            void handleTitlebarMouseDown(event);
          }}
          onDoubleClickCapture={(event) => {
            void handleTitlebarDoubleClick(event);
          }}
        >
          <div className="titlebar__drag">
            <div className="brand-mark">轻</div>
            <div className="brand-copy">
              <strong>轻启服务管理器</strong>
              <span>PowerShell Service Runner</span>
            </div>
          </div>

          <div className="window-actions">
            <button type="button" className="window-btn" onClick={() => void minimizeWindow()}>
              _
            </button>
            <button type="button" className="window-btn" onClick={() => void toggleWindowMaximize()}>
              {windowMaximized ? "❐" : "□"}
            </button>
            <button type="button" className="window-btn danger" onClick={() => void closeWindow()}>
              ×
            </button>
          </div>
        </header>

        <section
          ref={workspaceRef}
          className="workspace"
          onMouseMove={handleWorkspacePointerMove}
          onMouseEnter={() => setGlowVisible(true)}
          onMouseLeave={() => setGlowVisible(false)}
        >
          <div className={`cursor-glow${glowVisible ? " is-visible" : ""}`} style={cursorGlowStyle} />
          <section className="action-panel">
            <div className="action-strip">
              <div className="stats-bar">
                <span>{services.length} 个服务</span>
                <span>{runningCount} 运行中</span>
                <span>{enabledCount} 已启用</span>
              </div>
              <div className="action-strip__buttons">
                <button type="button" className="ghost soft" disabled={busy} onClick={() => void refresh(false)}>
                  刷新
                </button>
                <button type="button" className="primary" disabled={busy} onClick={openCreateModal}>
                  新增
                </button>
                <button type="button" className="primary alt" disabled={busy} onClick={() => void startAll()}>
                  一键启动
                </button>
              </div>
            </div>

            {notice ? <div className="notice notice--good">{notice}</div> : null}
            {errorText ? <div className="notice notice--bad">{errorText}</div> : null}
          </section>

          <section className="board">
            <div className="board__head">
              <div>
                <h2>服务列表</h2>
                <p>点击行查看状态，编辑与新增使用弹窗，日志窗口自动跟随最新输出。</p>
              </div>
            </div>

            <div className="service-list">
              {services.length === 0 ? (
                <div className="empty">还没有服务，先从上面的新增开始。</div>
              ) : null}

              {services.map((service) => (
                <article
                  key={service.id}
                  className={`service-row${selectedId === service.id ? " is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="service-row__main"
                    onClick={() => selectService(service)}
                  >
                    <div className="service-row__title">
                      <strong>{service.name}</strong>
                      <span className={`state${service.running ? " running" : ""}`}>
                        {service.running ? `运行中 #${service.pid ?? "-"}` : "未运行"}
                      </span>
                    </div>
                    <span className="service-row__meta">{service.command || "未配置启动命令"}</span>
                    <span className="service-row__sub">
                      {service.cwd || "未配置工作目录"} · {service.enabled ? "已启用" : "已禁用"}
                    </span>
                  </button>

                  <div className="service-row__actions">
                    <button type="button" disabled={busy} onClick={() => openEditModal(service)}>
                      编辑
                    </button>
                    <button type="button" disabled={busy} onClick={() => void toggleService(service)}>
                      {service.running ? "停止" : "启动"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => openLogModal(service)}>
                      日志
                    </button>
                    <button
                      type="button"
                      className="danger-text"
                      disabled={busy}
                      onClick={() => void deleteService(service.id)}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>

      {editorOpen ? (
        <div className="modal-mask" onClick={closeEditor}>
          <section className="modal modal--editor" onClick={(event) => event.stopPropagation()}>
            <div className="modal__head">
              <div>
                <h3>{editorMode === "create" ? "新增服务" : "编辑服务"}</h3>
                <p>启动命令会通过 PowerShell 运行。</p>
              </div>
              <button type="button" className="ghost icon-btn" title="关闭" aria-label="关闭" onClick={closeEditor}>
                <Icon path="M6 6l12 12M18 6L6 18" />
              </button>
            </div>

            <div className="form-grid">
              <label>
                <span>服务 ID</span>
                <input value={form.id} onChange={(event) => updateFormField("id", event.target.value)} placeholder="backend" />
              </label>

              <label>
                <span>显示名称</span>
                <input value={form.name} onChange={(event) => updateFormField("name", event.target.value)} placeholder="ERP 后端" />
              </label>

              <label className="wide">
                <span>启动命令</span>
                <textarea
                  rows={4}
                  value={form.command}
                  onChange={(event) => updateFormField("command", event.target.value)}
                  placeholder="python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
                />
              </label>

              <label className="wide">
                <span>工作目录</span>
                <div className="field-actions">
                  <input value={form.cwd} onChange={(event) => updateFormField("cwd", event.target.value)} placeholder="E:\\project\\backend" />
                  <button type="button" className="icon-btn" title="选择目录" aria-label="选择目录" onClick={() => void pickDirectory()}>
                    <Icon path="M4 7.5h5l2 2H20v7.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7.5V6a2 2 0 0 1 2-2h3l2 2" />
                  </button>
                  <button type="button" className="icon-btn" title="生成日志路径" aria-label="生成日志路径" onClick={applyLogPaths}>
                    <Icon path="M12 3l1.8 4.7L19 9.5l-4 3.2 1.2 5.3L12 15.2 7.8 18l1.2-5.3-4-3.2 5.2-1.8z" />
                  </button>
                  <button type="button" className="icon-btn" title="打开目录" aria-label="打开目录" disabled={!form.cwd.trim()} onClick={() => void openPath(form.cwd)}>
                    <Icon path="M14 5h5v5M10 14 19 5M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
                  </button>
                </div>
              </label>

              <label className="wide">
                <span>stdout 日志</span>
                <div className="field-actions">
                  <input value={form.stdout_log} onChange={(event) => updateFormField("stdout_log", event.target.value)} placeholder="E:\\project\\backend\\logs\\backend.out.log" />
                  <button type="button" className="icon-btn" title="选择 stdout 日志" aria-label="选择 stdout 日志" onClick={() => void pickLogFile("stdout_log")}>
                    <Icon path="M4 7.5h5l2 2H20v7.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7.5V6a2 2 0 0 1 2-2h3l2 2" />
                  </button>
                  <button type="button" className="icon-btn" title="打开 stdout 日志" aria-label="打开 stdout 日志" disabled={!form.stdout_log.trim()} onClick={() => void openPath(form.stdout_log)}>
                    <Icon path="M14 5h5v5M10 14 19 5M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
                  </button>
                </div>
              </label>

              <label className="wide">
                <span>stderr 日志</span>
                <div className="field-actions">
                  <input value={form.stderr_log} onChange={(event) => updateFormField("stderr_log", event.target.value)} placeholder="E:\\project\\backend\\logs\\backend.err.log" />
                  <button type="button" className="icon-btn" title="选择 stderr 日志" aria-label="选择 stderr 日志" onClick={() => void pickLogFile("stderr_log")}>
                    <Icon path="M4 7.5h5l2 2H20v7.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7.5V6a2 2 0 0 1 2-2h3l2 2" />
                  </button>
                  <button type="button" className="icon-btn" title="打开 stderr 日志" aria-label="打开 stderr 日志" disabled={!form.stderr_log.trim()} onClick={() => void openPath(form.stderr_log)}>
                    <Icon path="M14 5h5v5M10 14 19 5M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
                  </button>
                </div>
              </label>

              <label>
                <span>重启延迟 / 秒</span>
                <input
                  type="number"
                  min={1}
                  value={form.restart_delay_seconds}
                  onChange={(event) => updateFormField("restart_delay_seconds", Number(event.target.value))}
                />
              </label>

              <div className="checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => updateFormField("enabled", event.target.checked)}
                  />
                  启用
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.auto_start}
                    onChange={(event) => updateFormField("auto_start", event.target.checked)}
                  />
                  打开软件后自动启动
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.auto_restart}
                    onChange={(event) => updateFormField("auto_restart", event.target.checked)}
                  />
                  异常退出自动重启
                </label>
              </div>
            </div>

            <div className="modal__foot">
              <button type="button" className="ghost icon-btn" title="取消" aria-label="取消" onClick={closeEditor}>
                <Icon path="M6 6l12 12M18 6L6 18" />
              </button>
              <button type="button" className="primary icon-btn" title="保存" aria-label="保存" disabled={busy} onClick={() => void saveCurrent()}>
                <Icon path="M5 5h11l3 3v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM8 5v5h8M8 19v-6h8v6" />
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {logModalOpen ? (
        <div className="modal-mask" onClick={closeLogModal}>
          <section className="modal modal--log" onClick={(event) => event.stopPropagation()}>
            <div className="modal__head">
              <div>
                <h3>{logService?.name ?? "日志"}</h3>
                <p>{activeLogPath || "当前没有日志路径"}</p>
              </div>
              <button type="button" className="ghost" onClick={closeLogModal}>
                关闭
              </button>
            </div>

            <div className="log-toolbar">
              <button
                type="button"
                className={activeLogType === "stdout" ? "primary" : ""}
                onClick={() => setActiveLogType("stdout")}
              >
                stdout
              </button>
              <button
                type="button"
                className={activeLogType === "stderr" ? "primary" : ""}
                onClick={() => setActiveLogType("stderr")}
              >
                stderr
              </button>
              <button type="button" onClick={() => void readActiveLog()}>
                刷新
              </button>
              <button type="button" disabled={!activeLogPath} onClick={() => void openPath(activeLogPath)}>
                打开位置
              </button>
              <span className="log-follow">实时跟随中</span>
            </div>

            <pre className="log-view">{logText || "等待日志输出..."}</pre>
          </section>
        </div>
      ) : null}
    </main>
  );
}
