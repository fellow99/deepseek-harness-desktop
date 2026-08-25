# 规格文档索引

**项目名称：** deepseek-harness-desktop
**版本：** 脚手架阶段（N/A）
**技术栈：** Electron + Electron Forge + Vite + TypeScript（封装 deepseek-harness）
**文档生成时间：** 2026-08-14
**最后更新：** 2026-08-25

---

## 一、文档总览

| 层级 | 分类 | 文档数量 | 说明 |
|------|------|---------|------|
| 整体 | 项目级顶层文档 | 8 | 架构、技术、宪法、结构、数据模型等全局文档 + 检查清单 |
| 模块 | 桌面壳模块 | 16 | 001-008 共 8 个模块，各含 spec.md + plan.md |
| 模块 | 扩展模块 | 4 | 201-dsh-market（spec + plan + tasks + test-cases） |
| **合计** | **9 模块目录 / 29 文件**（含 README 索引） | | |

> 注：本项目级规格文档集不含 `API.md`、`overall-api.md`、`overall-test-cases.md`——数据面在 dsh 侧，桌面壳无自有 API 清单，这些文档尚未生成。

---

## 二、项目级顶层文档

全局性的架构、技术、宪法等文档，定义项目基线和开发准则。

| 文档 | 路径 | 说明 |
|------|------|------|
| **方案总纲** | [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统整体架构设计（进程模型、分层、数据流、关键决策） |
| **宪法原则** | [constitution.md](./constitution.md) | 项目开发原则、编码规范、治理规则 |
| **整体规格** | [overall-spec.md](./overall-spec.md) | 系统级功能规格（技术无关） |
| **整体方案** | [overall-plan.md](./overall-plan.md) | 系统级技术方案（各模块 plan 总纲） |
| **技术选型** | [TECH.md](./TECH.md) | 核心技术栈选型理由、版本、依赖说明 |
| **项目结构** | [STRUCTURE.md](./STRUCTURE.md) | 源码目录结构、进程入口、关键配置 |
| **数据模型** | [overall-data-model.md](./overall-data-model.md) | 全局数据实体、状态机、事件流定义 |
| **检查清单** | [SPECS_CHECKLIST.md](./SPECS_CHECKLIST.md) | 规格文档完成度追踪 |

---

## 三、桌面壳模块（001-008）

### 001 — Host 宿主（host）

> 在主进程内 runProfile('desktop') 挂起 dsh Host（含 webserver），返回 Host 句柄（ctx/shutdown/port/url）；就绪判定。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [001-host/spec.md](./001-host/spec.md) | Host 宿主功能规格 |
| 技术方案 | [001-host/plan.md](./001-host/plan.md) | Host 宿主技术实现方案 |

### 002 — 窗口管理（window）

> BrowserWindow 创建、loadURL(localhost)/兜底页、无边框 + titleBarOverlay、安全加固、关窗即退出。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [002-window/spec.md](./002-window/spec.md) | 窗口管理功能规格 |
| 技术方案 | [002-window/plan.md](./002-window/plan.md) | 窗口管理技术实现方案 |

### 003 — 系统托盘（tray）

> 系统托盘（退出/唤回）；托盘菜单（显示主窗口 / 退出）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [003-tray/spec.md](./003-tray/spec.md) | 系统托盘功能规格 |
| 技术方案 | [003-tray/plan.md](./003-tray/plan.md) | 系统托盘技术实现方案 |

### 004 — 原生通知（notification）

> 订阅宿主 ctx 的 session/event 与 agent/error 事件 → Electron 原生通知。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [004-notification/spec.md](./004-notification/spec.md) | 原生通知功能规格 |
| 技术方案 | [004-notification/plan.md](./004-notification/plan.md) | 原生通知技术实现方案 |

### 005 — 生命周期与安全（lifecycle）

> NO_PROXY 并入 loopback、系统 CA 合并、崩溃兜底（uncaughtException/unhandledRejection）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [005-lifecycle/spec.md](./005-lifecycle/spec.md) | 生命周期与安全功能规格 |
| 技术方案 | [005-lifecycle/plan.md](./005-lifecycle/plan.md) | 生命周期与安全技术实现方案 |

### 006 — 薄 IPC 桥（preload）

> contextBridge 暴露 window.dsh（窗口控制 min/max/close/isMaximized）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [006-preload/spec.md](./006-preload/spec.md) | 薄 IPC 桥功能规格 |
| 技术方案 | [006-preload/plan.md](./006-preload/plan.md) | 薄 IPC 桥技术实现方案 |

### 007 — 应用入口编排（app-entry）

> 进程级入口编排器：单实例锁、安装器短生命周期处理、启动编排（安全准备 → 宿主 → 窗口 → 托盘/通知）、生命周期（关窗退出 + 优雅退出）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [007-app-entry/spec.md](./007-app-entry/spec.md) | 应用入口编排功能规格 |
| 技术方案 | [007-app-entry/plan.md](./007-app-entry/plan.md) | 应用入口编排技术实现方案 |

### 008 — desktop profile（desktop-profile）

> 自定义 dsh 桌面 profile：声明式复用 web 组合（dsh-base + dsh-web-app），通过 patch 关闭 URL 打印，端口由启动代码注入。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [008-desktop-profile/spec.md](./008-desktop-profile/spec.md) | desktop profile 功能规格 |
| 技术方案 | [008-desktop-profile/plan.md](./008-desktop-profile/plan.md) | desktop profile 技术实现方案 |

---

## 四、扩展模块（201+）

扩展模块编号从 201 起，区别于 001-008 的桌面壳基础模块，用于在桌面壳之上集成外部能力。

### 201 — dsh-market 插件市场（dsh-market）

> 把 dsh-market（可视化插件市场）内置到桌面封装的 dsh 环境，随 Host 自动加载，并在开发态/打包态打通安装、删除、配置插件通道（便携 Node + pnpm + dsh CLI）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [201-dsh-market/spec.md](./201-dsh-market/spec.md) | dsh-market 集成功能规格（含实现与调试记录） |
| 技术方案 | [201-dsh-market/plan.md](./201-dsh-market/plan.md) | dsh-market 集成技术实现方案（含实现偏差记录） |
| 任务拆解 | [201-dsh-market/tasks.md](./201-dsh-market/tasks.md) | 开发任务与打包态调试修复任务（全部完成） |
| 测试用例 | [201-dsh-market/test-cases.md](./201-dsh-market/test-cases.md) | 功能/打包态/负向用例与实测结果 |

---

## 六、模块编号一览

| 编号 | 模块名 | 英文名 | 分类 |
|------|--------|--------|------|
| 001 | Host 宿主 | host | 桌面壳 |
| 002 | 窗口管理 | window | 桌面壳 |
| 003 | 系统托盘 | tray | 桌面壳 |
| 004 | 原生通知 | notification | 桌面壳 |
| 005 | 生命周期与安全 | lifecycle | 桌面壳 |
| 006 | 薄 IPC 桥 | preload | 桌面壳 |
| 007 | 应用入口编排 | app-entry | 桌面壳 |
| 008 | desktop profile | desktop-profile | 桌面壳 |
| 201 | dsh-market 插件市场 | dsh-market | 扩展模块 |

---

## 七、模块文档结构规范

每个模块目录 `NNN-name/` 下包含以下标准文档：

| 文件 | 命名 | 说明 |
|------|------|------|
| 功能规格 | `spec.md` | 定义模块的功能需求、用户故事、验收标准 |
| 技术方案 | `plan.md` | 模块的技术实现方案、架构决策、组件设计 |

> 如项目需要，模块目录还可扩展以下文档：
> - `tasks.md` — 开发任务拆解、依赖关系、里程碑
> - `api.md` — 模块涉及的 API 接口定义
> - `data-model.md` — 模块所需的实体、类型、枚举定义
> - `pages.md` — 模块包含的页面路由、组件树、交互流程
> - `test-cases.md` — 模块 UI 功能测试用例

---

## 八、快速导航

| 目标读者 | 推荐阅读顺序 |
|---------|-------------|
| **新加入开发者** | constitution.md → STRUCTURE.md → overall-spec.md → 具体模块 spec.md |
| **架构师 / Tech Lead** | ARCHITECTURE.md → TECH.md → overall-plan.md |
| **桌面壳开发** | STRUCTURE.md → 对应模块的 spec.md + plan.md |
| **测试 / QA** | SPECS_CHECKLIST.md → 各模块 spec.md 验收场景 |

---

**文档维护者：** deepseek-harness-desktop 开发团队
