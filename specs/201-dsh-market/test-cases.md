# dsh-market 集成 测试用例

> Module: 201-dsh-market
> 对应规格: [spec.md](./spec.md)
> 对应方案: [plan.md](./plan.md)
> Last Updated: 2026-08-25

## 1. 测试环境

| 环境 | 用途 |
|------|------|
| 开发态（`npm start`） | 功能集成测试（本机具备 Node + pnpm + 同级 dsh/dsh-market 源码） |
| 打包态（`npm run make` 产物） | 便携 Node/pnpm 通道冒烟测试（验证不依赖系统环境） |

前置：`npm run build:dsh`（构建 dsh）+ dsh-market 构建/收集成功。

## 2. 功能测试用例

### TC-001 版本号更新

- **前置**：代码已实现版本更新。
- **步骤**：读取本工程 `package.json`。
- **预期**：`version === "0.1.1"`。

### TC-002 dsh-market 产物收集

- **前置**：dsh-market 已构建（`npm run build`）。
- **步骤**：运行收集脚本后检查 dsh-dist 与开发态解析路径。
- **预期**：`dshmarket` 包（`lib/`、`client/`、`cordis.patch.yml`、`package.json`）出现在预期位置；`node_modules` 未被卷入。

### TC-003 自动加载（设置页出现插件市场）

- **前置**：应用启动，dsh Host 就绪。
- **步骤**：打开设置页，查找「插件市场」入口；查看浏览器控制台。
- **预期**：入口存在；无「宿主太旧、市场自我禁用」类报错。

### TC-004 浏览社区目录

- **前置**：市场已加载，具备出站网络。
- **步骤**：在市场中浏览/搜索插件。
- **预期**：目录列表加载（实时拉取 awesome-dsh-plugin），分类/搜索可用。

### TC-005 安装插件（开发态）

- **前置**：市场已加载，选择一个可安装插件。
- **步骤**：确认来源并安装，观察进度。
- **预期**：安装成功；插件装入 `$DSH_HOME/profiles/desktop/node_modules`；声明 `dsh.bundle` 的插件被 reconcile 进 `dsh.profile.bundles`。

### TC-006 卸载插件

- **前置**：某插件已安装。
- **步骤**：两步确认卸载。
- **预期**：插件从依赖与 bundle 清单移除；market state/patch 记录清理；无残留禁用行。

### TC-007 插件开关持久化

- **前置**：某插件已启用。
- **步骤**：在市场禁用该插件 → 重启应用。
- **预期**：重启后插件保持禁用（`cordis.patch.yml` 写入 `disabled: true` 且跨重启生效）。

### TC-008 主题切换持久化

- **前置**：安装 ≥2 个主题。
- **步骤**：切换主题 → 重启应用。
- **预期**：重启后主题选择保留（主题互斥、选择持久化）。

### TC-009 市场不擅自重启

- **前置**：触发一个「需重启生效」的变更。
- **步骤**：观察市场行为。
- **预期**：仅显示待重启提示，**不** spawn 独立 dsh 进程；无 `GET /dsh-market/status` 返回 `restart: true`（应为 false）。

### TC-010 profile 正确性

- **前置**：触发一次安装操作。
- **步骤**：检查安装落点目录。
- **预期**：落在 `$DSH_HOME/profiles/desktop`（而非 `profiles/web`）。

## 3. 打包态测试用例

### TC-101 便携运行时内置

- **前置**：`npm run make` 产物（Windows）。
- **步骤**：检查 resources 目录。
- **预期**：便携 Node、pnpm、dsh-dist（含 `lib/bin.js`）均在预期位置。

### TC-102 打包应用安装插件

- **前置**：打包应用在**无系统 Node/pnpm** 的干净机器/容器运行。
- **步骤**：在市场安装一个插件。
- **预期**：`dsh plugin add` 经内置便携 Node + pnpm 执行成功，插件安装成功（不依赖系统环境）。

### TC-103 打包应用卸载/开关插件

- **前置**：TC-102 已通过。
- **步骤**：卸载插件、禁用插件。
- **预期**：与开发态行为一致。

### TC-104 打包应用市场加载

- **前置**：打包应用启动。
- **步骤**：打开设置页。
- **预期**：「插件市场」入口存在、可浏览目录。

## 4. 边界与负向用例

### TC-201 网络不可达

- **步骤**：断网后打开市场。
- **预期**：市场给出具体原因 + 重试按钮（不崩溃）。

### TC-202 pnpm 缺失（开发态降级）

- **前置**：临时把 pnpm 移出 PATH。
- **步骤**：触发安装。
- **预期**：市场给出 pnpm 缺失的明确提示（或其一键安装引导），应用不崩溃。

### TC-203 非法安装目标

- **步骤**：构造不在精选列表内的来源触发安装。
- **预期**：被拒绝（400），不执行。

## 5. 测试通过标准

- 开发态 TC-001~TC-010 全部通过。
- 打包态 TC-101~TC-104 全部通过（至少 Windows；Linux 在 CI 可跑则补）。
- 负向用例 TC-201~TC-203 按预期降级、无崩溃。

## 6. 实测结果（2026-08-25，打包态）

> 详细报告见 `logs/20260825-1/TEST_REPORT.md`（含四个 Bug 的现象/根因/修复）。

| 用例 | 结果 | 备注 |
|------|------|------|
| TC-001 版本号 | ✅ | 0.1.1 |
| TC-002 产物收集 | ✅ | dsh-dist 内 dshmarket 物化完整（实际版本 1.29.2） |
| TC-003 自动加载 | ✅ | host 就绪，市场入口出现 |
| TC-004 浏览目录 | ✅ | registry 200（1.44MB，count=2135） |
| TC-005 安装插件 | ✅ | dsh-composer-expand@0.1.2 + 聚合插件 @linxin666/dsh-web-ui-all@0.3.3 |
| TC-006 卸载插件 | ✅ | 重启后干净，悬空 junction 自动清理 |
| TC-007 开关持久化 | ⏸ 未单独走查 | |
| TC-008 主题持久化 | ⏸ 未单独走查 | |
| TC-009 不擅自重启 | ✅ | 注入 `allowRestart:false`，status `restart=false` |
| TC-010 profile 正确 | ✅ | `profile=desktop` |
| TC-101 便携运行时 | ✅ | node v24.11.1 + pnpm 9.15.9 |
| TC-102 打包安装 | ✅ | 便携 Node+pnpm 通道完整跑通 |
| TC-103 打包卸载/开关 | ✅ 卸载 | 开关未单独走查 |
| TC-104 打包市场加载 | ✅ | `/`、`/plugins/dshmarket/client.js`（约 442KB）均 200 |
| TC-201~203 负向 | ⏸ 未测 | |

**回归重点（聚合插件）**：安装 `@linxin666/dsh-web-ui-all`（pnpm 装入 372 个包、cordis.patch.yml 声明 19 个传递依赖为 loader entry）后，重启 Host 正常启动，`/dsh-market/installed` 显示该插件与 dshmarket 均 `state=live, hot=true`，无 `ERR_MODULE_NOT_FOUND`。此用例覆盖了 Bug-4 的传递依赖链接修复。
