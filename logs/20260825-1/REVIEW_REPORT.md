# 代码审查报告 — 201-dsh-market

> 审查范围: `9a147a6..77360e5`（feat + fix 两个提交）
> 审查方式: requesting-code-review 技能派发 general 审查子代理
> 审查日期: 2026-08-25
> 审查结论: **No — with fixes**（1 Critical + 5 Important + 9 Minor）

## 一、审查结论摘要

核心架构（两阶段物化：开发态 `ensureDshMarketMaterialized` vs 打包态 `collectDshMarket`）、上游契约核实（pnpm 资产名、dsh-market 的 `dshArgv()`/`spawnEnv()`、`allowRestart` 落位）、类型安全（无 `as any`/`@ts-ignore`）、安全（`RunAsNode` 关闭、PATH 前置）均获认可。

发现 1 个 Critical、5 个 Important、9 个 Minor，集中在**升级路径、PATH 完整性、失败模式**等边界加固上——这些是全新安装的 dev 冒烟测试无法覆盖的。

## 二、问题清单与处置

### Critical

| 编号 | 问题 | 处置 |
|------|------|------|
| C1 | `ensureDesktopProfile` 只复制一次，0.1.0 老用户升级到 0.1.1 拿不到 dshmarket bundle（升级路径静默失效） | ✅ 已修复：比较 src/dest 的 `dsh.profile.bundles`，不一致则重新复制 |

### Important

| 编号 | 问题 | 处置 |
|------|------|------|
| I1 | `runtime/` 未加入 `.gitignore`，便携 Node+pnpm（~120MB）会被误提交 | ✅ 已修复：`.gitignore` 加 `/runtime` |
| I2 | 便携 Node 的 bin 目录未入 PATH，pnpm 运行插件生命周期脚本（`prepare` 等）时按名调用 `node` 会失败 | ✅ 已修复：`runtime.ts` 的 PATH 加入 nodeDir |
| I3 | dsh-market 缺失时打包脚本仅 warn 跳过，产出无市场的应用且无明确报错 | ✅ 已修复：`collect-dsh.mjs` 改为 `process.exit(1)` |
| I4 | 开发态物化永不刷新陈旧构建（开发者重建 dsh-market 后旧产物残留） | ✅ 已修复：mtime 比较，src lib 更新则 `rmSync` 重物化 |
| I5 | profile 声明 `dependencies.dshmarket` 可能导致市场跑 `dsh plugin add` 时 pnpm 重新解析/覆盖物化副本 | ⏸ 待运行时验证（TC-005/TC-102），暂不改（需同时满足 FR-004 与市场「installed」自识别） |

### Minor

| 编号 | 问题 | 处置 |
|------|------|------|
| M1 | 传递依赖复制对 scoped 包路径（`@scope/pkg`）——经核实 `join` 正常化分隔符，当前代码正确 | ✅ 核实无误，无需改 |
| M2 | 非 hoisted 嵌套依赖可能被 BFS 遗漏——当前依赖树（undici/js-yaml/argparse）无冲突，不触发 | 📝 记录，未来加递归兜底 |
| M3 | `symlinkSync(..., 'junction')` 在 POSIX 语义不清 | 📝 记录（当前 POSIX 下 junction 被忽略、退化为目录软链，功能正确） |
| M4 | 下载运行时无校验和——本地自用可接受 | 📝 记录（供应链加固后续做） |
| M5 | `fetch-runtime.mjs` 未知架构静默回退 x64 | 📝 记录（后续显式报错） |
| M6 | 物化部分失败留下「已完成」标记 | 📝 记录（后续原子化：临时目录 + rename） |
| M7 | `copyMarketRuntimeDeps` 在 host.ts 与 collect-dsh.mjs 重复 | 📝 记录（主进程 TS 无法 import 根级 .mjs，结构权衡） |
| M8 | `build-dsh.mjs` 双重构建（`prepare` + 显式 build） | 📝 记录（约 30s，可 `--ignore-scripts`） |
| M9 | 堆叠 JSDoc 注释错位 | ✅ 已修复 |

## 三、修复后的验证

- `npm run typecheck` 通过（无新增错误）。
- `node --check scripts/collect-dsh.mjs` 通过。
- 修复均为最小改动，未触及已验证的核心物化/路由/PATH 注入逻辑。

## 四、遗留验证项

1. **TC-005 / TC-102**：打包应用在无系统 Node 的干净机器上验证安装插件（验证 I2 的 PATH 完整性 + I5 的 pnpm 重解析风险）。
2. **升级迁移**：种子一个 0.1.0 时代的旧 profile（bundles 无 dshmarket），启动 0.1.1，验证市场加载（回归 C1 修复）。
