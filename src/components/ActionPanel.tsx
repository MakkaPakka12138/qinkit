import { Icon } from "./Icon";

type ActionPanelProps = {
  serviceCount: number;
  runningCount: number;
  busy: boolean;
  closeToTray: boolean;
  onRefresh: () => void;
  onImport: () => void;
  onStartAll: () => void;
  onStopAll: () => void;
  onRestartAll: () => void;
  onToggleCloseToTray: () => void;
};

export function ActionPanel({
  serviceCount,
  runningCount,
  busy,
  closeToTray,
  onRefresh,
  onImport,
  onStartAll,
  onStopAll,
  onRestartAll,
  onToggleCloseToTray
}: ActionPanelProps) {
  return (
    <section className="action-panel">
      <div className="action-strip">
        <div className="stats-bar">
          <span>服务 {serviceCount}</span>
          <span>运行中 {runningCount}</span>
        </div>
        <div className="action-strip__buttons action-strip__buttons--wrap">
          <button
            type="button"
            className="icon-compact-btn"
            title="刷新"
            aria-label="刷新"
            disabled={busy}
            onClick={onRefresh}
          >
            <Icon path="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </button>
          <button type="button" className="ghost soft compact-btn" disabled={busy} onClick={onImport}>
            导入配置
          </button>
          <button type="button" className="primary alt compact-btn" disabled={busy} onClick={onStartAll}>
            一键启动
          </button>
          <button type="button" className="ghost soft compact-btn" disabled={busy} onClick={onStopAll}>
            一键关闭
          </button>
          <button type="button" className="primary alt compact-btn" disabled={busy} onClick={onRestartAll}>
            一键重启
          </button>
          <button type="button" className="ghost soft compact-btn" onClick={onToggleCloseToTray}>
            关闭到托盘: {closeToTray ? "开" : "关"}
          </button>
        </div>
      </div>
    </section>
  );
}
