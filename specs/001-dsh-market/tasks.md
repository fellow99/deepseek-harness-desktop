# 001-dsh-market 任务拆解

> 对应方案: [plan.md](./plan.md)
> 依赖顺序：自上而下，标号靠前的先做。

## 阶段一：版本与产物准备

- [ ] T1 版本更新：`package.json` version `0.1.0` → `0.1.1`
- [ ] T2 dsh-market 构建：在 `../dsh-market` 执行 `npm install`（node_modules 缺失时）+ `npm run build`，产出 `lib/` 与 `client/client.js`
- [ ] T3 物化 dsh-market（打包态）：扩展 `scripts/collect-dsh.mjs`，将 dsh-market 的 `lib/`、`client/`、`cordis.patch.yml`、`package.json`（排除 node_modules）复制到 `dsh-dist/node_modules/dshmarket`
- [ ] T4 dsh-market 可解析（开发态）：扩展 `src/main/host.ts`（或等价步骤），使开发态 `dshmarket` 可被 loader 从 profile 目录解析（symlink `../dsh-market` 到 dsh 根 node_modules 或 `$DSH_HOME/profiles/node_modules`）

## 阶段二：profile 注入与自动加载

- [ ] T5 desktop profile manifest：`profiles/desktop/package.json` 增加 `dshmarket` 到 `dependencies` 与 `dsh.profile.bundles`
- [ ] T6 desktop profile patch：`profiles/desktop/cordis.patch.yml` 增加 insert 行：
  ```yaml
  - insert:
      - id: dsh-market
        name: dshmarket
        config:
          profile: desktop
          allowRestart: false
  ```

## 阶段三：便携运行时通道

- [ ] T7 运行时获取脚本：新建 `scripts/fetch-runtime.mjs`，下载官方 Node 24 LTS（zip/tar.xz）规范化到 `runtime/node/bin/`，下载 standalone pnpm 9.x 单二进制到 `runtime/pnpm/`，幂等（版本戳）
- [ ] T8 forge 配置：`forge.config.ts` 的 `extraResource` 改为 `['dsh-dist', 'runtime']`
- [ ] T9 package.json 脚本：新增 `"fetch:runtime"`，扩展 `prepackage`/`premake` 为 `collect-dsh && fetch-runtime`
- [ ] T10 运行时引导模块：新建 `src/main/runtime.ts`，实现 `setupBundledRuntime()`：POSIX chmod node/pnpm 为 755、在 `userData/runtime-bin/` 生成 `dsh.cmd`/`dsh` shim、前置 `[userData/runtime-bin, resources/runtime/pnpm]` 到 `process.env.PATH`（仅 `app.isPackaged`）
- [ ] T11 接线：`src/main/index.ts` 在 `whenReady` 内、`startHost()` 前调用 `setupBundledRuntime()`

## 阶段四：验证

- [ ] T12 类型检查：`npm run typecheck` 无新增错误
- [ ] T13 开发态冒烟：`npm run build:dsh` → `npm start`，验证设置页出现「插件市场」、可浏览目录、安装/卸载/开关/主题全链路
- [ ] T14 打包冒烟：`npm run make`，验证 resources 含 runtime + dsh-dist，打包应用可在市场安装插件

## 依赖关系

```
T1 ──┐
T2 ──┼─→ T3 ──┐
     │        ├─→ T5 ──→ T6
     └─→ T4 ──┘
T7 ──→ T8 ──→ T9 ──→ T10 ──→ T11
T3 + T6 + T11 ──→ T12 ──→ T13 ──→ T14
```
