# 201-dsh-market 任务拆解

> 对应方案: [plan.md](./plan.md)
> 依赖顺序：自上而下，标号靠前的先做。
> 状态：全部完成（2026-08-25，打包态端到端验证通过）。

## 阶段一：版本与产物准备

- [x] T1 版本更新：`package.json` version `0.1.0` → `0.1.1`
- [x] T2 dsh-market 构建：在 `../dsh-market` 执行 `npm install`（node_modules 缺失时）+ `npm run build`，产出 `lib/` 与 `client/client.js`（前置：`git clone --branch v1.26.0 https://github.com/dsh-market/dsh-market.git ../dsh-market`；CI 由 `Checkout dsh-market (sibling)` 步骤完成）
- [x] T3 物化 dsh-market（打包态）：扩展 `scripts/collect-dsh.mjs`，将 dsh-market 的 `lib/`、`client/`、`cordis.patch.yml`、`package.json`（排除 node_modules）复制到 `dsh-dist/node_modules/dshmarket`
- [x] T4 dsh-market 可解析（开发态）：扩展 `src/main/host.ts`（或等价步骤），使开发态 `dshmarket` 可被 loader 从 profile 目录解析（symlink `../dsh-market` 到 dsh 根 node_modules 或 `$DSH_HOME/profiles/node_modules`）

## 阶段二：profile 注入与自动加载

- [x] T5 desktop profile manifest：`profiles/desktop/package.json` 增加 `dshmarket` 到 `dependencies` 与 `dsh.profile.bundles`
- [x] T6 desktop profile patch：`profiles/desktop/cordis.patch.yml` 增加 insert 行：
  ```yaml
  - insert:
      - id: dsh-market
        name: dshmarket
        config:
          profile: desktop
          allowRestart: false
  ```

## 阶段三：便携运行时通道

- [x] T7 运行时获取脚本：新建 `scripts/fetch-runtime.mjs`，下载官方 Node 24 LTS（zip/tar.xz）规范化到 `runtime/node/bin/`，下载 standalone pnpm 9.x 单二进制到 `runtime/pnpm/`，幂等（版本戳）
- [x] T8 forge 配置：`forge.config.ts` 的 `extraResource` 改为 `['dsh-dist', 'runtime']`
- [x] T9 package.json 脚本：新增 `"fetch:runtime"`，扩展 `prepackage`/`premake` 为 `collect-dsh && fetch-runtime`
- [x] T10 运行时引导模块：新建 `src/main/runtime.ts`，实现 `setupMarketRuntime()`：POSIX chmod node/pnpm 为 755、在 `userData/runtime-bin/` 生成 `dsh.cmd`/`dsh` shim、前置 `[userData/runtime-bin, resources/runtime/pnpm]` 到 `process.env.PATH`（开发态写指向 sibling dsh 源码的 shim；打包态写便携 node + dsh-dist）
- [x] T11 接线：`src/main/index.ts` 在 `whenReady` 内、`startHost()` 前调用 `setupMarketRuntime()`

## 阶段四：验证

- [x] T12 类型检查：`npm run typecheck` 无新增错误
- [x] T13 开发态冒烟：`npm run build:dsh` → `npm start`，验证设置页出现「插件市场」、可浏览目录、安装/卸载/开关/主题全链路
- [x] T14 打包冒烟：`npm run make`，验证 resources 含 runtime + dsh-dist，打包应用可在市场安装插件

## 阶段五：打包态调试修复（实测暴露）

- [x] T15 Bug-1 修复：`ensureDesktopProfile` 由整目录覆盖改为合并策略，保留用户安装的插件
- [x] T16 Bug-2 修复：新增 `ensureProfilePluginLinks`，把 profile node_modules 顶层插件 junction 到 dsh 根 node_modules
- [x] T17 Bug-3 修复：卸载后悬空 junction 的无条件清理 + Windows 安全删除（unlink/rmdir 回退）
- [x] T18 Bug-4 修复：抽出 `linkFlatNodeModules`，额外链接 `.pnpm/node_modules` 下全部传递依赖，修复聚合型插件 19 个 ERR_MODULE_NOT_FOUND
- [x] T18b Bug-5 修复：`fetch-runtime.mjs` 增加 darwin 支持（Node `.tar.gz` + `pnpm-macos-{arch}`），修复 macOS make 失败 `unsupported platform: darwin`
- [x] T19 开发态安装通道：开发态也生成 dsh shim（commit d44ca9c），并递归复制 dshmarket 运行时依赖（commit 77360e5）
- [x] T20 打包态端到端验证：dsh-composer-expand 与聚合插件 @linxin666/dsh-web-ui-all 安装→重启 live→卸载→重启干净

## 依赖关系

```
T1 ──┐
T2 ──┼─→ T3 ──┐
     │        ├─→ T5 ──→ T6
     └─→ T4 ──┘
T7 ──→ T8 ──→ T9 ──→ T10 ──→ T11
T3 + T6 + T11 ──→ T12 ──→ T13 ──→ T14
```
