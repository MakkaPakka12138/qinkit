import type { ServiceConfig } from "../types";
import { Icon } from "./Icon";

type ServiceEditorModalProps = {
  busy: boolean;
  editorMode: "create" | "edit";
  form: ServiceConfig;
  onClose: () => void;
  onSave: () => void;
  onUpdateField: <K extends keyof ServiceConfig>(key: K, value: ServiceConfig[K]) => void;
  onApplyLogPaths: () => void;
  onPickDirectory: () => void;
  onPickLogDir: () => void;
  onOpenPath: (path: string) => void;
};

export function ServiceEditorModal({
  busy,
  editorMode,
  form,
  onClose,
  onSave,
  onUpdateField,
  onApplyLogPaths,
  onPickDirectory,
  onPickLogDir,
  onOpenPath
}: ServiceEditorModalProps) {
  return (
    <div className="modal-mask modal-mask--centered" onClick={onClose}>
      <section className="modal modal--editor" onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h3>{editorMode === "create" ? "新增服务" : "编辑服务"}</h3>
            <p>启动命令会通过 PowerShell 运行。</p>
          </div>
          <button type="button" className="ghost icon-btn" title="关闭" aria-label="关闭" onClick={onClose}>
            <Icon path="M6 6l12 12M18 6L6 18" />
          </button>
        </div>

        <div className="form-grid">
          <label>
            <span>服务 ID</span>
            <input value={form.id} onChange={(event) => onUpdateField("id", event.target.value)} placeholder="backend" />
          </label>

          <label>
            <span>显示名称</span>
            <input value={form.name} onChange={(event) => onUpdateField("name", event.target.value)} placeholder="ERP 后端" />
          </label>

          <label>
            <span>分组名称</span>
            <input
              value={form.group_name}
              onChange={(event) => onUpdateField("group_name", event.target.value)}
              placeholder="本地开发"
            />
          </label>

          <label className="wide">
            <span>启动命令</span>
            <textarea
              rows={4}
              value={form.command}
              onChange={(event) => onUpdateField("command", event.target.value)}
              placeholder="python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
            />
          </label>

          <label className="wide">
            <span>工作目录</span>
            <div className="field-actions">
              <input value={form.cwd} onChange={(event) => onUpdateField("cwd", event.target.value)} placeholder="E:\\project\\backend" />
              <button type="button" className="icon-btn" title="选择目录" aria-label="选择目录" onClick={onPickDirectory}>
                <Icon path="M4 7.5h5l2 2H20v7.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7.5V6a2 2 0 0 1 2-2h3l2 2" />
              </button>
              <button type="button" className="icon-btn" title="生成日志路径" aria-label="生成日志路径" onClick={onApplyLogPaths}>
                <Icon path="M12 3l1.8 4.7L19 9.5l-4 3.2 1.2 5.3L12 15.2 7.8 18l1.2-5.3-4-3.2 5.2-1.8z" />
              </button>
              <button type="button" className="icon-btn" title="打开目录" aria-label="打开目录" disabled={!form.cwd.trim()} onClick={() => onOpenPath(form.cwd)}>
                <Icon path="M14 5h5v5M10 14 19 5M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
              </button>
            </div>
          </label>

          <label className="wide">
            <span>日志目录</span>
            <div className="field-actions">
              <input value={form.log_dir} onChange={(event) => onUpdateField("log_dir", event.target.value)} placeholder="E:\\project\\backend\\logs" />
              <button type="button" className="icon-btn" title="选择日志目录" aria-label="选择日志目录" onClick={onPickLogDir}>
                <Icon path="M4 7.5h5l2 2H20v7.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7.5V6a2 2 0 0 1 2-2h3l2 2" />
              </button>
              <button type="button" className="icon-btn" title="生成日志目录" aria-label="生成日志目录" onClick={onApplyLogPaths}>
                <Icon path="M12 3l1.8 4.7L19 9.5l-4 3.2 1.2 5.3L12 15.2 7.8 18l1.2-5.3-4-3.2 5.2-1.8z" />
              </button>
              <button type="button" className="icon-btn" title="打开日志目录" aria-label="打开日志目录" disabled={!form.log_dir.trim()} onClick={() => onOpenPath(form.log_dir)}>
                <Icon path="M14 5h5v5M10 14 19 5M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
              </button>
            </div>
          </label>

          <label className="wide">
            <span>当前日志文件由每次启动自动生成，避免单个日志文件持续膨胀。</span>
          </label>

          <label>
            <span>重启延迟 / 秒</span>
            <input
              type="number"
              min={1}
              value={form.restart_delay_seconds}
              onChange={(event) => onUpdateField("restart_delay_seconds", Number(event.target.value))}
            />
          </label>

          <div className="checkbox-group">
            <label>
              <input type="checkbox" checked={form.enabled} onChange={(event) => onUpdateField("enabled", event.target.checked)} />
              启用
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.auto_start}
                onChange={(event) => onUpdateField("auto_start", event.target.checked)}
              />
              打开软件后自动启动
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.auto_restart}
                onChange={(event) => onUpdateField("auto_restart", event.target.checked)}
              />
              异常退出自动重启
            </label>
          </div>
        </div>

        <div className="modal__foot">
          <button type="button" className="ghost icon-btn" title="取消" aria-label="取消" onClick={onClose}>
            <Icon path="M6 6l12 12M18 6L6 18" />
          </button>
          <button type="button" className="primary icon-btn" title="保存" aria-label="保存" disabled={busy} onClick={onSave}>
            <Icon path="M5 5h11l3 3v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM8 5v5h8M8 19v-6h8v6" />
          </button>
        </div>
      </section>
    </div>
  );
}
