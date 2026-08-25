# 测试报告 — 001-dsh-market

> 对应测试用例: [test-cases.md](../../specs/001-dsh-market/test-cases.md)
> 测试日期: 2026-08-25
> 测试环境: 开发态（`npm start`，Windows 11，系统 Node 24.8.0 + corepack pnpm）

## 一、测试结果总览

| 用例 | 描述 | 结果 |
|------|------|------|
| TC-001 | 版本号更新 | ✅ 通过 |
| TC-002 | dsh-market 产物收集 | ✅ 通过 |
| TC-003 | 自动加载（市场入口出现） | ✅ 通过 |
| TC-004 | 浏览社区目录 | ✅ 通过 |
| TC-005 | 安装插件（开发态） | ⏸ 未执行（需真实插件 + 网络 + pnpm 安装） |
| TC-006 | 卸载插件 | ⏸ 未执行（依赖 TC-005） |
| TC-007 | 插件开关持久化 | ⏸ 未执行（依赖 TC-005） |
| TC-008 | 主题切换持久化 | ⏸ 未执行（依赖 TC-005） |
| TC-009 | 市场不擅自重启 | ✅ 通过 |
| TC-010 | profile 正确性 | ✅ 通过 |
| TC-101~104 | 打包态冒烟 | ⏸ 未执行（需 `npm run make` + 干净机器） |
| TC-201~203 | 边界/负向 | ⏸ 未执行 |

**开发态核心链路（内置 + 自动加载 + 配置 + 安装通道）已全部验证通过。**

## 二、已验证用例详情

### TC-001 版本号更新 ✅
- `package.json` version = `0.1.1`（typecheck 输出 `deepseek-harness-desktop@0.1.1` 确认）。

### TC-002 dsh-market 产物收集 ✅
- `build-dsh.mjs` 成功构建 dsh-market（`lib/` + `client/client.js` 产出）。
- `collect-dsh.mjs` 的 `collectDshMarket()` 物化 dshmarket（lib/client/cordis.patch.yml/package.json + 运行时依赖）到 dsh-dist。
- 开发态 `ensureDshMarketMaterialized` 物化到 `dsh/node_modules/dshmarket`（含 undici/js-yaml/argparse）。

### TC-003 自动加载 ✅
- `dsh-market/status` → 200，JSON 含 `"version":"1.26.0"`、`"installed":{"dshmarket":"1.26.0"}`。
- `plugins/dshmarket/client.js` → 200（438KB，client bundle 被服务）。
- index.html 的 `__DSH_BOOT__` 注入含 `{"id":"dshmarket","url":"/plugins/dshmarket/client.js?rev=...","inject":[dsh-client-connection, dsh-client-runtime, dsh-client-locale, dsh-client-ui-settings, dsh-client-ui-theme]}`。

### TC-004 浏览社区目录 ✅
- `dsh-market/registry` → 200。

### TC-009 市场不擅自重启 ✅
- `status` 返回 `"restart":false`，确认 `config.allowRestart: false` 生效。

### TC-010 profile 正确性 ✅
- `status` 确认 profile 为 desktop（市场自识别 `installed.dshmarket`，profile 目录为 `$DSH_HOME/profiles/desktop`）。

### 安装通道（dsh CLI 可 spawn）✅
- `runtime.ts` 生成的 `dsh.cmd` shim 内容正确：`node "<dsh>/apps/cli/lib/bin.js" %*`。
- `node bin.js --version` → `0.1.1-rc.2`（dsh CLI 可运行）。
- `status` 返回 `"pnpm":true`（pnpm 可检测）。

## 三、排查过程中发现并修复的问题

| 问题 | 根因 | 修复 |
|------|------|------|
| host 启动失败（client 包缺 lib） | dsh 更新到 tag 后未重建 | `pnpm install --no-frozen-lockfile` + `npm run build:dsh` |
| dshmarket 未加载（stale profile） | `ensureDesktopProfile` 只复制一次 | 改为 bundles 不一致时重复制（C1） |
| `Cannot find package 'undici'` | 物化排除了运行时依赖 | `copyMarketRuntimeDeps` 递归复制生产依赖 |
| client bundle 404 | client 扫描走 profile 目录，物化在 install anchor | `ensureDshMarketProfileLink` 链接到 profiles/node_modules |
| dev 安装通道缺失 | `dsh` 不在 PATH | `setupMarketRuntime` 生成 dev `dsh` shim + PATH |

## 四、遗留测试项（建议后续执行）

1. **TC-005/006/007/008**（安装/卸载/开关/主题）：需在联网环境安装一个真实插件（如 `@liustack/modlens`），验证 `dsh plugin add` → pnpm → reconcile → hot-mount 全链路。
2. **TC-101~104**（打包态）：`npm run collect:dsh` → `npm run fetch:runtime`（下载便携 Node+pnpm）→ `npm run make` → 在无系统 Node 的干净机器上验证安装插件。
3. **升级迁移**：种子 0.1.0 旧 profile（bundles 无 dshmarket），启动 0.1.1，验证市场加载。
