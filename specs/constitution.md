# constitution.md — 宪法原则

> deepseek-harness-desktop 项目宪法原则（从产品概念设计与脚手架代码提取，2026-08-14）。
> 本文件为「描述性」——记录本工程遵循的原则，任何模块 plan.md 需对照本节做合规检查。

## 1. 架构宪法

1. **零上游改动**：复用 dsh 现有 HTTP 载体（`WebApiClient` + webserver 路由），**不新写 IPC 载体**、不 fork dsh UI。桌面能力优先以 host 插件/启动代码注入。
2. **进程内 Host（MVP）**：Host + webserver 跑在主进程；进程边界设计成可迁移到 `utilityProcess`/子进程（渲染进程只认 localhost，迁移透明）。
3. **只写装配代码**：复用 `runProfile` / `boot` / 现有插件机制，桌面壳只做「装配 + 壳层能力」。
4. **同源数据面**：渲染进程同源加载 `http://127.0.0.1:<port>/`，零 CORS、零鉴权、零自定义协议。

## 2. 安全宪法

1. **安全基线**：`sandbox:true` + `contextIsolation:true` + `nodeIntegration:false`（渲染进程）。
2. **导航加固**：仅允许应用自身 URL（localhost / dev server）原地导航；外部 URL 交系统浏览器。
3. **权限白名单**：`clipboard-sanitized-write` + `notifications`，且受信来源 + 对应 webContents。
4. **Fuses**：`RunAsNode=false`、`OnlyLoadAppFromAsar=true` 等危险能力关闭。
5. **单实例锁**：应用只允许单实例运行。

## 3. IPC 宪法（薄 IPC）

1. **数据面不过 IPC**：对话、文件等业务数据走 HTTP + WebSocket（同源）。
2. **IPC 仅壳层关注点**：窗口控制（min/max/close）等，经 `contextBridge` 暴露为 `window.dsh`。
3. **preload 最小暴露**：只暴露必要 API，不暴露 Node 能力给渲染进程。

## 4. 代码质量宪法

1. **TypeScript strict**：`strict: true`，严禁 `as any` / `@ts-ignore` / `@ts-expect-error` 压制类型错误。
2. **严禁空 catch**：错误处理必须显式（记录或抛出声明）。
3. **最小改动**：修 Bug 只做最小改动，严禁顺便重构。
4. **源码即真理**：规范文档每条声明可追溯到源码，不臆测；不确定处标注 `[NEEDS CLARIFICATION]`。

## 5. 生命周期宪法

1. **后台驻留**：关窗 = 隐藏到托盘，`window-all-closed` 不退出；真正退出走托盘「退出」。
2. **优雅关闭**：退出时 `shutdown.shutdown()` dispose 插件树。
3. **崩溃兜底**：`uncaughtException` / `unhandledRejection` 记录，防止静默崩溃（MVP 已知代价：harness 在主进程 = 应用级崩溃）。

## 6. 提交与流程宪法

1. **Conventional Commits**：提交注释用 `git-commit` 技能规定的 type 前缀（feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert），严禁其它前缀。
2. **规范驱动**：开发遵循 `specs-based-devflow` 完整生命周期（规格 → 开发 → 审查 → 测试 → 修复 → 回归）。
3. **代码审查**：每个任务完成后、合并前，用 `requesting-code-review` / `receiving-code-review` 审查。
