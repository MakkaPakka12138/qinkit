import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import logoPng from "./assets/logo.png";
import { ActionPanel } from "./components/ActionPanel";
import { LogModal } from "./components/LogModal";
import { ServiceEditorModal } from "./components/ServiceEditorModal";
import { ServiceList, type ServiceGroupSection } from "./components/ServiceList";
import { Titlebar } from "./components/Titlebar";
import type {
  BatchServiceResult,
  ImportServicesResult,
  LogType,
  MoveDirection,
  ServiceForm,
  ServiceView,
  ThemeMode
} from "./types";
import { blankForm, buildDefaultLogDir, generateServiceId, normalizeService, toServiceConfig } from "./utils/service";

const appWindow = getCurrentWindow();
const THEME_STORAGE_KEY = "lite-service-manager-theme";
const CLOSE_TO_TRAY_STORAGE_KEY = "lite-service-manager-close-to-tray";
const PROCESS_SCAN_BACKOFF_MS = [10_000, 20_000, 30_000, 60_000, 120_000, 300_000];
const LOG_REFRESH_OPTIONS = [
  { key: "off", label: "不刷新", intervalMs: 0 },
  { key: "5s", label: "5s", intervalMs: 5_000 },
  { key: "10s", label: "10s", intervalMs: 10_000 },
  { key: "15s", label: "15s", intervalMs: 15_000 },
  { key: "30s", label: "30s", intervalMs: 30_000 },
  { key: "60s", label: "60s", intervalMs: 60_000 },
  { key: "realtime", label: "实时刷新", intervalMs: 1_200 }
] as const;

type LogRefreshKey = (typeof LOG_REFRESH_OPTIONS)[number]["key"];

type RefreshOptions = {
  quiet?: boolean;
  scanProcesses?: boolean;
};

export default function App() {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const cursorGlowRef = useRef<HTMLDivElement | null>(null);
  const logViewRef = useRef<HTMLPreElement | null>(null);
  const titlebarDragTimerRef = useRef<number | null>(null);
  const servicesRef = useRef<ServiceView[]>([]);
  const logServiceIdRef = useRef("");
  const activeLogTypeRef = useRef<LogType>("stdout");
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const persistedServicesRef = useRef<ServiceView[]>([]);
  const orderSaveTimerRef = useRef<number | undefined>(undefined);
  const orderSaveVersionRef = useRef(0);
  const processScanTimerRef = useRef<number | undefined>(undefined);
  const processScanDelayIndexRef = useRef(0);
  const lastProcessScanSignatureRef = useRef("");

  const [services, setServices] = useState<ServiceView[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingSourceId, setEditingSourceId] = useState("");
  const [form, setForm] = useState<ServiceForm>(() => blankForm());
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logServiceId, setLogServiceId] = useState("");
  const [activeLogType, setActiveLogType] = useState<LogType>("stdout");
  const [logRefreshKey, setLogRefreshKey] = useState<LogRefreshKey>("off");
  const [logText, setLogText] = useState("");
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [workspaceScrollable, setWorkspaceScrollable] = useState(false);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [glowVisible, setGlowVisible] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [closeToTray, setCloseToTray] = useState(() => window.localStorage.getItem(CLOSE_TO_TRAY_STORAGE_KEY) !== "0");

  const logService = useMemo(
    () => services.find((service) => service.id === logServiceId) ?? null,
    [services, logServiceId]
  );
  const activeLogPath = useMemo(() => {
    if (!logService) return "";
    return activeLogType === "stdout" ? logService.stdout_log : logService.stderr_log;
  }, [activeLogType, logService]);
  const activeLogRefreshOption = useMemo(
    () => LOG_REFRESH_OPTIONS.find((option) => option.key === logRefreshKey) ?? LOG_REFRESH_OPTIONS[0],
    [logRefreshKey]
  );
  const selectedServiceIdSet = useMemo(() => new Set(selectedServiceIds), [selectedServiceIds]);
  const selectedCount = selectedServiceIds.length;
  const allSelected = services.length > 0 && selectedCount === services.length;
  const { groupedServices, runningCount } = useMemo(() => {
    const groups = new Map<string, ServiceGroupSection>();
    let runningCount = 0;

    for (const service of services) {
      const key = service.group_name.trim();
      const label = key || "未分组";
      const current =
        groups.get(key) ??
        {
          key,
          label,
          services: [],
          runningCount: 0,
          startableIds: [],
          stoppableIds: []
        };

      current.services.push(service);
      if (service.running) {
        runningCount += 1;
        current.runningCount += 1;
        current.stoppableIds.push(service.id);
      }
      if (service.enabled && !service.running) {
        current.startableIds.push(service.id);
      }

      groups.set(key, current);
    }

    return {
      groupedServices: Array.from(groups.values()),
      runningCount
    };
  }, [services]);

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
    window.localStorage.setItem(CLOSE_TO_TRAY_STORAGE_KEY, closeToTray ? "1" : "0");
    void invoke("set_close_to_tray", { enabled: closeToTray }).catch(() => undefined);
  }, [closeToTray]);

  useEffect(() => {
    void refreshAfterManualAction(true);

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
      clearProcessScanTimer();
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
      if (orderSaveTimerRef.current) {
        window.clearTimeout(orderSaveTimerRef.current);
      }
      unlistenResize?.();
    };
  }, []);

  useEffect(() => {
    if (!logModalOpen || !logServiceId) return undefined;

    void readActiveLog();
    if (activeLogRefreshOption.intervalMs <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void readActiveLog();
    }, activeLogRefreshOption.intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeLogRefreshOption.intervalMs, activeLogType, logModalOpen, logServiceId]);

  useEffect(() => {
    function syncWorkspaceOverflow() {
      const node = workspaceRef.current;
      if (!node) return;
      setWorkspaceScrollable(node.scrollHeight > node.clientHeight + 1);
    }

    syncWorkspaceOverflow();
    window.addEventListener("resize", syncWorkspaceOverflow);

    return () => {
      window.removeEventListener("resize", syncWorkspaceOverflow);
    };
  }, [services]);

  function clearProcessScanTimer() {
    if (processScanTimerRef.current) {
      window.clearTimeout(processScanTimerRef.current);
      processScanTimerRef.current = undefined;
    }
  }

  function processScanSignature(list: ServiceView[]) {
    return list.map((service) => `${service.id}:${service.running ? 1 : 0}:${service.pid ?? ""}`).join("|");
  }

  function scheduleNextProcessScan() {
    clearProcessScanTimer();
    const delay =
      PROCESS_SCAN_BACKOFF_MS[
        Math.min(processScanDelayIndexRef.current, PROCESS_SCAN_BACKOFF_MS.length - 1)
      ];

    processScanTimerRef.current = window.setTimeout(() => {
      processScanTimerRef.current = undefined;
      void runScheduledProcessScan();
    }, delay);
  }

  function resetProcessScanBackoff(list: ServiceView[]) {
    processScanDelayIndexRef.current = 0;
    lastProcessScanSignatureRef.current = processScanSignature(list);
    scheduleNextProcessScan();
  }

  async function runScheduledProcessScan() {
    const list = await refresh({ quiet: true, scanProcesses: true });
    if (list) {
      const signature = processScanSignature(list);
      if (signature === lastProcessScanSignatureRef.current) {
        processScanDelayIndexRef.current = Math.min(
          processScanDelayIndexRef.current + 1,
          PROCESS_SCAN_BACKOFF_MS.length - 1
        );
      } else {
        processScanDelayIndexRef.current = 0;
      }
      lastProcessScanSignatureRef.current = signature;
    }
    scheduleNextProcessScan();
  }

  async function refreshAfterManualAction(quiet = true) {
    const list = await refresh({ quiet, scanProcesses: true });
    if (list) {
      resetProcessScanBackoff(list);
    }
    return list;
  }

  function flash(text: string, isError = false) {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }

    setNotice({ text, isError });
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice((current) => (current?.text === text ? null : current));
    }, 3200);
  }

  async function refresh({ quiet = false, scanProcesses = false }: RefreshOptions = {}) {
    try {
      const list = await invoke<ServiceView[]>("list_services", { scanProcesses });
      applyServiceList(list);
      return list;
    } catch (error) {
      if (!quiet) {
        flash(String(error), true);
      }
      return null;
    }
  }

  function applyServiceList(list: ServiceView[]) {
    const serviceIdSet = new Set(list.map((item) => item.id));
    persistedServicesRef.current = list;
    setServices(list);
    setSelectedServiceIds((current) => current.filter((id) => serviceIdSet.has(id)));

    const currentLogServiceId = logServiceIdRef.current;
    if (currentLogServiceId && !serviceIdSet.has(currentLogServiceId)) {
      setLogModalOpen(false);
      setLogServiceId("");
      setLogText("");
    }
  }

  function updateFormField<K extends keyof ServiceForm>(key: K, value: ServiceForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function movedIndex(index: number, direction: MoveDirection) {
    return direction === "up" ? index - 1 : index + 1;
  }

  function reorderItem<T>(items: T[], index: number, direction: MoveDirection) {
    const targetIndex = movedIndex(index, direction);
    if (index < 0 || targetIndex < 0 || targetIndex >= items.length) {
      return null;
    }

    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
  }

  function flattenServiceGroups(groups: ServiceGroupSection[]) {
    return groups.flatMap((group) => group.services);
  }

  function scheduleServiceOrderSave(nextServices: ServiceView[]) {
    const version = orderSaveVersionRef.current + 1;
    orderSaveVersionRef.current = version;

    if (orderSaveTimerRef.current) {
      window.clearTimeout(orderSaveTimerRef.current);
    }

    orderSaveTimerRef.current = window.setTimeout(() => {
      orderSaveTimerRef.current = undefined;
      void persistServiceOrder(nextServices, version);
    }, 120);
  }

  async function persistServiceOrder(nextServices: ServiceView[], version: number) {
    try {
      await invoke("save_services", { services: nextServices.map((service) => toServiceConfig(service)) });
      if (version === orderSaveVersionRef.current) {
        persistedServicesRef.current = nextServices;
      }
    } catch (error) {
      if (version === orderSaveVersionRef.current) {
        servicesRef.current = persistedServicesRef.current;
        setServices(persistedServicesRef.current);
        flash(String(error), true);
      }
    }
  }

  function applyServiceOrder(nextServices: ServiceView[]) {
    servicesRef.current = nextServices;
    setServices(nextServices);
    scheduleServiceOrderSave(nextServices);
  }

  function moveGroup(groupKey: string, direction: MoveDirection) {
    const groupIndex = groupedServices.findIndex((group) => group.key === groupKey);
    const nextGroups = reorderItem(groupedServices, groupIndex, direction);
    if (!nextGroups) return;

    applyServiceOrder(flattenServiceGroups(nextGroups));
  }

  function moveService(serviceId: string, direction: MoveDirection) {
    const groupIndex = groupedServices.findIndex((group) =>
      group.services.some((service) => service.id === serviceId)
    );
    if (groupIndex < 0) return;

    const serviceIndex = groupedServices[groupIndex].services.findIndex((service) => service.id === serviceId);
    const nextServices = reorderItem(groupedServices[groupIndex].services, serviceIndex, direction);
    if (!nextServices) return;

    const nextGroups = groupedServices.map((group, index) =>
      index === groupIndex ? { ...group, services: nextServices } : group
    );
    applyServiceOrder(flattenServiceGroups(nextGroups));
  }

  function openCreateModal() {
    const next = blankForm();
    setEditorMode("create");
    setEditingSourceId("");
    setForm(next);
    setEditorOpen(true);
  }

  function openCopyModal(service: ServiceView) {
    const existingIds = new Set(servicesRef.current.map((item) => item.id));

    setEditorMode("create");
    setEditingSourceId("");
    setForm({
      ...toServiceConfig(service),
      id: generateServiceId(existingIds),
      name: `${service.name} 副本`,
      stdout_log: "",
      stderr_log: ""
    });
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

  function toggleSelectedService(id: string) {
    setSelectedServiceIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function selectAllServices() {
    setSelectedServiceIds(servicesRef.current.map((service) => service.id));
  }

  function clearSelectedServices() {
    setSelectedServiceIds([]);
  }

  function toggleSelectAllServices() {
    if (servicesRef.current.length === 0) {
      return;
    }
    if (selectedServiceIds.length === servicesRef.current.length) {
      clearSelectedServices();
      return;
    }
    selectAllServices();
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
      const normalized = normalizeService(form);
      const item = editorMode === "edit" && editingSourceId ? { ...normalized, id: editingSourceId } : normalized;
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
      await refresh({ quiet: true });
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
      await refreshAfterManualAction(true);
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
      await refreshAfterManualAction(true);
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
      await refreshAfterManualAction(true);
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

  function formatBatchNotice(actionLabel: string, result: BatchServiceResult) {
    const parts = [`${actionLabel}完成`];
    parts.push(`成功 ${result.succeeded_count}`);
    if (result.skipped_count > 0) {
      parts.push(`跳过 ${result.skipped_count}`);
    }
    if (result.failed_count > 0) {
      parts.push(`失败 ${result.failed_count}`);
    }
    return parts.join("，") + "。";
  }

  function firstBatchError(result: BatchServiceResult) {
    return result.items.find((item) => item.error)?.error ?? "";
  }

  async function runBatchAction(
    command: "start_services" | "stop_services" | "restart_services",
    ids: string[],
    emptyMessage: string,
    actionLabel: string
  ) {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      flash(emptyMessage, true);
      return;
    }

    setBusy(true);
    try {
      const result = await invoke<BatchServiceResult>(command, { ids: uniqueIds });
      await refreshAfterManualAction(true);

      if (result.failed_count > 0 && result.succeeded_count === 0) {
        flash(firstBatchError(result) || `${actionLabel}失败。`, true);
        return;
      }

      flash(formatBatchNotice(actionLabel, result), result.failed_count > 0);
    } catch (error) {
      flash(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function importConfig() {
    const picked = await open({
      multiple: false,
      title: "导入服务配置",
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (typeof picked !== "string" || !picked) return;

    setBusy(true);
    try {
      const result = await invoke<ImportServicesResult>("import_services", { path: picked });
      await refresh({ quiet: true });
      flash(`已导入 ${result.imported_count} 项，新增 ${result.added_count} 项，更新 ${result.updated_count} 项。`);
    } catch (error) {
      flash(String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function startAll() {
    await runBatchAction(
      "start_services",
      servicesRef.current.filter((service) => service.enabled).map((service) => service.id),
      "没有可启动的已启用服务。",
      "一键启动"
    );
  }

  async function stopAll() {
    await runBatchAction(
      "stop_services",
      servicesRef.current.filter((service) => service.running).map((service) => service.id),
      "没有可关闭的运行中服务。",
      "一键关闭"
    );
  }

  async function restartAll() {
    await runBatchAction(
      "restart_services",
      servicesRef.current.filter((service) => service.enabled).map((service) => service.id),
      "没有可重启的已启用服务。",
      "一键重启"
    );
  }

  async function startSelected() {
    await runBatchAction(
      "start_services",
      servicesRef.current
        .filter((service) => selectedServiceIdSet.has(service.id) && service.enabled)
        .map((service) => service.id),
      "没有可启动的已选服务。",
      "启动选中"
    );
  }

  async function stopSelected() {
    await runBatchAction(
      "stop_services",
      servicesRef.current
        .filter((service) => selectedServiceIdSet.has(service.id) && service.running)
        .map((service) => service.id),
      "没有可关闭的已选运行中服务。",
      "关闭选中"
    );
  }

  async function restartSelected() {
    await runBatchAction(
      "restart_services",
      servicesRef.current
        .filter((service) => selectedServiceIdSet.has(service.id) && service.enabled)
        .map((service) => service.id),
      "没有可重启的已选服务。",
      "重启选中"
    );
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

      await refresh({ quiet: true });
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

  function cycleLogRefreshInterval() {
    setLogRefreshKey((current) => {
      const currentIndex = LOG_REFRESH_OPTIONS.findIndex((option) => option.key === current);
      return LOG_REFRESH_OPTIONS[(currentIndex + 1) % LOG_REFRESH_OPTIONS.length].key;
    });
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

    const x = event.clientX - rect.left - 44;
    const y = event.clientY - rect.top - 44;
    if (cursorGlowRef.current) {
      cursorGlowRef.current.style.transform = `translate(${x}px, ${y}px)`;
    }
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

  async function toggleGroup(groupKey: string) {
    const targetGroup = groupedServices.find((group) => group.key === groupKey);
    if (!targetGroup) return;

    const shouldStop = targetGroup.services.length > 0 && targetGroup.runningCount === targetGroup.services.length;
    await runBatchAction(
      shouldStop ? "stop_services" : "start_services",
      shouldStop ? targetGroup.stoppableIds : targetGroup.startableIds,
      shouldStop ? "当前分组没有可停止的运行中服务。" : "当前分组没有可启动的服务。",
      `${shouldStop ? "停止" : "启动"}分组「${targetGroup.label}」`
    );
  }

  return (
    <main className="shell">
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
          className={`workspace${workspaceScrollable ? " workspace--scrollable" : ""}`}
          onMouseMove={handleWorkspacePointerMove}
          onMouseEnter={() => setGlowVisible(true)}
          onMouseLeave={() => setGlowVisible(false)}
        >
          <div ref={cursorGlowRef} className={`cursor-glow${glowVisible ? " is-visible" : ""}`} />
          {notice ? (
            <div className="toast-layer" aria-live="polite" aria-atomic="true">
              <div className={`toast${notice.isError ? " toast--error" : ""}`}>{notice.text}</div>
            </div>
          ) : null}
          <ActionPanel
            serviceCount={services.length}
            runningCount={runningCount}
            busy={busy}
            closeToTray={closeToTray}
            onRefresh={() => void refreshAfterManualAction(false)}
            onImport={() => void importConfig()}
            onStartAll={() => void startAll()}
            onStopAll={() => void stopAll()}
            onRestartAll={() => void restartAll()}
            onToggleCloseToTray={() => setCloseToTray((current) => !current)}
          />

          <ServiceList
            groups={groupedServices}
            busy={busy}
            selectedCount={selectedCount}
            allSelected={allSelected}
            selectedServiceIds={selectedServiceIdSet}
            onCreate={openCreateModal}
            onToggleSelectAll={toggleSelectAllServices}
            onStartSelected={() => void startSelected()}
            onStopSelected={() => void stopSelected()}
            onRestartSelected={() => void restartSelected()}
            onToggleSelected={toggleSelectedService}
            onToggleGroup={(groupKey) => void toggleGroup(groupKey)}
            onMoveGroup={(groupKey, direction) => void moveGroup(groupKey, direction)}
            onMoveService={(serviceId, direction) => void moveService(serviceId, direction)}
            onCopy={openCopyModal}
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
          refreshIntervalLabel={activeLogRefreshOption.label}
          logText={logText}
          logViewRef={logViewRef}
          onClose={closeLogModal}
          onSetActiveLogType={setActiveLogType}
          onRefresh={() => void readActiveLog()}
          onCycleRefreshInterval={cycleLogRefreshInterval}
          onScrollTo={scrollLogTo}
          onOpenPath={(path) => void openPath(path)}
        />
      ) : null}
    </main>
  );
}
