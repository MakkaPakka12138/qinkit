# 轻启·服务管理器

一个基于 **React + Tauri 2 + Rust** 的 Windows 轻量服务运行器。

它不是 Docker，也不是完整的 Windows Service 替代品。  
它解决的是更直接的问题：把你平时手动执行的启动命令保存下来，然后在一个桌面界面里统一管理启动、停止、重启、日志和自动拉起。

## 当前功能

- 添加 / 编辑 / 删除服务
- 服务分组、分组排序与分组内一键启动
- 分组和服务支持上移 / 下移调整展示顺序
- 启动 / 停止 / 重启单个服务
- 一键启动全部已启用服务
- 启动时自动发现已有进程，尽量避免重复拉起
- 软件启动后自动启动指定服务
- 服务异常退出后自动重启
- 为每次启动自动生成新的 stdout / stderr 日志文件
- 自动将 stderr 中的普通运行日志分流到 stdout 日志
- 实时查看普通日志 / 错误日志
- 自定义日志目录
- 关闭窗口时可最小化到托盘
- 自定义无边框标题栏
- 浅色 / 暗色主题切换

## 适合场景

- 本地开发环境常驻服务
- Python / Node.js / Go / Java 等命令行项目启动托管
- 内网工具、小型后台进程、本地代理或 tunnel 管理

不太适合：

- 严格的生产级服务编排
- 多机部署
- 无人值守、用户未登录时长期运行的系统级服务

## 环境要求

Windows 下建议准备：

1. Node.js LTS
2. Rust stable
3. Visual Studio Build Tools
4. WebView2 Runtime

## 开发运行

```bash
npm install
npm run tauri:dev
```

## 打包

```bash
npm run tauri:build
```

打包产物通常在：

```text
src-tauri/target/release/bundle/
```

默认会生成 NSIS 和 MSI 安装包。

## 使用方式

比如你原来在终端里手动执行：

```bat
cd /d E:\project\backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

在软件中可以配置为：

```text
显示名称：
ERP 后端

启动命令：
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000

工作目录：
E:\project\backend

日志目录：
E:\project\backend\logs
```

当前 Windows 下，启动命令会通过 `powershell.exe` 执行，并以无控制台窗口方式启动。

## 配置说明

每个服务当前包含这些核心字段：

- `id`：系统自动生成，界面中不需要手动填写
- `name`：界面显示名称
- `group_name`：分组名称，留空表示未分组
- `command`：实际启动命令
- `cwd`：工作目录
- `enabled`：是否启用
- `auto_start`：打开软件后自动启动
- `auto_restart`：异常退出后自动重启
- `restart_delay_seconds`：自动重启延迟
- `log_dir`：日志目录

服务配置现在保存在 Tauri 的应用数据目录下，文件名为 `services.db`。

## 从旧版 JSON 导入

如果你之前使用的是旧版 `services.json`：

1. 启动新版本应用
2. 点击顶部的“导入配置”
3. 选择旧的 `services.json`

导入后，数据会写入新的 SQLite 数据库 `services.db`。

## 日志行为

- 每次启动会生成新的日志文件
- stdout 会写入普通日志
- stderr 会按行自动分流：`INF` / `INFO` / `WRN` / `WARN` / `DEBUG` 等运行信息进入普通日志，`ERR` / `ERROR` / `FATAL` / `PANIC` 或无法判断的内容进入错误日志
- 日志窗口默认轮询刷新
- 当前实现更偏向“开发阶段可读性”，不是日志平台

## 已知限制

- “已有进程发现”仍然是基于命令行匹配，不是绝对可靠
- 软件关闭后，已启动进程不一定还能继续被本软件追踪管理
- 桌面快捷方式图标更新通常需要重新打包并重新安装
- 当前没有系统开机自启、导出配置、环境变量编辑

## 后续建议

- 开机自启
- 环境变量编辑
- 端口探活 / 健康检查
- 日志尾部增量读取
- 导出配置
- 更稳定的进程发现策略
- Windows Service 模式
