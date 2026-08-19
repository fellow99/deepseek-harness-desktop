# GitHub Actions CI/CD 设计方案

> 状态：✅ 已实现并验证 —— **v0.1.0 已发布**（Windows / Linux / macOS 三平台产物齐全）。
> 本文档记录最终实现（含实施过程中踩过的坑与修复），是后续维护 CI/CD 的权威参照。

---

## 1. 概述

### 1.1 目标

为 `deepseek-harness-desktop`（Electron 43 + Electron Forge 7.11.2 + TypeScript，封装同级目录 dsh）建立 GitHub Actions 自动化流水线，实现：

1. **编译**：在对应平台 runner 上构建 dsh（apply patches + pnpm install + build），再用 `electron-forge make` 产出安装包/目录包。
2. **提交 release**：tag 触发（或手动触发）时，把各平台产物上传到 GitHub Release。

### 1.2 范围

- ✅ 构建 + 发布（Windows / Linux / macOS 三平台，均已验证）
- ✅ 产物上传与 release 创建（v0.1.0 已发布，8 个产物资产）
- ❌ 代码签名（本地自用，不签名）
- ❌ 自动更新（Squirrel auto-update 暂不做）
- ❌ 缓存深度优化（首版只做基础缓存，见 §10）

### 1.3 关键事实

| 项 | 值 |
|---|---|
| 本工程仓库 | `fellow99/deepseek-harness-desktop`（main 分支） |
| dsh 仓库 | `deepseek-ai/deepseek-harness`（master），pin `dsh-v0.1.0-rc.7`（commit `99f6f02f`） |
| 构建链 | `npm ci` → `npm run build:dsh`（apply patches + `corepack pnpm install` + build）→ `npm run make`（`premake` 钩子自动 `collect-dsh`） |
| Node 版本 | 22 LTS（Electron 43 + Vite 7 要求 ≥ 22.12） |
| pnpm 版本 | 11.7.0（dsh `packageManager` 字段，经 `corepack` 管理） |
| Forge 输出根 | `out/make/` |
| 发布状态 | v0.1.0 已发布（`published_at` 2026-08-19） |

---

## 2. 决策记录（ADR）

| 编号 | 决策点 | 选择 | 理由 |
|---|---|---|---|
| D1 | dsh checkout 源 | **官方 `deepseek-ai/deepseek-harness`** | 无私有 fork 需求；patches 经 `build:dsh` 的 `git apply` 应用，无需 fork |
| D2 | release 上传方式 | **`softprops/action-gh-release`** | 社区事实标准，直接 glob 上传 `out/make` 产物，无需额外 Forge 配置 |
| D3 | workflow 结构 | **`release.yml` + `ci.yml` 两个文件** | `ci.yml` 负责 PR/push 构建验证（不发布），`release.yml` 负责构建+发布；职责分离 |
| D4 | dsh 版本锁定 | **tag `dsh-v0.1.0-rc.7`** | 语义化可读；`workflow_dispatch` 输入可覆盖；patch 与 dsh 版本耦合，升级需同步改 patch |
| D5 | 平台矩阵 | **Windows + Linux + macOS** | 三平台覆盖；macOS 走 MakerDMG（未签名，见 §9） |

---

## 3. 架构设计

### 3.1 两个 workflow 的职责

```
┌─ ci.yml ────────────────────────────┐
│ 触发：push / pull_request           │
│ 职责：构建验证（不发布）              │
│ 流程：build 矩阵（3 平台）→ 结束      │
└─────────────────────────────────────┘

┌─ release.yml ───────────────────────────────────┐
│ 触发：push tags 'v*' / workflow_dispatch        │
│ 职责：构建 + 发布到 GitHub Release              │
│ 流程：build 矩阵（3 平台，upload-artifact）      │
│        → release job（download-artifact 合并     │
│           → action-gh-release 上传）             │
└─────────────────────────────────────────────────┘
```

### 3.2 build 矩阵

| runner | makers | 产物 |
|---|---|---|
| `windows-latest` | squirrel + zip | Setup.exe / nupkg / RELEASES + win32 zip |
| `ubuntu-latest` | deb + rpm + zip | .deb / .rpm + linux zip |
| `macos-latest` | dmg + zip | .dmg + darwin zip |

### 3.3 数据流（最终实现）

```
checkout 本工程 (actions/checkout@v7)
   → git clone dsh 到 ../deepseek-harness（actions/checkout 的 path 不能越界，改用 git clone）
   → setup-node@v7 (22) + corepack enable（dsh 脚本嵌套 pnpm 依赖 shim）
   → [Linux] apt-get install fakeroot rpm
   → npm ci
   → npm run build:dsh   (git apply patches + corepack pnpm install + build dsh)
   → npm run make        (premake 钩子自动 collect-dsh → dsh-dist → extraResource)
   → upload-artifact@v7  (out/make/, 带矩阵前缀)
   → [release job] download-artifact@v8 (merge) → chmod +x → action-gh-release@v3
```

---

## 4. dsh 依赖处理（本工程最关键点）

dsh 是**独立仓库**（非 submodule），本工程经 `../deepseek-harness` 同级源码引用。脚本（`build-dsh.mjs` / `collect-dsh.mjs`）用 `resolve(desktopRoot, '../deepseek-harness')` 定位 dsh。

**关键坑**：`actions/checkout` 的 `path` 参数**强制限制在 `$GITHUB_WORKSPACE` 内**，`path: ../deepseek-harness` 会被拒（报 `Repository path ... is not under ...`）。因此改用 `git clone` 直接 clone 到同级目录：

```yaml
- name: Checkout dsh (sibling)
  shell: bash
  env:
    DSH_REF: dsh-v0.1.0-rc.7   # ci.yml 硬编码；release.yml 用 inputs.dsh_ref || 'dsh-v0.1.0-rc.7'
  run: |
    git clone --depth 1 --branch "${DSH_REF}" \
      https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
```

要点：

1. **`shell: bash`** 保证三平台一致（Windows 默认 pwsh，`../` 相对路径和反斜杠续行有差异）。
2. **patch 耦合**：`patches/*.patch` 是针对 pin 版本源码生成的 `git diff`。dsh 升级导致 patch 失配时，`build:dsh` 的 `git apply` 会失败退出——CI 以失败显式暴露（好事）。升级流程 = 更新 patch + 同步改 `dsh_ref`。
3. **patch 换行**：desktop 仓库 `.gitattributes` 强制 `*.patch text eol=lf`（见 §8 问题 3/4），保证 Windows checkout 不把 patch 转 CRLF。
4. **pnpm 前置**：dsh 脚本用 `corepack pnpm`（Node 22 自带 corepack），且 dsh build 脚本内部有嵌套 `pnpm` 调用，需 `corepack enable` 创建 shim（见 §8 问题 5）。

---

## 5. 构建步骤（最终实现，每个矩阵 job 内）

```yaml
- uses: actions/checkout@v7

- name: Checkout dsh (sibling)
  shell: bash
  env:
    DSH_REF: ${{ github.event.inputs.dsh_ref || 'dsh-v0.1.0-rc.7' }}   # ci.yml 硬编码为 dsh-v0.1.0-rc.7
  run: |
    git clone --depth 1 --branch "${DSH_REF}" \
      https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness

- uses: actions/setup-node@v7
  with:
    node-version: 22
    cache: npm

- name: Enable corepack
  run: corepack enable

- name: Install Linux packaging deps
  if: runner.os == 'Linux'
  run: sudo apt-get install -y --no-install-recommends fakeroot rpm

- run: npm ci
- run: npm run build:dsh
- run: npm run make          # premake 钩子自动 collect-dsh → dsh-dist → extraResource

- uses: actions/upload-artifact@v7
  with:
    name: dist-${{ matrix.os }}
    path: out/make/
    if-no-files-found: error
```

---

## 6. 产物清单（实际产物，v0.1.0）

| 平台 | 产物路径 | 文件名（实际） |
|---|---|---|
| Windows | `out/make/squirrel.windows/x64/` | `DeepSeek.Harness.Desktop-0.1.0.Setup.exe`、`deepseek_harness_desktop-0.1.0-full.nupkg`、`RELEASES` |
| Windows | `out/make/zip/win32/x64/` | `DeepSeek.Harness.Desktop-win32-x64-0.1.0.zip` |
| Linux | `out/make/deb/x64/` | `deepseek-harness-desktop_0.1.0_amd64.deb` |
| Linux | `out/make/rpm/x64/` | `deepseek-harness-desktop-0.1.0-1.x86_64.rpm` |
| Linux | `out/make/zip/linux/x64/` | `DeepSeek.Harness.Desktop-linux-x64-0.1.0.zip` |
| macOS | `out/make/dmg/arm64/` | `DeepSeek.Harness.Desktop-0.1.0-arm64.dmg`（未签名） |
| macOS | `out/make/zip/darwin/arm64/` | `DeepSeek.Harness.Desktop-darwin-arm64-0.1.0.zip` |

> 注意：productName `DeepSeek Harness Desktop` 带空格，产物文件名里空格被 installer 替换为 `.`（如 `DeepSeek.Harness.Desktop-...`），而 deb/rpm 用 package.json 的 `name`（无空格）。

---

## 7. 发布设计（release job）

```yaml
release:
  needs: build                # 仅在 build 全部成功后运行（tag 与 workflow_dispatch 均发布；build 失败则默认跳过）
  runs-on: ubuntu-latest
  permissions:
    contents: write
  steps:
    - uses: actions/download-artifact@v8
      with:
        path: artifacts
        merge-multiple: true
    - name: Restore exec permissions   # upload-artifact 解压后文件执行权限会丢失
      run: chmod -R +x artifacts 2>/dev/null || true
    - uses: softprops/action-gh-release@v3
      with:
        tag_name: ${{ github.event.inputs.version || github.ref_name }}   # tag 触发用 ref_name；手动触发用 version 输入
        files: |
          artifacts/**/*.exe
          artifacts/**/*.nupkg
          artifacts/**/*.deb
          artifacts/**/*.rpm
          artifacts/**/*.dmg
          artifacts/**/*.zip
        fail_on_unmatched_files: false
        generate_release_notes: true
```

**触发方式**：

- `on: push: tags: ['v*']` —— tag 发版（`npm version` / 手动打 tag 触发）。
- `on: workflow_dispatch:`（带 `dsh_ref` 输入 + `version` 输入）—— 手动触发，适合本地自用场景；`version`（必填）指定 release tag 名，action-gh-release 会基于当前 commit 创建该 tag。

---

## 8. 问题排查记录（实施过程踩坑）

> 按时间顺序记录，v0.1.0 发布调试中实际遇到的问题、根因与修复。每个问题都已修复并验证。

### 问题 1：checkout path 越界（3 errors，致命）

- **现象**：`Repository path '/home/runner/work/.../deepseek-harness' is not under '.../deepseek-harness-desktop'`
- **根因**：`actions/checkout` 的 `path` 参数强制限制在 `$GITHUB_WORKSPACE` 内，`path: ../deepseek-harness` 越界被拒。
- **修复**：改用 `git clone --depth 1 --branch <ref> ... ../deepseek-harness`（`shell: bash`）。

### 问题 2：Node 20 弃用 warning（3 warnings，非致命）

- **现象**：`Node.js 20 is deprecated ... actions/checkout@v4`
- **根因**：所有 action 用旧 major（Node 20 runtime），GitHub 已于 2025-09 弃用 Node 20。
- **修复**：升级 `checkout@v7`、`setup-node@v7`、`upload-artifact@v7`、`download-artifact@v8`（`action-gh-release@v3` 已 pin Node 24，无需动）。

### 问题 3：dsh-disable-native-picker.patch 编码损坏

- **现象**：`error: No valid patches in input (allow with "--allow-empty")`
- **根因**：该 patch 当初用 PowerShell `>` 重定向生成（PowerShell 5.1 默认 UTF-16 LE），且中文注释双重编码乱码。`git apply` 只认 UTF-8。本地一直没暴露是因为本地 dsh 早已应用 patch（`git apply --reverse --check` 命中后跳过），CI 干净 clone 首次真正执行 `git apply` 才撞上。
- **修复**：在干净 dsh 上重做改动，用 `git diff`（node 写入保证 UTF-8）重新生成 patch。

### 问题 4：dsh-disable-hmr.patch CRLF 不匹配（仅 Windows）

- **现象**：`error: patch failed: apps/cli/src/profile-boot.ts:265`（仅 Windows，Linux/macOS 正常）
- **根因**：desktop 仓库 `core.autocrlf=true` 且无 `.gitattributes`，Windows checkout 把 LF 的 patch 转成 CRLF；而 dsh 源码（`.gitattributes` 强制 `eol=lf`）是 LF → 换行不匹配。
- **修复**：desktop 加 `.gitattributes`：`*.patch text eol=lf`。

### 问题 5：嵌套 pnpm not found（Linux/macOS）

- **现象**：`sh: 1: pnpm: not found`（发生在 `corepack pnpm run build:web` 内部的 `pnpm --filter ... run build`）
- **根因**：`corepack pnpm` 只是临时激活，不创建持久 shim；dsh build 脚本内部的嵌套 `pnpm` 调用找不到。之前移除 `pnpm/setup` 时没考虑到嵌套调用。
- **修复**：加 `corepack enable` 步骤（创建 pnpm shim 到 PATH，版本由 dsh `packageManager` 字段统一管理）。

### 问题 6：dsh-dist 缺失（三端一致）

- **现象**：`ENOENT: no such file or directory, lstat 'dsh-dist'`
- **根因**：`prepackage` 是 npm pre-hook，只在 `npm run package` 时触发；CI 用 `npm run make`（= `electron-forge make`）不触发 `prepackage`，导致 `dsh-dist/` 从未生成。
- **修复**：package.json 加 `"premake": "node scripts/collect-dsh.mjs"`，让 `npm run make` 也触发 collect-dsh。

### 问题 7：Linux 可执行文件名不匹配

- **现象**：`could not find the Electron app binary at ".../deepseek-harness-desktop"`（仅 Linux maker-rpm/deb）
- **根因**：Electron Packager 的 `executableName` 默认取 `opts.name`（被 infer 为 `productName` = `DeepSeek Harness Desktop` 带空格），而 maker-rpm/deb 的 `bin` 默认取 `packageJSON.name`（`deepseek-harness-desktop`）。Windows/macOS 的 maker 用 `appName`（productName）所以匹配，唯独 Linux 用 `name` 不匹配。
- **修复**：`packagerConfig.executableName: 'deepseek-harness-desktop'`，让三平台可执行文件统一为 `name`（maker-squirrel 第 34 行会自动用 `executableName` 查找 exe，不受影响）。

### 问题 8：rpm strip 遇 arm64 .node

- **现象**：`strip: Unable to recognise the format ... node-pty/prebuilds/linux-arm64/pty.node`
- **根因**：`pnpm deploy` 物化依赖时把 node-pty 的**多架构 prebuilds**（含 `linux-arm64`）一并复制进 dsh-dist；rpmbuild 的 `brp-strip` 对所有二进制执行 `strip`，x86_64 的 strip 无法处理 arm64 的 `.node`。
- **修复**：`collect-dsh.mjs` 加 `pruneForeignPrebuilds`，物化后递归清理非目标架构（`process.platform-process.arch`）的 prebuilds 子目录（同时减小包体积）。

---

## 9. 注意事项

1. **rpm 依赖**：ubuntu-latest 默认无 `rpmbuild`，必须 `apt-get install rpm`；否则 `make` 在 MakerRpm 的二进制检查阶段直接报错。
2. **artifact 权限丢失**：upload-artifact 解压后文件权限归 644/755。release job 已 `chmod -R +x` 恢复（§7）。
3. **Setup.exe 产物名**：实际是 `DeepSeek.Harness.Desktop-0.1.0.Setup.exe`（空格被替换为 `.`）。将来启用 auto-update 时 `RELEASES` 必须一并上传（Squirrel 更新机制依赖）。
4. **macOS 未签名**：DMG + Electron 二进制未签名，首次打开需右键「打开」绕过 Gatekeeper。正式分发前需补代码签名（超出本方案范围）。
5. **macOS 架构**：`macos-latest` 是 arm64 runner，产物为 `-arm64` 后缀；若要 x64 产物需扩展矩阵（当前未做）。

---

## 10. 可选优化（后续）

| 优化 | 做法 | 收益 |
|---|---|---|
| dsh 构建缓存 | `actions/cache` 缓存 dsh `.pnpm-store` 与 `packages/*/lib`（按 dsh commit key） | 省 1~2 分钟 |
| Electron 缓存 | 缓存 `~/.electron` | 省 Electron 二进制下载 |
| 代码签名 | 引入 Apple Developer ID / Windows 代码签名证书 | 消除 Gatekeeper/SmartScreen 警告 |
| macOS x64 | 矩阵加 `macos-13`（x64 runner）或 `--arch x64` | 覆盖 Intel Mac |

---

## 11. 落地文件清单

1. `.github/workflows/ci.yml` —— push/PR 触发，仅构建验证（不发布）。
2. `.github/workflows/release.yml` —— tag/手动触发，构建 + 发布。
3. `.gitattributes` —— `*.patch text eol=lf`（防止 Windows checkout 转 CRLF）。
4. `forge.config.ts` —— `executableName`（Linux maker 匹配）+ MakerDMG（macOS）。
5. `package.json` —— `premake` 钩子（make 前 collect-dsh）。
6. `scripts/collect-dsh.mjs` —— `pruneForeignPrebuilds`（清理非目标架构 prebuilds）。
