[English](./README.md) | 中文

---

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

- ✅ 系统托盘（退出/唤回）
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

### 集成方式

- **源码引用**：dsh 与本工程同级目录（`../deepseek-harness`，非 submodule），消费其编译产物。
- **Host 集成**：`src/main/host.ts` 动态 import dsh 的 `runProfile`（apps/cli 编译产物），
  主进程内挂起 dsh Host（webserver 绑定 `127.0.0.1:<空闲端口>`），返回
  `{ ctx, shutdown, port, url }` 句柄。
- **同源数据面**：渲染进程 `loadURL(http://127.0.0.1:<port>/)` 同源加载 dsh Web UI，复用
  `WebApiClient`（HTTP 上行 + WebSocket 下行），零 CORS、零鉴权、零新载体。
- **desktop profile**：`profiles/desktop/`（`dsh.profile.bundles = [dsh-base, dsh-web-app]`，
  cordis.patch.yml 覆盖 `web-runtime.printUrl: false`），运行时复制到
  `$DSH_HOME/profiles/desktop`。

### 编译过程（含 patches）

dsh 依赖 Node 内部 API（HMR、原生目录对话框），Electron 下不可用，需打两个补丁后构建。
一条命令完成（幂等，`--reverse --check` 检测已应用则跳过）：

```bash
npm run build:dsh   # ① git apply patches/ 两个补丁 → ② pnpm install（node_modules 缺失时）→ ③ build:lib:host + build:lib:client + build:web
```

| 补丁 | 作用 |
|---|---|
| `patches/dsh-disable-hmr.patch` | 给 `runProfile` 加 `DSH_DISABLE_HMR` 开关，跳过 watch-only HMR（HMR 依赖 `--expose-internals`）|
| `patches/dsh-disable-native-picker.patch` | 让 directory-picker 在 Electron 下强制用 browse（原生对话框 worker 用 electron.exe 启动失败）|

> Electron 兼容根因：dsh 的 loader 经 `node-addon-require-builtin` 原生模块获取 Node 内部
> ESM loader，该模块依赖 Electron V8 缺失的 `GetAlignedPointerFromEmbedderData` 符号而失效；
> 开发模式下 loader 回退默认 ESM import，由 `host.ts` 的 `ensureWorkspaceLinks` 把 workspace
> 包链接到 dsh 根 node_modules 解决。

### 启动 / 打包

```bash
npm install
npm start          # 开发模式：Vite 构建 + 启动 Electron，主进程挂起 dsh Host 并加载其 Web UI
npm run package    # 打包：prepackage 自动 collect（pnpm deploy 物化 dsh 产物到 dsh-dist/，extraResource 打进 resources/dsh-dist）
```

> 打包产物 `out/DeepSeek Harness Desktop-win32-x64/` 已含 dsh（lib + node_modules + web dist + profile），exe 可直接运行 dsh。

## 目录结构

本工程与 deepseek-harness（dsh）**同级目录**（非 submodule），经源码引用集成：

```
（同级目录）
├── deepseek-harness-desktop/      # 本工程（Electron 桌面壳）
│   ├── docs/                      # 产品概念设计
│   ├── specs/                     # 规范文档（as-built，索引见 specs/README.md）
│   ├── patches/                   # dsh 上游补丁（git apply，build:dsh 自动应用）
│   │   ├── dsh-disable-hmr.patch
│   │   └── dsh-disable-native-picker.patch
│   ├── scripts/                   # 构建脚本
│   │   ├── build-dsh.mjs          # apply patches + 安装依赖 + 构建 dsh 产物
│   │   └── collect-dsh.mjs        # 收集 dsh 产物到 dsh-dist/（pnpm deploy + 物化）
│   ├── profiles/desktop/          # 自定义 desktop profile（dsh.profile.bundles + cordis.patch.yml）
│   ├── src/
│   │   ├── main/                  # Electron 主进程（= dsh Host 宿主）
│   │   │   ├── index.ts           # 单实例锁 → 启动 host → 建窗 → 托盘/通知/生命周期
│   │   │   ├── host.ts            # runProfile('desktop') → { ctx, shutdown }；就绪判定
│   │   │   ├── windows.ts         # BrowserWindow、loadURL(localhost)、无边框/安全
│   │   │   ├── tray.ts            # 系统托盘（退出/唤回）
│   │   │   ├── notifications.ts   # 订阅 ctx session/event → 原生通知
│   │   │   └── lifecycle.ts       # NO_PROXY/CA、崩溃兜底
│   │   ├── preload/index.ts       # contextBridge：window.dsh（薄 IPC）
│   │   └── renderer/renderer.ts   # 极薄渲染入口（兜底加载页）
│   ├── forge.config.ts            # Electron Forge 配置（extraResource 打进 resources/dsh-dist）
│   ├── vite.*.config.ts           # Vite 配置（main/preload/renderer）
│   ├── index.html                 # 渲染入口（Forge Vite 约定在项目根）
│   └── resources/                 # 应用图标、托盘图标
│
└── deepseek-harness/              # 被封装宿主（dsh，源码引用，非 submodule）
    ├── apps/                      # cli（dsh bin，profile-boot）、web（Web 前端，build:web 产出 dist）
    ├── packages/                  # host / client / core / session 等 workspace 包
    ├── vendor/                    # vendored cordis 框架包（cordis / loader / hmr 等）
    └── native/                    # landlock-run 原生模块（Linux 沙箱，MVP 已裁掉）
```

## 相关文档

- [docs/000-产品概念设计.md](docs/000-产品概念设计.md) —— 产品概念设计（架构方案、数据流、模块划分、开放问题）
- [specs/README.md](specs/README.md) —— 规范文档索引（项目级 + 模块级规格文档）
- [AGENTS.md](AGENTS.md) —— AI Agent 工作规范

## 参考

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（同级目录 `../deepseek-harness`）—— 被封装的宿主，其 `docs/` 目录含完整架构文档
- [opencode](https://github.com/sst/opencode)（桌面壳参考：`packages/desktop/`）—— 类似的「用 Electron 包装 agent harness」需求

## 许可证

[MIT](LICENSE) © 2026 fellow99
