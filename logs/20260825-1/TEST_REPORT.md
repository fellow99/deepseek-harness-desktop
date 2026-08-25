# 测试报告 — 001-dsh-market

> 对应测试用例: [test-cases.md](../../specs/001-dsh-market/test-cases.md)
> 测试日期: 2026-08-25
> 测试环境:
> - 开发态（`npm start`，Windows 11，系统 Node 24.8.0 + corepack pnpm）
> - 打包态（`npm run package` → `out/DeepSeek Harness Desktop-win32-x64/deepseek-harness-desktop.exe`，内置便携 Node 24.11.1 + pnpm 9.15.9）

## 一、测试结果总览

| 用例 | 描述 | 开发态 | 打包态 |
|------|------|--------|--------|
| TC-001 | 版本号更新 | ✅ | ✅ 0.1.1 |
| TC-002 | dsh-market 产物收集 | ✅ | ✅ dsh-dist 内物化完整 |
| TC-003 | 自动加载（市场入口出现） | ✅ | ✅ |
| TC-004 | 浏览社区目录 | ✅ | ✅ registry 200（1.44MB） |
| TC-005 | 安装插件 | — | ✅ dsh-composer-expand@0.1.2 + 聚合插件 @linxin666/dsh-web-ui-all@0.3.3 |
| TC-006 | 卸载插件 | — | ✅ |
| TC-007 | 插件开关持久化 | ⏸ | ⏸（未测开关） |
| TC-008 | 主题切换持久化 | ⏸ | ⏸（未测主题） |
| TC-009 | 市场不擅自重启 | ✅ | ✅ restart=false |
| TC-010 | profile 正确性 | ✅ | ✅ profile=desktop |
| TC-101~104 | 打包态冒烟（内置/页面/通道） | — | ✅ |
| TC-201~203 | 边界/负向 | ⏸ | ⏸ |

**核心结论：打包态下，内置市场 + HTTP 页面 + 便携 Node/pnpm 通道 + 联网安装真实插件 + 重启生效 + 删除，全链路验证通过。**

## 二、打包态验证详情（`npm run package`）

### 1. 产物结构（TC-101）
- `out/DeepSeek Harness Desktop-win32-x64/deepseek-harness-desktop.exe`（225MB）
  - 注：因 forge 配置 `executableName: 'deepseek-harness-desktop'`，可执行文件名不含空格；窗口/应用标题仍为 "DeepSeek Harness Desktop"。
- `resources/dsh-dist/`：`lib/bin.js`、`node_modules/dshmarket/{lib,client,package.json}`、`profiles/desktop/cordis.patch.yml`
- `resources/runtime/`：`node/node.exe`（Node 24.11.1）、`pnpm/{bin,dist,package.json,pnpm.cmd}`（pnpm 9.15.9）

### 2. 启动与 HTTP 页面（TC-102/103）
- 启动日志：`[dsh-desktop] dsh-market 包操作运行时已就绪` → `[dsh-desktop] host 就绪: http://127.0.0.1:<port>/`，stderr 为空。
- `/` → 200（14.8KB），含 `__DSH_BOOT__`，其中 dshmarket 条目正确。
- `dsh-market/status` → 200：`version=1.26.0, pnpm=true, restart=false, region=china, installed.dshmarket=1.26.0`。
- `dsh-market/registry` → 200（1.44MB，社区目录 count=2135）。
- `plugins/dshmarket/client.js` → 200（438667 字节）。

### 3. 便携运行时（TC-104）
- 打包应用无系统 Node 依赖：`runtime/node/node.exe --version` = v24.11.1；`runtime/pnpm/pnpm.cmd --version` = 9.15.9。
- 市场安装插件时，`dsh plugin` 经 `runtime-bin/dsh.cmd` shim 调用便携 node，内部 `spawnSync('pnpm')` 命中 PATH 前置的便携 pnpm——实测完整跑通 pnpm 解析、hardlink、link 阶段（exitCode=0）。

> 构建期网络说明：`fetch-runtime.mjs` 默认从 nodejs.org / GitHub releases 下载，本机直连 nodejs.org 挂死、GitHub releases 被重置。临时改用 npmmirror 镜像下载 Node zip 与 pnpm npm tarball，按 `runtime/` 预期布局放置并写入 `.versions.json` 后，`fetch-runtime` 幂等跳过、`npm run package` 成功。脚本本身逻辑无需改动。

## 三、安装/删除真实插件端到端（TC-005/006，打包态）

插件：`dsh-composer-expand@0.1.2`（UI 类小插件，npm 包，client bundle 7556 字节，来源 `https://github.com/13071301808/dsh-composer-expand`）。

接口契约（从 client bundle 反查）：
- 安装：`POST /dsh-market/install`，body `{"url":"<github url>"}`，需带 `Origin: http://127.0.0.1:<port>`（否则 403 untrusted origin）。
- 删除：`POST /dsh-market/uninstall`，body `{"name":"<pkg>"}`，同样需 Origin。

| 步骤 | 结果 |
|------|------|
| 安装 | `ok=true exitCode=0`，pnpm 装入 11 个包；profile package.json dependencies + bundles 追加该插件；同会话 activation state=`restart`（bundle 层需重启挂载） |
| 重启后 | Host 正常启动；`/dsh-market/installed` 显示该插件 `state=live hot=true`；`/plugins/dsh-composer-expand/client.js` → 200（7556）；`__DSH_BOOT__` 含该插件；dshmarket 仍 live |
| 删除 | `ok=true exitCode=0`；同会话 client.js → 404；profile package.json 回到只剩 dshmarket |
| 再次重启 | Host 正常启动；只剩 dshmarket（live）；已删插件 client.js → 404；dsh-dist 内悬空 junction 被自动清理 |

## 四、测试中发现并修复的问题（打包态实测暴露）

按 systematic-debugging 定位根因后修复，均在 `src/main/host.ts`：

| # | 现象 | 根因 | 修复 |
|---|------|------|------|
| Bug-1 | 安装插件并重启后，插件从 package.json 消失 | `ensureDesktopProfile` 用"bundles 完全相等"判断是否重拷，用户新装的 bundle 与种子不等即整目录 `cpSync` 覆盖，抹掉用户插件 | 改为合并策略：仅补齐缺失的种子依赖/bundle，保留用户追加项；其他种子文件仅在缺失时补齐 |
| Bug-2 | 重启后 Host 启动失败 `ERR_MODULE_NOT_FOUND: dsh-composer-expand` | 用户插件装在 `$DSH_HOME/profiles/desktop/node_modules`（pnpm 独立树），而 `cordis-plugin-loader` 在 `dsh-dist/node_modules/@deepseek-ai/` 用裸名 import，Node 沿 dsh-dist 树向上查找找不到；dsh 自带 `healProfilesModuleFallback` 只链接 install anchor 依赖闭包，不含用户新装包 | 新增 `ensureProfilePluginLinks`：runProfile 前把 profile node_modules 顶层包 junction 到 dsh 根 node_modules，nearest-wins 不覆盖已有包 |
| Bug-3 | 卸载后 dsh-dist 残留指向已删包的悬空 junction | 上一轮启动建的 junction 在 pnpm 删除 profile 包后悬空；清理逻辑被 `if (!existsSync(profileNm)) return` 早退挡住，且 `rmSync({force})` 在 Windows 悬空 junction 上报 "Path is a directory" | 清理无条件前置（不依赖 profileNm 存在）；用 `readlinkSync`+`existsSync` 识别悬空；删除用 `unlinkSync`（不跟随链接），EPERM/EISDIR 回退 `rmdirSync` |
| Bug-4 | 安装聚合型插件 `@linxin666/dsh-web-ui-all` 后，重启 Host 崩溃，AggregateError 列出 19 个 `ERR_MODULE_NOT_FOUND`（`@linxin666/dsh-client-ui-*`、`dsh-better-sidebar`、`@mlgbnb/dsh-archive-manager` 等） | Bug-2 的 `ensureProfilePluginLinks` 只链接了 profile `node_modules` **顶层**包（直接依赖），而 pnpm 把传递依赖放在 `node_modules/.pnpm/node_modules/`（372 个 junction，185 顶层 + 187 scoped，指向 `.pnpm/<pkg>@ver_hash/node_modules/<pkg>` 真实包目录）。聚合插件的 cordis.patch.yml 把十几个传递依赖声明为 loader entry，loader 裸名 `import()` 沿 dsh-dist 目录树查找时到不了 pnpm 虚拟存储，全部解析失败 | 抽出 `linkFlatNodeModules(srcNm, destRoot, skipTop?)` 助手：除 profile 顶层外，额外遍历 `profile/node_modules/.pnpm/node_modules/` 把全部传递依赖也 junction 到 dsh 根 node_modules（nearest-wins，dsh-dist 已物化/顶层已链接的包不覆盖）；悬空清理逻辑不变（已覆盖 rootNm 顶层与各 @scope 子目录） |

### Bug-4 验证（聚合型大插件全量加载）

插件：`@linxin666/dsh-web-ui-all@^0.3.3`（来源 GitHub，安装时 pnpm 装入 372 个包，其 cordis.patch.yml 声明 19 个传递依赖作为 loader entry）。

| 检查项 | 结果 |
|--------|------|
| Host 启动 | `[dsh-desktop] host 就绪: http://127.0.0.1:50306/`，无 AggregateError、无 ERR_MODULE_NOT_FOUND |
| stderr | 仅一条非致命 `[plugin-manager] cannot determine the boot profile` 警告，不影响启动 |
| `/` | 200（20027 字节，Web UI 正常） |
| `/dsh-market/installed` | `@linxin666/dsh-web-ui-all` 与 `dshmarket` 均 `state=live, hot=true`；`bundles=["dshmarket","@linxin666/dsh-web-ui-all"]` |
| `/plugins/dshmarket/client.js` | 200（442152 字节） |

四个 Bug 修复后，安装→重启生效（含聚合型大插件的十几个传递依赖 loader entry）→删除→重启干净的完整循环在打包态通过。

## 五、开发态历史验证（保留）

- dsh CLI 可 spawn：`dsh.cmd` shim 正确，`node bin.js --version` → 0.1.1-rc.2，status `pnpm=true`。
- `config.allowRestart:false` 生效（restart=false）。
- 排查修复过：dsh 未重建、stale profile、undici 运行时依赖缺失、client bundle 404、dev 安装通道缺失。

## 六、遗留测试项

1. **TC-007/008**（开关/主题持久化）：本次只测了安装/删除主链路，开关与主题的持久化未单独走查。
2. **TC-201~203**（负向/边界）：网络失败、损坏插件、版本冲突等未测。
3. **跨平台**：仅验证 Windows x64；Linux（deb/rpm）下便携 node/pnpm 的 +x、tar.xz 解压、symlink（非 junction）路径未测。
4. **干净机器**：本机有系统 Node/pnpm 缓存（pnpm store 在 `D:\.pnpm-store`），"完全无 Node、无 pnpm store、首次联网安装"的冷启动体验未验证（但打包应用 PATH 已前置便携工具，理论上不依赖系统 Node）。
5. **fetch-runtime 网络健壮性**：建议后续给 `fetch-runtime.mjs` 增加 npmmirror 镜像回退或进度/重试，避免国内直连 nodejs.org/GitHub 挂死。
