# GitHub Actions CI/CD 设计方案

> 状态：设计已定稿（决策记录见 §2），待按本方案落地 `.github/workflows/*.yml`。
> 本文档为**设计文档**，不含已写入的 workflow 实现；实现前的决策点已逐一确认。

---

## 1. 概述

### 1.1 目标

为 `deepseek-harness-desktop`（Electron 43 + Electron Forge 7.11.2 + TypeScript，封装同级目录 dsh）建立 GitHub Actions 自动化流水线，实现：

1. **编译**：在对应平台 runner 上构建 dsh（apply patches + pnpm install + build），再用 `electron-forge make` 产出安装包/目录包。
2. **提交 release**：tag 触发（或手动触发）时，把各平台产物上传到 GitHub Release。

### 1.2 范围

- ✅ 构建 + 发布（Windows / Linux / macOS 三平台）
- ✅ 产物上传与 release 创建
- ❌ 代码签名（本地自用，不签名）
- ❌ 自动更新（Squirrel auto-update 暂不做）
- ❌ 缓存深度优化（首版只做基础缓存，见 §8）

### 1.3 关键事实（设计依据）

| 项 | 值 |
|---|---|
| 本工程仓库 | `fellow99/deepseek-harness-desktop`（main 分支） |
| dsh 仓库 | `deepseek-ai/deepseek-harness`（master），pin `dsh-v0.1.0-rc.7` |
| 构建链 | `npm ci` → `npm run build:dsh`（apply patches + pnpm install + build）→ `npm run make`（`prepackage` 自动 `collect-dsh`） |
| Node 版本 | 22 LTS（Electron 43 + Vite 7 要求 ≥ 22.12） |
| pnpm 版本 | 11.7.0（dsh `packageManager` 字段） |
| Forge 输出根 | `out/make/` |
| Electron Forge 官方 | 无独立 CI 章节、无官方 Action；官方仓库 CI 用 `make` + artifact 传递模式 |

---

## 2. 决策记录（ADR）

| 编号 | 决策点 | 选择 | 理由 |
|---|---|---|---|
| D1 | dsh checkout 源 | **官方 `deepseek-ai/deepseek-harness`** | 无私有 fork 需求；patches 经 `build:dsh` 的 `git apply` 应用，无需 fork |
| D2 | release 上传方式 | **`softprops/action-gh-release`** | 社区事实标准（5.7k★），直接 glob 上传 `out/make` 产物，无需额外 Forge 配置 |
| D3 | workflow 结构 | **`release.yml` + `ci.yml` 两个文件** | `ci.yml` 负责 PR/push 构建验证（不发布），`release.yml` 负责构建+发布；职责分离 |
| D4 | dsh 版本锁定 | **tag `dsh-v0.1.0-rc.7`** | 语义化可读；`workflow_dispatch` 输入可覆盖；patch 与 dsh 版本耦合，升级需同步改 patch |
| D5 | 平台矩阵 | **Windows + Linux + macOS** | 三平台覆盖；macOS 走 MakerDMG（未签名，见 §8 注意事项） |

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

> `MakerZIP` 声明了 `['darwin', 'linux', 'win32']`，故三平台均产出对应 zip。

### 3.3 数据流

```
checkout 本工程 + checkout dsh(同级)
   → setup-node(22) + pnpm/setup(11.7.0)
   → [Linux] apt-get install fakeroot rpm
   → npm ci
   → npm run build:dsh   (git apply patches + pnpm install + build dsh)
   → npm run make        (prepackage 自动 collect-dsh → dsh-dist → extraResource)
   → upload-artifact(out/make/, 带矩阵前缀)
   → [release job] download-artifact(merge) → chmod +x → action-gh-release
```

---

## 4. dsh 依赖处理（本工程最关键点）

dsh 是**独立仓库**（非 submodule），本工程经 `../deepseek-harness` 同级源码引用。CI 里用**两次 checkout** 复现同级布局：

```yaml
- uses: actions/checkout@v4                  # 本工程 → $GITHUB_WORKSPACE
- name: Checkout dsh (sibling)
  uses: actions/checkout@v4
  with:
    repository: deepseek-ai/deepseek-harness
    path: ../deepseek-harness                # → $GITHUB_WORKSPACE/../deepseek-harness
    ref: dsh-v0.1.0-rc.7                     # ci.yml 硬编码；release.yml 改用 inputs.dsh_ref || 'dsh-v0.1.0-rc.7'
```

要点：

1. **`path: ../deepseek-harness`** 解析为 `$GITHUB_WORKSPACE/../deepseek-harness`，与本机 `sibling directories` 布局一致，`build:dsh` / `collect:dsh` 脚本无需任何 CI 特判。
2. **patch 耦合**：`patches/dsh-disable-hmr.patch` 与 `patches/dsh-disable-native-picker.patch` 是针对 pin 版本源码生成的 `git diff`。dsh 升级导致 patch 失配时，`build:dsh` 的 `git apply` 会失败退出——CI 以失败显式暴露（好事），而非静默坏掉。升级流程 = 更新 patch + 同步改 `dsh_ref`。
3. **`git apply` 依赖 `.git`**：checkout 自带 `.git`，shallow clone（默认 depth=1）不影响 `git apply`。
4. **pnpm 前置**：`collect:dsh` 内部用 `pnpm deploy`，故 pnpm 安装步骤必须在 `build:dsh` / `prepackage` 之前（`pnpm/setup` 已置于最前）。

---

## 5. 构建步骤（每个矩阵 job 内）

```yaml
- uses: actions/checkout@v4
- name: Checkout dsh (sibling)
  uses: actions/checkout@v4
  with:
    repository: deepseek-ai/deepseek-harness
    path: ../deepseek-harness
    ref: dsh-v0.1.0-rc.7                     # ci.yml 硬编码；release.yml 改用 inputs.dsh_ref || 'dsh-v0.1.0-rc.7'

- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm                        # 缓存 desktop 的 node_modules

- uses: pnpm/setup@v2                 # pnpm 官方推荐（已弃用 corepack）
  with:
    version: 11.7.0                   # 与 dsh packageManager 字段一致

- name: Install Linux packaging deps
  if: runner.os == 'Linux'
  run: sudo apt-get install -y --no-install-recommends fakeroot rpm

- run: npm ci
- run: npm run build:dsh              # ① git apply patches → ② pnpm install → ③ build dsh
- run: npm run make                   # prepackage 自动 collect-dsh → dsh-dist → extraResource

- uses: actions/upload-artifact@v4
  with:
    name: dist-${{ matrix.os }}
    path: out/make/
    if-no-files-found: error
```

> macOS 无额外系统依赖（`hdiutil` 系统自带）；Windows 的 maker-squirrel 无系统依赖要求。

---

## 6. 产物清单

| 平台 | 产物路径 | 文件名 |
|---|---|---|
| Windows | `out/make/squirrel.windows/x64/` | `DeepSeek-Harness-Desktop-0.1.0 Setup.exe`、`deepseek_harness_desktop-0.1.0-full.nupkg`、`RELEASES` |
| Windows | `out/make/zip/win32/x64/` | `DeepSeek-Harness-Desktop-win32-x64-0.1.0.zip` |
| Linux | `out/make/deb/x64/` | `deepseek-harness-desktop_0.1.0_amd64.deb` |
| Linux | `out/make/rpm/x64/` | `deepseek-harness-desktop-0.1.0-1.x86_64.rpm` |
| Linux | `out/make/zip/linux/x64/` | `DeepSeek-Harness-Desktop-linux-x64-0.1.0.zip` |
| macOS | `out/make/dmg/<arch>/` | `*.dmg`（未签名） |
| macOS | `out/make/zip/darwin/<arch>/` | `DeepSeek-Harness-Desktop-darwin-<arch>-0.1.0.zip` |

> 上传整个 `out/make/` 目录，release 阶段按扩展名筛选。

---

## 7. 发布设计（release job）

```yaml
release:
  needs: build                # 仅在 build 全部成功后运行（tag 与 workflow_dispatch 均发布；build 失败则默认跳过）
  runs-on: ubuntu-latest
  permissions:
    contents: write
  steps:
    - uses: actions/download-artifact@v4
      with:
        path: artifacts
        merge-multiple: true
    - name: Restore exec permissions   # v4 artifact 会丢失文件执行权限
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

## 8. 注意事项 / 已知坑

1. **rpm 依赖**：ubuntu-latest 默认无 `rpmbuild`，必须 `apt-get install rpm`；否则 `make` 在 MakerRpm 的二进制检查阶段直接报错。
2. **artifact 权限丢失**：upload-artifact v4 解压后文件权限归 644/755。`dsh-dist` 内若有需执行权限的 native 二进制，release job 需 `chmod +x`（§7 已含）。
3. **Setup.exe 含空格**：`DeepSeek-Harness-Desktop-0.1.0 Setup.exe`，glob 能匹配；若走 shell 引用需加引号；将来启用 auto-update 时 `RELEASES` 必须一并上传（Squirrel 更新机制依赖）。
4. **macOS 未签名**：MakerDMG 产出未签名 DMG + 未签名 Electron 二进制；首次打开需右键「打开」绕过 Gatekeeper。正式分发前需补代码签名（超出本方案范围）。
5. **macOS 构建可行性待验证**：dsh 的 `native/landlock-run` 是 Linux-only 原生模块；macOS 上 `build:dsh` 是否需跳过 native 构建，需首次 `macos-latest` 运行验证（若失败，按失败信息调整 `build-dsh.mjs` 的平台分支）。

---

## 9. 可选优化（后续）

| 优化 | 做法 | 收益 |
|---|---|---|
| dsh 构建缓存 | `actions/cache` 缓存 dsh `.pnpm-store` 与 `packages/*/lib`（按 dsh commit key） | 省 1~2 分钟 |
| Electron 缓存 | 缓存 `~/.electron` | 省 Electron 二进制下载 |
| 代码签名 | 引入 Apple Developer ID / Windows 代码签名证书 | 消除 Gatekeeper/SmartScreen 警告 |

---

## 10. 落地文件清单

1. `.github/workflows/ci.yml` —— push/PR 触发，仅构建验证（不发布）。
2. `.github/workflows/release.yml` —— tag/手动触发，构建 + 发布。

（本文档为设计稿；两个 workflow 的完整 YAML 实现见 §5 / §7 骨架，落地时按需补齐。）
