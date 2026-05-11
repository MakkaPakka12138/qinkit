import type { LogType, ServiceView } from "../types";
import { Icon } from "./Icon";

type LogModalProps = {
  logService: ServiceView | null;
  activeLogPath: string;
  activeLogType: LogType;
  refreshIntervalLabel: string;
  logText: string;
  logViewRef: React.RefObject<HTMLPreElement | null>;
  onClose: () => void;
  onSetActiveLogType: (type: LogType) => void;
  onRefresh: () => void;
  onCycleRefreshInterval: () => void;
  onScrollTo: (position: "top" | "bottom") => void;
  onOpenPath: (path: string) => void;
};

export function LogModal({
  logService,
  activeLogPath,
  activeLogType,
  refreshIntervalLabel,
  logText,
  logViewRef,
  onClose,
  onSetActiveLogType,
  onRefresh,
  onCycleRefreshInterval,
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
          <button
            type="button"
            className="log-refresh-toggle"
            title={`自动刷新：${refreshIntervalLabel}`}
            aria-label={`自动刷新：${refreshIntervalLabel}`}
            onClick={onCycleRefreshInterval}
          >
            <Icon path="M21 12a9 9 0 0 1-9 9 8.7 8.7 0 0 1-6.2-2.6M3 12a9 9 0 0 1 9-9 8.7 8.7 0 0 1 6.2 2.6M3 5v5h5M21 19v-5h-5" />
            <span>{refreshIntervalLabel}</span>
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
        </div>

        <pre ref={logViewRef} className="log-view">{logText || "等待日志输出..."}</pre>
      </section>
    </div>
  );
}
