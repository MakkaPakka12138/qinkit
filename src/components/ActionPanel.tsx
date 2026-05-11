type ActionPanelProps = {
  serviceCount: number;
  runningCount: number;
  enabledCount: number;
  busy: boolean;
  notice: string;
  errorText: string;
  closeToTray: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onStartAll: () => void;
  onToggleCloseToTray: () => void;
};

export function ActionPanel({
  serviceCount,
  runningCount,
  enabledCount,
  busy,
  notice,
  errorText,
  closeToTray,
  onRefresh,
  onCreate,
  onStartAll,
  onToggleCloseToTray
}: ActionPanelProps) {
  return (
    <section className="action-panel">
      <div className="action-strip">
        <div className="stats-bar">
          <span>{serviceCount} 个服务</span>
          <span>{runningCount} 运行中</span>
          <span>{enabledCount} 已启用</span>
        </div>
        <div className="action-strip__buttons">
          <button type="button" className="ghost soft" disabled={busy} onClick={onRefresh}>
            刷新
          </button>
          <button type="button" className="primary" disabled={busy} onClick={onCreate}>
            新增
          </button>
          <button type="button" className="primary alt" disabled={busy} onClick={onStartAll}>
            一键启动
          </button>
          <button type="button" className="ghost soft" onClick={onToggleCloseToTray}>
            关闭到托盘: {closeToTray ? "开" : "关"}
          </button>
        </div>
      </div>

      {notice ? <div className="notice notice--good">{notice}</div> : null}
      {errorText ? <div className="notice notice--bad">{errorText}</div> : null}
    </section>
  );
}
