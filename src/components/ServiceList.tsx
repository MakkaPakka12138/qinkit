import type { ServiceView } from "../types";

type ServiceListProps = {
  services: ServiceView[];
  busy: boolean;
  onEdit: (service: ServiceView) => void;
  onToggle: (service: ServiceView) => void;
  onRestart: (id: string) => void;
  onOpenLog: (service: ServiceView) => void;
  onDelete: (id: string) => void;
};

export function ServiceList({
  services,
  busy,
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
          <p>点击行查看状态，编辑与新增使用弹窗，日志窗口自动跟随最新输出。</p>
        </div>
      </div>

      <div className="service-list">
        {services.length === 0 ? <div className="empty">还没有服务，先从上面的新增开始。</div> : null}

        {services.map((service) => (
          <article key={service.id} className="service-row">
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
              <button type="button" disabled={busy} onClick={() => onEdit(service)}>
                编辑
              </button>
              <button type="button" disabled={busy} onClick={() => onToggle(service)}>
                {service.running ? "停止" : "启动"}
              </button>
              <button type="button" disabled={busy} onClick={() => onRestart(service.id)}>
                重启
              </button>
              <button type="button" disabled={busy} onClick={() => onOpenLog(service)}>
                日志
              </button>
              <button type="button" className="danger-text" disabled={busy} onClick={() => onDelete(service.id)}>
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
