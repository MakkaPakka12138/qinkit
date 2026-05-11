import type React from "react";
import logoPng from "../assets/logo.png";
import type { ThemeMode } from "../types";
import { Icon } from "./Icon";

type TitlebarProps = {
  themeMode: ThemeMode;
  windowMaximized: boolean;
  onToggleTheme: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  onMouseDownCapture: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseUpCapture: () => void;
  onMouseLeave: () => void;
  onDoubleClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
};

export function Titlebar({
  themeMode,
  windowMaximized,
  onToggleTheme,
  onMinimize,
  onToggleMaximize,
  onClose,
  onMouseDownCapture,
  onMouseUpCapture,
  onMouseLeave,
  onDoubleClickCapture
}: TitlebarProps) {
  return (
    <header
      className="titlebar"
      data-tauri-drag-region=""
      onMouseDownCapture={onMouseDownCapture}
      onMouseUpCapture={onMouseUpCapture}
      onMouseLeave={onMouseLeave}
      onDoubleClickCapture={onDoubleClickCapture}
    >
      <div className="titlebar__drag">
        <div className="brand-mark">
          <img src={logoPng} alt="Qinkit logo" className="brand-mark__image" />
        </div>
        <div className="brand-copy">
          <strong>轻启·服务管理器</strong>
          <span>Qinkit server runner</span>
        </div>
      </div>

      <div className="titlebar__actions">
        <button
          type="button"
          className="theme-toggle"
          aria-label={themeMode === "dark" ? "切换到浅色主题" : "切换到暗色主题"}
          title={themeMode === "dark" ? "切换到浅色主题" : "切换到暗色主题"}
          onClick={onToggleTheme}
        >
          <Icon path={themeMode === "dark" ? "M12 3v2.2M12 18.8V21M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M3 12h2.2M18.8 12H21M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5M12 7.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Z" : "M19 12.8A7 7 0 1 1 11.2 5a5.6 5.6 0 0 0 7.8 7.8Z"} />
        </button>

        <div className="window-actions">
          <button type="button" className="window-btn window-btn--minimize" aria-label="最小化" title="最小化" onClick={onMinimize}>
            <span className="window-btn__glyph">−</span>
          </button>
          <button
            type="button"
            className="window-btn window-btn--maximize"
            aria-label={windowMaximized ? "还原" : "最大化"}
            title={windowMaximized ? "还原" : "最大化"}
            onClick={onToggleMaximize}
          >
            <span className="window-btn__glyph">{windowMaximized ? "❐" : "□"}</span>
          </button>
          <button type="button" className="window-btn window-btn--close" aria-label="关闭" title="关闭" onClick={onClose}>
            <span className="window-btn__glyph">×</span>
          </button>
        </div>
      </div>
    </header>
  );
}
