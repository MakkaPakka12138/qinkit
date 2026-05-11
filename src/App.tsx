import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import logoPng from "./assets/logo.png";
import { ActionPanel } from "./components/ActionPanel";
import { LogModal } from "./components/LogModal";
import { ServiceEditorModal } from "./components/ServiceEditorModal";
import { ServiceList } from "./components/ServiceList";
import { Titlebar } from "./components/Titlebar";
import type { LogType, ServiceConfig, ServiceView, ThemeMode } from "./types";
import { blankForm, buildDefaultLogDir, normalizeService, toServiceConfig } from "./utils/service";

const appWindow = getCurrentWindow();
const THEME_STORAGE_KEY = "lite-service-manager-theme";

export default function App() {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const logViewRef = useRef<HTMLPreElement | null>(null);
  const titlebarDragTimerRef = useRef<number | null>(null);
  const servicesRef = useRef<ServiceView[]>([]);
  const logServiceIdRef = useRef("");
  const activeLogTypeRef = useRef<LogType>("stdout");
  const noticeTimerRef = useRef<number | undefined>(undefined);

  const [services, setServices] = useState<ServiceView[]>([]);
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

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
    logServiceIdRef.current = logServiceId;
  }, [logServiceId]);

  useEffect(() => {
    activeLogTypeRef.current = activeLogType;
  }, [activeLogType]);

  useEffect(() => {
    void appWindow.setIcon(logoPng).catch(() => undefined);
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

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

  function openCreateModal() {
    const next = blankForm();
    setEditorMode("create");
    setEditingSourceId("");
    setForm(next);
    setEditorOpen(true);
  }

  function openEditModal(service: ServiceView) {
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
      return {
        ...current,
        log_dir: buildDefaultLogDir(current.cwd)
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

  async function restartService(id: string) {
    setBusy(true);
    try {
      await invoke("restart_service", { id });
      await refresh(true);
      flash("服务已重启。");
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
        log_dir: current.log_dir || buildDefaultLogDir(picked)
      };
    });
  }

  async function pickLogDir() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "选择日志目录",
      defaultPath: form.log_dir || buildDefaultLogDir(form.cwd) || undefined
    });

    if (typeof picked !== "string" || !picked) return;
    updateFormField("log_dir", picked);
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
      await appWindow.hide();
      await appWindow.destroy();
    } catch {
      try {
        await invoke("window_close");
      } catch {
        // ignore
      }
    }
  }

  async function handleTitlebarMouseDown(event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) {
      return;
    }

    if (titlebarDragTimerRef.current) {
      window.clearTimeout(titlebarDragTimerRef.current);
    }

    titlebarDragTimerRef.current = window.setTimeout(() => {
      void invoke("window_start_dragging").catch(() => undefined);
      titlebarDragTimerRef.current = null;
    }, 50);
  }

  async function handleTitlebarDoubleClick(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) {
      return;
    }

    if (titlebarDragTimerRef.current) {
      window.clearTimeout(titlebarDragTimerRef.current);
      titlebarDragTimerRef.current = null;
    }

    try {
      await toggleWindowMaximize();
    } catch {
      // ignore
    }
  }

  function clearPendingTitlebarDrag() {
    if (titlebarDragTimerRef.current) {
      window.clearTimeout(titlebarDragTimerRef.current);
      titlebarDragTimerRef.current = null;
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

  function scrollLogTo(position: "top" | "bottom") {
    const node = logViewRef.current;
    if (!node) return;
    if (position === "top") {
      node.scrollTop = 0;
    } else {
      node.scrollTop = node.scrollHeight;
    }
  }

  function toggleThemeMode() {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
  }

  return (
    <main ref={shellRef} className="shell">
      <div className="app-frame">
        <Titlebar
          themeMode={themeMode}
          windowMaximized={windowMaximized}
          onToggleTheme={toggleThemeMode}
          onMinimize={() => void minimizeWindow()}
          onToggleMaximize={() => void toggleWindowMaximize()}
          onClose={() => void closeWindow()}
          onMouseDownCapture={(event) => {
            void handleTitlebarMouseDown(event);
          }}
          onMouseUpCapture={clearPendingTitlebarDrag}
          onMouseLeave={clearPendingTitlebarDrag}
          onDoubleClickCapture={(event) => {
            void handleTitlebarDoubleClick(event);
          }}
        />

        <section
          ref={workspaceRef}
          className="workspace"
          onMouseMove={handleWorkspacePointerMove}
          onMouseEnter={() => setGlowVisible(true)}
          onMouseLeave={() => setGlowVisible(false)}
        >
          <div className={`cursor-glow${glowVisible ? " is-visible" : ""}`} style={cursorGlowStyle} />
          <ActionPanel
            serviceCount={services.length}
            runningCount={runningCount}
            enabledCount={enabledCount}
            busy={busy}
            notice={notice}
            errorText={errorText}
            onRefresh={() => void refresh(false)}
            onCreate={openCreateModal}
            onStartAll={() => void startAll()}
          />

          <ServiceList
            services={services}
            busy={busy}
            onEdit={openEditModal}
            onToggle={(service) => void toggleService(service)}
            onRestart={(id) => void restartService(id)}
            onOpenLog={openLogModal}
            onDelete={(id) => void deleteService(id)}
          />
        </section>
      </div>

      {editorOpen ? (
        <ServiceEditorModal
          busy={busy}
          editorMode={editorMode}
          form={form}
          onClose={closeEditor}
          onSave={() => void saveCurrent()}
          onUpdateField={updateFormField}
          onApplyLogPaths={applyLogPaths}
          onPickDirectory={() => void pickDirectory()}
          onPickLogDir={() => void pickLogDir()}
          onOpenPath={(path) => void openPath(path)}
        />
      ) : null}

      {logModalOpen ? (
        <LogModal
          logService={logService}
          activeLogPath={activeLogPath}
          activeLogType={activeLogType}
          logText={logText}
          logViewRef={logViewRef}
          onClose={closeLogModal}
          onSetActiveLogType={setActiveLogType}
          onRefresh={() => void readActiveLog()}
          onScrollTo={scrollLogTo}
          onOpenPath={(path) => void openPath(path)}
        />
      ) : null}
    </main>
  );
}
