# TECH.md — 技术选型

> deepseek-harness-desktop 技术选型记录（2026-08-14）。版本以 `package.json` 为准。

## 1. 技术栈总览

| 类别 | 技术 | 版本 | 用途 |
|---|---|---|---|
| 桌面运行时 | Electron | `^43.4.0` | 桌面壳：主进程（Node.js）+ 渲染进程（Chromium） |
| 构建/打包 | Electron Forge | `^7.11.2` | 脚手架、`start`/`package`/`make` 生命周期 |
| 构建插件 | @electron-forge/plugin-vite | `^7.11.2` | 用 Vite 编译 main / preload / renderer |
| 打包器 | @electron-forge/maker-squirrel | `^7.11.2` | Windows 安装器（Forge 无官方 NSIS） |
| 打包器 | @electron-forge/maker-zip | `^7.11.2` | 免安装目录包（win/linux/darwin） |
| 打包器 | @electron-forge/maker-deb | `^7.11.2` | Linux deb（需 fakeroot + dpkg） |
| 打包器 | @electron-forge/maker-rpm | `^7.11.2` | Linux rpm（需 rpm-build，单独安装） |
| 安全加固 | @electron/fuses + plugin-fuses | `^1.8.0` | 关闭 RunAsNode 等危险能力 |
| 前端构建 | Vite | `^7.3.6` | 编译 TypeScript（main/preload/renderer） |
| 语言 | TypeScript | `^5.6.0` | 类型安全（strict 模式） |
| 宿主 | deepseek-harness (dsh) | 源码引用 | 被封装宿主（同级目录 `../deepseek-harness`） |
| 插件框架 | Cordis | dsh 内置 | 「一切皆插件」依赖注入框架 |
| Windows 依赖 | electron-squirrel-startup | `^1.0.1` | Squirrel 安装/卸载快捷方式处理 |

## 2. 选型理由

### 2.1 构建工具：Electron Forge（而非 electron-vite + electron-builder）

- 产品概念设计已确认决策（第 15 节「构建工具 = Electron Forge，沿用 brief」）。
- 参考实现 opencode desktop 用 `electron-vite + electron-builder`，但本项目需求更简（本地打包自用、无签名/自动更新），Forge 足够且与 `forge.config.ts`（TypeScript 原生支持，Forge ≥7.8.1）契合。
- Forge `@electron-forge/plugin-vite` 的 `build[]` 入口数组支持任意目录结构，匹配本工程 `src/main`、`src/preload`、`src/renderer` 布局。

### 2.2 模板：vite-typescript（而非 webpack-typescript）

- Vite 构建更快、配置更简（三个几乎空的 `vite.*.config.ts`）。
- 注意：Vite 插件自 Forge v7.5.0 起标注 experimental，但对本项目（极薄 renderer、主进程为主）足够；后续如需更成熟可用 webpack 模板替换。

### 2.3 dsh 消费方式：本地源码引用（非 npm 包）

- 产品概念设计第 8 节：`@deepseek-ai/dsh` 只暴露 `bin`（无 `main`/`exports`），`runProfile` 只能从源码 import（`apps/cli/src/profile-boot.ts`）。
- 同级目录 `../deepseek-harness`（非 git submodule），构建时先对 dsh 执行 `pnpm install + build:lib:host + build:web`。

## 3. 关键架构依赖（dsh 内部）

| dsh 包 | 作用 | 本项目如何复用 |
|---|---|---|
| `@deepseek-ai/dsh-host-webserver` | 服务 SPA dist + `/api`，支持 `--port 0` | 主进程 runProfile 挂起，读 `ctx.webServer.port` |
| `@deepseek-ai/dsh-client-connection` | node half 注册 `/api` 路由 + WebSocket；client half 提供 `WebApiClient` | 渲染进程同源 `fetch` + `WebSocket` 复用 |
| `@deepseek-ai/dsh-host-apiproxy` | `ApiProxyService` 提供 `ctx.apiProxy`；`toFetchHandler` | 复用 HTTP 载体 |
| `@deepseek-ai/dsh-app-boot` | `runProfile` / `boot` / profile 机制 | 桌面 profile 装配 |
| `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` | 基础/浏览器面 bundle | desktop profile 的 bundles |

## 4. 运行环境

- **平台**：Windows + Linux（macOS 后续考虑）。
- **Node**：Electron 43 内置（≥ Node 24，支持 `node:tls` 的 `getCACertificates`/`setDefaultCACertificates`）。
- **包管理器**：npm（脚手架）；dsh 构建内部用 pnpm。
