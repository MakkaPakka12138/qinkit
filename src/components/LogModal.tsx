import type { LogType, ServiceView } from "../types";

type LogModalProps = {
  logService: ServiceView | null;
  activeLogPath: string;
  activeLogType: LogType;
  logText: string;
  logViewRef: React.RefObject<HTMLPreElement | null>;
  onClose: () => void;
  onSetActiveLogType: (type: LogType) => void;
  onRefresh: () => void;
  onScrollTo: (position: "top" | "bottom") => void;
  onOpenPath: (path: string) => void;
};

export function LogModal({
  logService,
  activeLogPath,
  activeLogType,
  logText,
  logViewRef,
  onClose,
  onSetActiveLogType,
  onRefresh,
  onScrollTo,
  onOpenPath
}: LogModalProps) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <section className="modal modal--log" onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h3>{logService?.name ?? "日志"}</h3>
            <p>{activeLogPath || "当前没有日志路径"}</p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="log-toolbar">
          <button type="button" className={activeLogType === "stdout" ? "primary" : ""} onClick={() => onSetActiveLogType("stdout")}>
            stdout
          </button>
          <button type="button" className={activeLogType === "stderr" ? "primary" : ""} onClick={() => onSetActiveLogType("stderr")}>
            stderr
          </button>
          <button type="button" onClick={onRefresh}>
            刷新
          </button>
          <button type="button" onClick={() => onScrollTo("top")}>
            置顶
          </button>
          <button type="button" onClick={() => onScrollTo("bottom")}>
            置底
          </button>
          <button type="button" disabled={!activeLogPath} onClick={() => onOpenPath(activeLogPath)}>
            打开位置
          </button>
          <span className="log-follow">实时跟随中</span>
        </div>

        <pre ref={logViewRef} className="log-view">{logText || "等待日志输出..."}</pre>
      </section>
    </div>
  );
}
