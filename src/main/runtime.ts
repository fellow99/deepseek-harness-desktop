/**
 * 便携运行时引导：内置 Node + pnpm 暴露给 dsh-market 的包操作通道（需求 001-dsh-market）。
 *
 * 背景：dsh-market 安装/删除插件会 spawn `dsh plugin --profile desktop add|remove <t>`；
 * `dsh plugin`（dsh-dist/lib/bin.js）内部 spawnSync('pnpm')。打包后的 Electron 应用无系统
 * Node/pnpm，故本模块在启动早期：
 *   1. POSIX 下 chmod 便携 node/pnpm 为可执行（deb/rpm 打包可能丢失 +x）；
 *   2. 在 userData/runtime-bin 生成 `dsh` shim（win: dsh.cmd / posix: dsh），指向
 *      `runtime/node <dsh-dist>/lib/bin.js`；
 *   3. 把 [userData/runtime-bin, resources/runtime/pnpm] 前置到 process.env.PATH。
 * 仅打包态（app.isPackaged）生效；开发态依赖开发机已有 Node/pnpm（市场 provisionPnpm 兜底）。
 */
import { app } from 'electron';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function isWin(): boolean {
  return process.platform === 'win32';
}

/** 便携 Node 可执行文件绝对路径（平台原生布局）。 */
function nodeBin(): string {
  const base = join(process.resourcesPath, 'runtime', 'node');
  return isWin() ? join(base, 'node.exe') : join(base, 'bin', 'node');
}

/** standalone pnpm 二进制绝对路径。 */
function pnpmBin(): string {
  return join(process.resourcesPath, 'runtime', 'pnpm', isWin() ? 'pnpm.exe' : 'pnpm');
}

/** dsh CLI 入口（dsh plugin 命令）。 */
function dshBin(): string {
  return join(process.resourcesPath, 'dsh-dist', 'lib', 'bin.js');
}

/** 生成 dsh shim 内容。 */
function dshShim(): string {
  if (isWin()) {
    // .cmd：cmd.exe 经 PATHEXT 解析；%* 转发已正确引用的参数
    return `@echo off\r\n"${nodeBin()}" "${dshBin()}" %*\r\nexit /b %errorlevel%\r\n`;
  }
  return `#!/bin/sh\nexec "${nodeBin()}" "${dshBin()}" "$@"\n`;
}

/**
 * 引导便携运行时（幂等，每次启动重写 shim 以自愈路径变更）。
 * 仅打包态执行；开发态依赖开发机 Node/pnpm。
 */
export function setupBundledRuntime(): void {
  if (!app.isPackaged) return;

  // POSIX：deb/rpm 打包可能丢失可执行位，兜底恢复
  if (!isWin()) {
    for (const bin of [nodeBin(), pnpmBin()]) {
      try {
        if (existsSync(bin)) chmodSync(bin, 0o755);
      } catch {
        // 只读资源或不存在，忽略
      }
    }
  }

  // 生成 dsh shim 到 userData（可写）
  const binDir = join(app.getPath('userData'), 'runtime-bin');
  try {
    mkdirSync(binDir, { recursive: true });
    const shimPath = join(binDir, isWin() ? 'dsh.cmd' : 'dsh');
    if (isWin()) {
      writeFileSync(shimPath, dshShim());
    } else {
      writeFileSync(shimPath, dshShim(), { mode: 0o755 });
    }
  } catch (err) {
    console.warn('[dsh-desktop] dsh shim 生成失败，市场安装通道不可用:', err);
    return;
  }

  // 前置 PATH：[userData/runtime-bin, resources/runtime/pnpm, 便携 Node 的 bin] + 原 PATH。
  // 便携 Node 的 bin 也需入 PATH：pnpm 运行插件生命周期脚本（prepare 等）时按名调用 node。
  const sep = isWin() ? ';' : ':';
  const pnpmDir = join(process.resourcesPath, 'runtime', 'pnpm');
  const nodeDir = isWin()
    ? join(process.resourcesPath, 'runtime', 'node')
    : join(process.resourcesPath, 'runtime', 'node', 'bin');
  const prev = process.env.PATH ?? '';
  process.env.PATH = [binDir, pnpmDir, nodeDir, prev].filter(Boolean).join(sep);
  console.log('[dsh-desktop] 便携运行时已就绪（Node + pnpm + dsh shim）');
}
