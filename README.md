# DeepSeek Harness Desktop

> 基于 Electron 的 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 桌面封装，提供深度桌面集成体验。

**当前状态**：🚧 设计阶段——产品概念设计已完成，代码尚未开始。详见 [docs/000-产品概念设计.md](docs/000-产品概念设计.md)。

---

## 这是什么

DeepSeek Harness（`dsh`）是 DeepSeek AI 开源的 agent harness（智能体框架），采用「一切皆插件」的架构，原生入口是 `dsh web`（浏览器 Web UI）。

本项目用 Electron 把 `dsh` 的 Web UI 装进原生桌面壳，补齐托盘、通知等桌面能力，界面功能完全沿用 dsh 标准前端，让 agent harness 像一个真正的桌面应用那样运行——**不是**「包一层 `dsh web` 指向 localhost」的粗壳，而是按 dsh 现有架构实现的一等公民桌面应用。

## 核心设计

`dsh` 已完成 **Host/Client 分层**，且它的 webserver **同时服务 SPA dist 和 `/api`**。因此桌面壳采用**进程内 Host + webserver + localhost 同源数据面**：

```
┌─ Electron 主进程（Node.js，也承载 dsh Host）─────────────────┐
│  runProfile('desktop', ['--port','0']) → { ctx, shutdown }    │
│    ├─ webserver   ← 绑定 127.0.0.1:<空闲端口>，服务 dist + /api│
│    ├─ apiProxy    ← RPC 网关                                  │
│    └─ connection  ← 已把 /api + WebSocket 注册到 webserver     │
│  就绪后 loadURL(`http://127.0.0.1:${ctx.webServer.port}/`)    │
│  ┌─ Tray / Notification：订阅 ctx 的 session/event            │
│  └─ 无边框窗口控制：薄 IPC(min/max/close)                     │
└──────────────▲───────────────────────────────────────────────┘
               │ contextBridge：window.dsh（仅窗口控制等薄 IPC） │
┌──────────────┴───────────────────────────────────────────────┐
│ 渲染进程：loadURL('http://127.0.0.1:<port>/')  ← 同源          │
│   标准 dsh Web UI（WebApiClient：fetch /api + WS 事件流）      │
└──────────────────────────────────────────────────────────────┘
```

关键点：**渲染进程同源加载 localhost，零 CORS、零鉴权、零自定义协议、零 IPC 载体**——复用 dsh 现有的 `WebApiClient`（HTTP 上行 + WebSocket 下行），**零上游改动**。

## 计划中的 MVP 功能

- ✅ 系统托盘 + 后台驻留
- ✅ 原生通知
- ✅ 无边框窗口 / 自绘标题栏
- ✅ 剪贴板图片粘贴

（暂缓：全局快捷键唤起、开机自启、多窗口；原生文件选择沿用 dsh 标准前端目录浏览）

## 目标平台与分发

- **平台**：Windows + Linux（macOS 后续再考虑）
- **分发**：先本地打包自用（Electron Forge `make`），暂不做自动更新、代码签名、商店分发

## 技术栈

- **Electron** + **Electron Forge**（脚手架与打包）
- **deepseek-harness**（与本工程**同级目录**，非 submodule，引用路径 `../deepseek-harness`；消费方式为本地源码引用）
- **TypeScript**

## 目录结构（规划）

```
deepseek-harness-desktop/
├── docs/                      # 产品概念设计、后续规格文档
├── profiles/desktop/          # 自定义 desktop profile（dsh.profile + cordis.patch.yml）
├── src/
│   ├── main/                  # Electron 主进程（= dsh Host 宿主）
│   │   ├── index.ts           # 单实例锁 → runProfile → 建窗 → 托盘/生命周期
│   │   ├── host.ts            # runProfile('desktop') → { ctx, shutdown }；就绪判定
│   │   ├── windows.ts         # BrowserWindow、loadURL(localhost)、无边框/titleBarOverlay、安全
│   │   ├── tray.ts            # 系统托盘 + 后台驻留
│   │   ├── notifications.ts   # 订阅 ctx session/event → 原生通知
│   │   └── lifecycle.ts       # NO_PROXY/CA、崩溃兜底、优雅关闭
│   ├── preload/index.ts       # contextBridge：window.dsh（薄 IPC）
│   └── renderer/index.html    # 极薄：loadURL 到 localhost
├── forge.config.ts            # Electron Forge 配置
└── resources/                 # 应用图标、托盘图标
```

## 相关文档

- [docs/000-产品概念设计.md](docs/000-产品概念设计.md) —— 产品概念设计（架构方案、数据流、模块划分、开放问题）
- [AGENTS.md](AGENTS.md) —— AI Agent 工作规范

## 参考

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（同级目录 `../deepseek-harness`）—— 被封装的宿主，其 `docs/` 目录含完整架构文档
- [opencode](https://github.com/sst/opencode)（桌面壳参考：`packages/desktop/`）—— 类似的「用 Electron 包装 agent harness」需求

## 许可证

[MIT](LICENSE) © 2026 fellow99
