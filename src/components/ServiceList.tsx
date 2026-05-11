import type { ServiceView } from "../types";

export type ServiceGroupSection = {
  key: string;
  label: string;
  services: ServiceView[];
  runningCount: number;
  enabledCount: number;
  startableIds: string[];
};

type ServiceListProps = {
  groups: ServiceGroupSection[];
  busy: boolean;
  selectedCount: number;
  allSelected: boolean;
  selectedServiceIds: Set<string>;
  onCreate: () => void;
  onToggleSelectAll: () => void;
  onStartSelected: () => void;
  onStopSelected: () => void;
  onRestartSelected: () => void;
  onToggleSelected: (id: string) => void;
  onStartGroup: (groupKey: string) => void;
  onCopy: (service: ServiceView) => void;
  onEdit: (service: ServiceView) => void;
  onToggle: (service: ServiceView) => void;
  onRestart: (id: string) => void;
  onOpenLog: (service: ServiceView) => void;
  onDelete: (id: string) => void;
};

export function ServiceList({
  groups,
  busy,
  selectedCount,
  allSelected,
  selectedServiceIds,
  onCreate,
  onToggleSelectAll,
  onStartSelected,
  onStopSelected,
  onRestartSelected,
  onToggleSelected,
  onStartGroup,
  onCopy,
  onEdit,
  onToggle,
  onRestart,
  onOpenLog,
  onDelete
}: ServiceListProps) {
  return (
    <section className="board">
      <div className="board__head">
        <div>
          <h2>服务列表</h2>
        </div>
        <div className="board__actions">
          <span className="board__summary">{selectedCount} 项已选中</span>
          <button type="button" className="primary compact-btn" disabled={busy} onClick={onCreate}>
            新增
          </button>
          <button
            type="button"
            className="ghost soft compact-btn"
            disabled={busy || groups.length === 0}
            onClick={onToggleSelectAll}
          >
            {allSelected ? "清空选择" : "全选"}
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

      <div className="service-list">
        {groups.length === 0 ? <div className="empty">还没有服务，先新增一个服务。</div> : null}

        {groups.map((group) => (
          <section key={group.key} className="service-group">
            <header className="service-group__head">
              <div className="service-group__title">
                <strong>{group.label}</strong>
                <span>{group.services.length} 个服务</span>
                <span>{group.runningCount} 运行中</span>
                <span>{group.enabledCount} 已启用</span>
              </div>
              <button
                type="button"
                className="primary compact-btn"
                disabled={busy || group.startableIds.length === 0}
                onClick={() => onStartGroup(group.key)}
              >
                启动本组
              </button>
            </header>

            <div className="service-group__body">
              {group.services.map((service) => (
                <article
                  key={service.id}
                  className={`service-row${selectedServiceIds.has(service.id) ? " is-selected" : ""}`}
                >
                  <label className="service-row__select">
                    <input
                      type="checkbox"
                      checked={selectedServiceIds.has(service.id)}
                      onChange={() => onToggleSelected(service.id)}
                    />
                  </label>

                  <div className="service-row__main">
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
                  </div>

                  <div className="service-row__actions">
                    <button type="button" className="compact-btn" disabled={busy} onClick={() => onCopy(service)}>
                      复制
                    </button>
                    <button type="button" className="compact-btn" disabled={busy} onClick={() => onEdit(service)}>
                      编辑
                    </button>
                    <button type="button" className="compact-btn" disabled={busy} onClick={() => onToggle(service)}>
                      {service.running ? "停止" : "启动"}
                    </button>
                    <button type="button" className="compact-btn" disabled={busy} onClick={() => onRestart(service.id)}>
                      重启
                    </button>
                    <button type="button" className="compact-btn" disabled={busy} onClick={() => onOpenLog(service)}>
                      日志
                    </button>
                    <button
                      type="button"
                      className="danger-text compact-btn"
                      disabled={busy}
                      onClick={() => onDelete(service.id)}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
