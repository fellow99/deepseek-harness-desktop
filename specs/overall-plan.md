# overall-plan.md — 整体技术方案

> deepseek-harness-desktop 系统级技术方案（技术对应 overall-spec，2026-08-14）。
> 本文档描述系统「如何构建」，是各模块 plan.md 的总纲。

## 1. 技术上下文

- **运行时**：Electron `^43.4.0`（主进程 Node.js，也承载 dsh Host；渲染进程 Chromium）。
- **构建**：Electron Forge `^7.11.2` + `@electron-forge/plugin-vite`（vite-typescript 模板），`main` 指向 `.vite/build/main.js`。
- **语言**：TypeScript `^5.6.0`（strict）。
- **宿主**：deepseek-harness（同级目录 `../deepseek-harness`，源码引用）。
- **关键 dsh 依赖**：`dsh-host-webserver`（服务 dist + `/api`）、`dsh-client-connection`（`/api` 路由 + WS）、`dsh-host-apiproxy`（`ctx.apiProxy`）、`dsh-app-boot`（`runProfile`）。

## 2. 宪法合规检查

| 原则 | 状态 | 说明 |
|---|---|---|
| 零上游改动 | ✅ | 复用 `WebApiClient` + webserver 路由，无 fork、无新载体 |
| 进程内 Host | ✅ | `src/main/host.ts` runProfile 进程内挂起 |
| 只写装配代码 | ✅ | 桌面壳仅装配 + 壳层能力 |
| 同源数据面 | ✅ | `loadURL(localhost)`，零 CORS/鉴权 |
| 安全基线 | ✅ | sandbox/contextIsolation/无 nodeIntegration（windows.ts） |
| 薄 IPC | ✅ | 仅窗口控制，`contextBridge` 暴露 `window.dsh` |
| TypeScript strict / 无 as any | ✅ | 脚手架 typecheck 通过（EXIT 0） |
| 后台驻留 / 优雅关闭 | ✅ | close 隐藏 + `shutdown.shutdown()` |

## 3. 实现策略概述

### 3.1 启动编排（src/main/index.ts）

```
单实例锁 → 安全设置（CA/NO_PROXY/崩溃兜底）→ whenReady
  → registerWindowIpcHandlers
  → startHost()（runProfile desktop + --port 0）
  → createMainWindow(host.url)  // 就绪后建窗
  → createTray + setupNotifications
```

双门就绪（参考 opencode）：主进程 `await startHost()` 后才建窗，避免渲染进程加载竞争。

### 3.2 Host 集成（src/main/host.ts）

`runProfile({ profile:'desktop', args:['--port','0'] })` → `{ ctx, shutdown }`；读 `ctx.webServer.port` 拼 `http://127.0.0.1:<port>/`。
- 端口 0 = OS 分配（dsh webserver 支持，`config.port` 为 0 时返回实际端口）。
- desktop profile（profiles/desktop）：`dsh.profile.bundles = [dsh-base, dsh-web-app]`，cordis.patch.yml 覆盖 `web-runtime.printUrl: false`。
- **当前状态**：脚手架阶段未接入（返回 null），主进程显示兜底页。

### 3.3 窗口与安全（src/main/windows.ts）

- 无边框 + `titleBarOverlay`（win32）；`sandbox:true` + `contextIsolation:true` + `nodeIntegration:false`。
- 导航加固：`setWindowOpenHandler` 一律 deny + 外部 URL 走 shell；`will-navigate` 仅允许受信来源。
- 权限白名单：`clipboard-sanitized-write` + `notifications`。

### 3.4 托盘与通知（tray.ts / notifications.ts）

- 托盘：`Tray` + 菜单（显示/退出）；关窗 `preventDefault` + hide 实现后台驻留。
- 通知：`ctx.on('session/event')` 过滤 `turn/end`（completed/error）与 `approval/asked`；`agent/error` 兜底。

## 4. 横切关注点

### 4.1 错误处理

- 业务错误走 dsh 的 `RpcError`（`RpcResult.error` 分支），桌面壳不拦截。
- webserver 监听失败（EADDRINUSE）由 dsh boot 大声失败上报。
- 主进程 `uncaughtException` / `unhandledRejection` 记录兜底（lifecycle.ts）。

### 4.2 安全

见 constitution.md 第 2 节 + windows.ts 实现。

### 4.3 日志

- 脚手架阶段用 `console.error` 占位；TODO 接入日志框架（参考 opencode 的 electron-log）。

### 4.4 代理与证书

- `ensureLoopbackNoProxy`（NO_PROXY 并入 loopback + Chromium proxy-bypass-list）。
- `setupSystemCertificates`（合并系统 CA，Node 24 `node:tls` API，运行时守卫）。

## 5. 测试方法

- **单元**：host 启动 + `toFetchHandler` 冒烟（dsh 消费后）。
- **集成**：`runProfile` + 就绪判定（dsh 消费后）。
- **e2e**：Playwright 驱动 Electron（后续可选）。
- 脚手架阶段：typecheck（`npm run typecheck`）作为基本质量门。

## 6. 部署策略

- **本地打包**：`npm run make`（Forge makers：squirrel/zip/deb/rpm）。
- **宿主产物**：dsh 的 lib host/client + web dist 随包打入 resources（消费 dsh 时）。
- **ABI**：MVP 裁掉 dsh native 沙箱（landlock），规避 Electron Node ABI 不一致。
