import { app } from 'electron';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

/**
 * dsh Host 宿主：在主进程内 runProfile('desktop') 挂起 dsh Host（含 webserver），
 * 渲染进程同源加载 localhost（产品概念设计第 7、9 节）。
 *
 * 参考（源码级核实，2026-08-14）：
 * - runProfile：deepseek-harness/apps/cli/src/profile-boot.ts:207
 *   `runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }>`
 * - RunProfileOptions：`{ environment, profile, patchFiles, args }`（profile-boot.ts:174-183）
 * - webserver：`ctx.webServer.port` —— config.port 传 0 时返回 OS 分配端口
 *   （deepseek-harness/packages/host/webserver/src/index.ts:78-81）
 * - profile 目录：`$DSH_HOME/profiles/<name>`（dsh-app-boot/src/profile.ts:104-111）
 * - `$DSH_HOME`：环境变量 `DSH_HOME`，默认 `~/.dsh`（dsh-home-paths）
 */

// dsh 部署产物位置：
// - 开发：与 desktop 同级目录的 deepseek-harness 源码（workspace 链接解析）
// - 打包：out/resources/dsh-dist（collect-dsh 的 pnpm deploy 物化产物，extraResource 打入）
const DSH_ROOT = app.isPackaged
  ? join(process.resourcesPath, 'dsh-dist')
  : resolve(__dirname, '../../../deepseek-harness');
// profile-boot 产物目录（apps/cli 的 lib；deploy 物化后即 dsh-dist/lib）
const DSH_CLI_LIB = app.isPackaged
  ? join(DSH_ROOT, 'lib')
  : join(DSH_ROOT, 'apps/cli/lib');
// loadLayeredEnv（dsh-app-boot 的 lib）
const DSH_APP_BOOT_LIB = app.isPackaged
  ? join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')
  : join(DSH_ROOT, 'packages/boot/app-boot/lib/index.js');
// desktop 工程自带的 desktop profile（collect 时物化进 dsh-dist/profiles/desktop）
const DESKTOP_PROFILE_SRC = app.isPackaged
  ? join(DSH_ROOT, 'profiles/desktop')
  : resolve(__dirname, '../../profiles/desktop');

/** dsh Cordis Context 的最小接口（仅暴露桌面侧订阅事件所需的字段） */
export interface HostContext {
  webServer: { port: number };
  /** 订阅 host 事件（cordis ctx.on），供托盘/通知用 */
  on(event: string, listener: (...args: unknown[]) => void): void;
}

/** dsh Host 句柄 */
export interface HostHandle {
  ctx: HostContext;
  /** 优雅关闭：dispose 插件树（ProcessShutdown.shutdown） */
  shutdown: (code?: number) => Promise<void> | void;
  /** webserver 实际绑定端口（--port 0 → OS 分配） */
  port: number;
  /** 同源加载 URL：http://127.0.0.1:<port>/ */
  url: string;
}

/**
 * 在 dsh CLI lib 目录中定位 profile-boot 的薄入口（re-export runProfile）。
 * tsdown 构建产物文件名带内容 hash（如 profile-boot-BnJoK_kl.js），
 * 不硬编码 hash，而是扫描目录按「薄入口仅 2 行 re-export」的特征定位。
 */
function findProfileBootEntry(): string | null {
  try {
    const candidates: { path: string; mtime: number }[] = [];
    for (const file of readdirSync(DSH_CLI_LIB)) {
      if (!file.startsWith('profile-boot-') || !file.endsWith('.js')) continue;
      const fullPath = join(DSH_CLI_LIB, file);
      const content = readFileSync(fullPath, 'utf8');
      // 薄入口：`import { o as runProfile } from "./..."; export { runProfile };`
      if (content.includes('export { runProfile') && content.length < 300) {
        candidates.push({ path: fullPath, mtime: statSync(fullPath).mtimeMs });
      }
    }
    // tsdown 每次构建生成新 hash 产物、旧产物残留，取 mtime 最新的薄入口
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0]?.path ?? null;
  } catch {
    // dsh 未构建，降级
  }
  return null;
}

/**
 * 将 desktop profile 安装到 `$DSH_HOME/profiles/desktop`（幂等）。
 * desktop 的 profile 声明 `dsh.profile.bundles = [dsh-base, dsh-web-app]`（web 组合，
 * 微调 printUrl），而 dsh 对未知 profile 的默认初始化只有 `dsh-base`（无 web-app），
 * 故必须显式放置 desktop 工程自带的 profile。
 */
function ensureDesktopProfile(home: string): void {
  const dest = join(home, 'profiles', 'desktop');
  if (existsSync(join(dest, 'package.json'))) return;
  if (!existsSync(DESKTOP_PROFILE_SRC)) return;
  mkdirSync(dest, { recursive: true });
  cpSync(DESKTOP_PROFILE_SRC, dest, { recursive: true });
}

/** dsh runProfile 的最小签名（动态 import 产物无类型，此处收窄以保持类型安全） */
interface DshRunProfile {
  (options: {
    environment: unknown;
    profile: string;
    patchFiles: readonly string[];
    args: readonly string[];
  }): Promise<{
    ctx: { webServer: { port: number }; on: HostContext['on'] };
    shutdown: { shutdown: (code?: number) => void | Promise<void> };
  }>;
}

/**
 * 将 dsh 的 workspace 包链接到根 node_modules，使 loader 的默认 ESM import 可解析。
 *
 * 背景：dsh 的 loader（cordis-plugin-loader）通过 node-addon-require-builtin 原生模块
 * 获取 Node 内部 ESM loader（internal import，锚定 profile 目录解析插件）。该原生模块
 * 依赖 Electron V8 缺失的 GetAlignedPointerFromEmbedderData 符号（Electron 的 V8 为
 * -electron 分支），在 Electron 下加载失败，internal 失效，loader 回退到默认 ESM import
 * （从 vendor/loader/lib 向上解析）。pnpm 默认把 workspace 包链接在消费方 node_modules
 * （apps/cli/node_modules），根 node_modules 仅含根 manifest 直接依赖，故默认 import
 * 找不到插件。此处扫描 dsh 的全部 workspace 包源码目录（packages、vendor、apps），
 * 以 junction 链接到根 node_modules/@deepseek-ai/，使其可解析（包的 exports 指向编译产物 lib）。
 */
function ensureWorkspaceLinks(): void {
  const dest = join(DSH_ROOT, 'node_modules/@deepseek-ai');
  mkdirSync(dest, { recursive: true });
  for (const root of ['packages', 'vendor', 'apps']) {
    const rootDir = join(DSH_ROOT, root);
    if (!existsSync(rootDir)) continue;
    for (const cat of readdirSync(rootDir)) {
      const catDir = join(rootDir, cat);
      if (!existsSync(join(catDir, 'package.json'))) {
        // packages 为两级（packages/分类/包），vendor、apps 为一级
        if (!existsSync(catDir)) continue;
        try {
          for (const pkg of readdirSync(catDir)) {
            linkWorkspacePackage(join(catDir, pkg), dest);
          }
        } catch {
          // 非目录，跳过
        }
      } else {
        linkWorkspacePackage(catDir, dest);
      }
    }
  }
}

/** 若目录是 @deepseek-ai 包，且根 node_modules 无对应链接，则以 junction 链接。 */
function linkWorkspacePackage(pkgDir: string, dest: string): void {
  const pkgJson = join(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) return;
  try {
    const name = JSON.parse(readFileSync(pkgJson, 'utf8')).name as string | undefined;
    if (!name || !name.startsWith('@deepseek-ai/')) return;
    const shortName = name.slice('@deepseek-ai/'.length);
    const destPath = join(dest, shortName);
    if (existsSync(destPath)) return;
    symlinkSync(pkgDir, destPath, 'junction');
  } catch {
    // 解析失败或非 @deepseek-ai 包，跳过
  }
}

/** 将 dsh-market（插件市场，非 scoped 包）构建产物物化到 dsh 根 node_modules，使 loader 默认 ESM import 可解析。
 *  仅复制 lib/、client/、cordis.patch.yml、package.json（排除 node_modules）——dshmarket 的 @deepseek-ai 依赖
 *  从宿主（dsh 根 node_modules，经 ensureWorkspaceLinks）解析，避免其 devDeps 里的 @deepseek-ai 重复/版本错配。
 *  与 collect-dsh.mjs 的打包物化（dsh-dist/node_modules/dshmarket）对齐。 */
function ensureDshMarketMaterialized(): void {
  const src = resolve(__dirname, '../../../dsh-market');
  const dest = join(DSH_ROOT, 'node_modules', 'dshmarket');
  if (!existsSync(join(src, 'package.json')) || existsSync(join(dest, 'package.json'))) return;
  try {
    mkdirSync(dest, { recursive: true });
    for (const entry of ['package.json', 'cordis.patch.yml', 'lib', 'client']) {
      const s = join(src, entry);
      if (existsSync(s)) cpSync(s, join(dest, entry), { recursive: true, dereference: true });
    }
    console.log('[dsh-desktop] 已物化 dshmarket → dsh 根 node_modules');
  } catch {
    // 物化失败降级：市场不可解析时随 Host 启动不加载，不阻塞
  }
}

/**
 * 启动 dsh Host（desktop profile，进程内，MVP）。
 * 返回 HostHandle；dsh 未构建 / 启动失败时返回 null（主进程据此显示兜底页）。
 */
export async function startHost(): Promise<HostHandle | null> {
  const entry = findProfileBootEntry();
  if (!entry) {
    console.error('[dsh-desktop] dsh 未构建或产物缺失，宿主未启动');
    return null;
  }
  // 独立 DSH_HOME：避免污染用户全局 ~/.dsh；profile 与会话数据落在应用 userData
  if (!process.env.DSH_HOME) {
    process.env.DSH_HOME = join(app.getPath('userData'), '.dsh');
  }
  ensureDesktopProfile(process.env.DSH_HOME);
  // 开发模式需把 dsh workspace 包链接到根 node_modules（loader 默认 ESM import 解析）；
  // 打包后 dsh-dist 的 node_modules 已由 pnpm deploy 物化为扁平真实文件，无需链接。
  if (!app.isPackaged) {
    ensureWorkspaceLinks();
    ensureDshMarketMaterialized();
  }
  // dsh 的 HMR 依赖 Node 内部 API（--expose-internals / node-addon-require-builtin），
  // Electron 下不可用，禁用之（生产桌面壳无需用户 patch 热重载）。
  process.env.DSH_DISABLE_HMR = '1';

  try {
    // 动态 import dsh 的 ESM 编译产物（与 dsh CLI bin.js 的方式一致）；
    // 产物内部的 @deepseek-ai/* workspace 依赖由 Node 从 dsh 的 node_modules 解析。
    const profileBoot = await import(pathToFileURL(entry).href);
    const appBoot = await import(pathToFileURL(DSH_APP_BOOT_LIB).href);
    const runProfile = profileBoot.runProfile as DshRunProfile;
    const loadLayeredEnv = appBoot.loadLayeredEnv as (binName: string) => unknown;

    const { ctx, shutdown } = await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: 'desktop',
      patchFiles: [],
      args: ['--port', '0'],
    });
    const port = ctx.webServer.port;
    console.log(`[dsh-desktop] host 就绪: http://127.0.0.1:${port}/`);
    return {
      ctx,
      shutdown: (code) => shutdown.shutdown(code ?? 0),
      port,
      url: `http://127.0.0.1:${port}/`,
    };
  } catch (err) {
    // 完整打印（含 AggregateError 的 errors 数组与 cause 链），便于定位失败插件
    console.error('[dsh-desktop] host 启动失败:', inspect(err, { depth: 8, colors: false }));
    return null;
  }
}
