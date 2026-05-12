import type { MoveDirection, ServiceView } from "../types";
import { Icon } from "./Icon";

export type ServiceGroupSection = {
  key: string;
  label: string;
  services: ServiceView[];
  runningCount: number;
  startableIds: string[];
  stoppableIds: string[];
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
  onToggleGroup: (groupKey: string) => void;
  onMoveGroup: (groupKey: string, direction: MoveDirection) => void;
  onMoveService: (serviceId: string, direction: MoveDirection) => void;
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
  onToggleGroup,
  onMoveGroup,
  onMoveService,
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

        {groups.map((group, groupIndex) => (
          <section key={group.key} className="service-group">
            <header className="service-group__head">
              <div className="service-group__title">
                <strong>{group.label}</strong>
                <span>总数/运行中 {group.services.length}/{group.runningCount}</span>
              </div>
              <div className="service-group__actions">
                <button
                  type="button"
                  className="icon-compact-btn"
                  title="上移分组"
                  aria-label="上移分组"
                  disabled={busy || groupIndex === 0}
                  onClick={() => onMoveGroup(group.key, "up")}
                >
                  <Icon path="m18 15-6-6-6 6" />
                </button>
                <button
                  type="button"
                  className="icon-compact-btn"
                  title="下移分组"
                  aria-label="下移分组"
                  disabled={busy || groupIndex === groups.length - 1}
                  onClick={() => onMoveGroup(group.key, "down")}
                >
                  <Icon path="m6 9 6 6 6-6" />
                </button>
                <button
                  type="button"
                  className={`icon-compact-btn${group.runningCount === group.services.length ? " icon-compact-btn--danger" : ""}`}
                  title={group.runningCount === group.services.length ? "停止本组" : "启动本组"}
                  aria-label={group.runningCount === group.services.length ? "停止本组" : "启动本组"}
                  disabled={
                    busy ||
                    (group.runningCount === group.services.length
                      ? group.stoppableIds.length === 0
                      : group.startableIds.length === 0)
                  }
                  onClick={() => onToggleGroup(group.key)}
                >
                  {group.runningCount === group.services.length ? (
                    <Icon path="M8 8h8v8H8z" />
                  ) : (
                    <Icon path="M8 6.5v11l8-5.5-8-5.5Z" />
                  )}
                </button>
              </div>
            </header>

            <div className="service-group__body">
              {group.services.map((service, serviceIndex) => (
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
                  </div>

                  <div className="service-row__actions">
                    <button
                      type="button"
                      className="icon-compact-btn"
                      title="上移服务"
                      aria-label="上移服务"
                      disabled={busy || serviceIndex === 0}
                      onClick={() => onMoveService(service.id, "up")}
                    >
                      <Icon path="m18 15-6-6-6 6" />
                    </button>
                    <button
                      type="button"
                      className="icon-compact-btn"
                      title="下移服务"
                      aria-label="下移服务"
                      disabled={busy || serviceIndex === group.services.length - 1}
                      onClick={() => onMoveService(service.id, "down")}
                    >
                      <Icon path="m6 9 6 6 6-6" />
                    </button>
                    <button
                      type="button"
                      className="icon-compact-btn"
                      title="复制"
                      aria-label="复制"
                      disabled={busy}
                      onClick={() => onCopy(service)}
                    >
                      <Icon path="M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
                    </button>
                    <button
                      type="button"
                      className="icon-compact-btn"
                      title="编辑"
                      aria-label="编辑"
                      disabled={busy}
                      onClick={() => onEdit(service)}
                    >
                      <Icon path="M4 20h4l10-10-4-4L4 16v4ZM13 7l4 4" />
                    </button>
                    <button
                      type="button"
                      className={`icon-compact-btn${service.running ? " icon-compact-btn--danger" : ""}`}
                      title={service.running ? "停止" : "启动"}
                      aria-label={service.running ? "停止" : "启动"}
                      disabled={busy}
                      onClick={() => onToggle(service)}
                    >
                      {service.running ? (
                        <Icon path="M8 8h8v8H8z" />
                      ) : (
                        <Icon path="M8 6.5v11l8-5.5-8-5.5Z" />
                      )}
                    </button>
                    <button type="button" className="compact-btn" disabled={busy} onClick={() => onRestart(service.id)}>
                      重启
                    </button>
                    <button type="button" className="compact-btn" disabled={busy} onClick={() => onOpenLog(service)}>
                      日志
                    </button>
                    <button
                      type="button"
                      className="icon-compact-btn icon-compact-btn--danger"
                      title="删除"
                      aria-label="删除"
                      disabled={busy}
                      onClick={() => onDelete(service.id)}
                    >
                      <Icon path="M5 7h14M9 7V4h6v3m-8 0 1 12h8l1-12" />
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
