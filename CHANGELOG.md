# 更新日志 · 汇芯网页转桌面（huixin-web-to-desktop）

## [v1.0.0] - 2026-11-24

### 新增功能
- **原生轻量壳引擎（macOS WKWebView）**：基于预编译原生 Swift 极简壳（核心二进制仅 240 KB），零 Rust / Xcode / npm 依赖，2–5 秒将任意网页打包成 **0.5–1.7 MB** 独立 `.app` 与 `.dmg`，内置 `Network.framework` 静态服务器、全栈子进程守护、文件上传下载、独立登录态持久化、CSS/JS 注入、完整编辑快捷键与托盘驻留。
- **双模式通吃**：支持「在线网址转桌面 App」与「本地网页/全栈项目转桌面 App」（自动探测 HTML / Vite / Next.js standalone / Node.js / Python FastAPI / Flask / Streamlit）。
- **Electron 全能跨平台引擎**：支持一键生成完整 Electron + `electron-builder` 跨平台工程及 `.github/workflows/build-desktop.yml` 三端免环境云构建工作流（覆盖 macOS / Windows / Linux）。
- **可视化桌面端工作台（自举打包）**：提供零依赖高颜值桌面 GUI，内置 6 个热门网址一键预设、原生文件/图标选择器、实时桌面窗口预览、已打包应用历史库，并用自家引擎自举打包出完全自包含的 `汇芯网页转桌面.app`（1.67 MB）与 `.dmg`。
- **三位一体交付**：同时提供可视化桌面端 APP、零依赖命令行 `hxweb2app` 与标准 AI Agent Skill（`SKILL.md`）。

### 兼容与说明
- 运行环境：Node.js >= 18（纯标准库，零第三方依赖安装）。
- 原生轻量引擎当前支持 macOS 12+（Apple Silicon / Intel 均可本机编译）；Windows / Linux 用户请使用 `--engine electron` 跨平台引擎。
