type ActionPanelProps = {
  serviceCount: number;
  runningCount: number;
  enabledCount: number;
  selectedCount: number;
  busy: boolean;
  notice: string;
  errorText: string;
  closeToTray: boolean;
  onRefresh: () => void;
  onImport: () => void;
  onCreate: () => void;
  onStartAll: () => void;
  onStopAll: () => void;
  onRestartAll: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onStartSelected: () => void;
  onStopSelected: () => void;
  onRestartSelected: () => void;
  onToggleCloseToTray: () => void;
};

export function ActionPanel({
  serviceCount,
  runningCount,
  enabledCount,
  selectedCount,
  busy,
  notice,
  errorText,
  closeToTray,
  onRefresh,
  onImport,
  onCreate,
  onStartAll,
  onStopAll,
  onRestartAll,
  onSelectAll,
  onClearSelection,
  onStartSelected,
  onStopSelected,
  onRestartSelected,
  onToggleCloseToTray
}: ActionPanelProps) {
  return (
    <section className="action-panel">
      <div className="action-strip action-strip--primary">
        <div className="stats-bar">
          <span>{serviceCount} 个服务</span>
          <span>{runningCount} 运行中</span>
          <span>{enabledCount} 已启用</span>
        </div>
        <div className="action-strip__buttons action-strip__buttons--wrap">
          <button type="button" className="ghost soft compact-btn" disabled={busy} onClick={onRefresh}>
            刷新
          </button>
          <button type="button" className="ghost soft compact-btn" disabled={busy} onClick={onImport}>
            导入配置
          </button>
          <button type="button" className="primary compact-btn" disabled={busy} onClick={onCreate}>
            新增
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

      <div className="action-strip action-strip--secondary">
        <div className="selection-bar">
          <span>{selectedCount} 项已选中</span>
        </div>
        <div className="action-strip__buttons action-strip__buttons--wrap">
          <button type="button" className="ghost soft compact-btn" disabled={busy} onClick={onSelectAll}>
            全选
          </button>
          <button type="button" className="ghost soft compact-btn" disabled={busy || selectedCount === 0} onClick={onClearSelection}>
            清空选择
          </button>
          <button type="button" className="primary compact-btn" disabled={busy || selectedCount === 0} onClick={onStartSelected}>
            启动选中
          </button>
          <button type="button" className="ghost soft compact-btn" disabled={busy || selectedCount === 0} onClick={onStopSelected}>
            关闭选中
          </button>
          <button type="button" className="primary alt compact-btn" disabled={busy || selectedCount === 0} onClick={onRestartSelected}>
            重启选中
          </button>
        </div>
      </div>

      {notice ? <div className="notice notice--good">{notice}</div> : null}
      {errorText ? <div className="notice notice--bad">{errorText}</div> : null}
    </section>
  );
}
