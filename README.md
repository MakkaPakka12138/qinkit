# 轻启服务管理器

一个基于 **Rust + Vue 3 + Tauri 2** 的 Windows 轻量命令托管器。

它不是 Docker，也不是完整 Windows Service 替代品。  
它做的事情很朴素：把你平时在 CMD 里输入的启动命令保存起来，然后一键启动、停止、重启、看日志、崩溃自动重启。

## 功能

- 添加 / 编辑 / 删除服务
- 启动 / 停止 / 重启服务
- 批量启动启用服务
- 批量停止运行服务
- stdout / stderr 日志写入文件
- 最近 500 行日志查看
- 软件启动后自动启动指定服务
- 服务崩溃后自动重启
- 使用 `taskkill /T /F` 尽量清理 Windows 子进程树

## 环境要求

Windows 下建议准备：

1. Node.js LTS
2. Rust stable
3. Visual Studio Build Tools，包含 C++ 桌面开发工具
4. WebView2 Runtime，Windows 10/11 通常已有

## 开发运行

```bash
npm install
npm run tauri:dev
```

## 打包成 exe

```bash
npm run tauri:build
```

打包产物一般在：

```text
src-tauri/target/release/bundle/
```

通常会生成 NSIS 安装包和 MSI 安装包。

## 使用方式

比如你原来在 CMD 中输入：

```bat
cd /d E:\project\backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

在软件里配置：

```text
启动命令：
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000

工作目录：
E:\project\backend

stdout 日志：
E:\project\backend\logs\backend.out.log

stderr 日志：
E:\project\backend\logs\backend.err.log
```

启动命令会通过：

```bat
cmd.exe /C "<你的启动命令>"
```

执行。

## 注意

这版是轻量进程管理器，不是系统级 Windows Service。

也就是说：

- 软件关闭后，不保证被它启动的服务还可被继续管理
- 它适合开发机、本地工具、小型后台服务
- 如果要“无人登录也长期运行”，后续需要加 Windows Service 模式或者配合任务计划程序开机启动本软件

## 后续可加功能

- 托盘运行
- 开机自启
- 服务分组
- 环境变量编辑
- 日志滚动策略
- 服务状态端口探活
- 导入 / 导出配置
- 真正 Windows Service wrapper 模式
