# DeepSeek Harness Desktop

> 基于 Electron 的 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 桌面封装，提供深度桌面集成体验。

**当前状态**：✅ 脚手架与消费 dsh 已完成——主进程 `runProfile('desktop')` 挂起 dsh Host，渲染进程同源加载 dsh Web UI（托盘/通知等 MVP 能力待接入）。详见 [docs/000-产品概念设计.md](docs/000-产品概念设计.md)。

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

## 开发

### 消费 dsh（源码引用）

dsh 与本工程同级目录、源码引用，开发前需先构建 dsh（一条命令，含 Electron 兼容 patch 自动 apply）：

```bash
npm run build:dsh   # apply patches/ 补丁 + 安装依赖 + 构建 lib host/client + web dist
```

### Electron 兼容处理

dsh 的 loader 通过 `node-addon-require-builtin` 原生模块（依赖 Electron V8 缺失的
`GetAlignedPointerFromEmbedderData` 符号）或 `--expose-internals` 获取 Node 内部 API，
两者在 Electron 下均不可用。`src/main/host.ts` 做了如下兼容：

1. **workspace 包链接**：loader 回退默认 ESM import，需把 dsh workspace 包链接到其根
   node_modules（`ensureWorkspaceLinks`）。
2. **禁用 HMR**：`cordis-plugin-hmr` 依赖 Node 内部 API，Electron 下无法工作，设
   `DSH_DISABLE_HMR=1` 跳过 runProfile 的 watch-only HMR 挂载。该开关由
   `patches/dsh-disable-hmr.patch` 提供，`build:dsh` 脚本自动 apply 到 dsh 源码
   （详见 specs 的 patches 机制说明）。

### 启动 / 打包

```bash
npm install
npm start          # 开发模式：Vite 构建 + 启动 Electron，主进程挂起 dsh Host 并加载其 Web UI
npm run package    # 打包：out/DeepSeek Harness Desktop-win32-x64/
```

> 打包目前仅含桌面壳；dsh 构建产物（lib host/client + web dist）打进 resources 属后续步骤。

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
