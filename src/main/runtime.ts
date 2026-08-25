/**
 * dsh-market 包操作运行时引导：生成 `dsh` shim 并注入 PATH，供市场 spawn `dsh plugin` 安装/删除插件。
 *
 * 背景：dsh-market 安装/删除插件会 spawn `dsh plugin --profile desktop add|remove <t>`；
 * `dsh plugin`（dsh CLI，lib/bin.js）内部 spawnSync('pnpm')。市场经 `dshArgv()` 回退到 PATH 上的 `dsh`，
 * 故需在启动早期生成 shim 并前置 PATH。
 *
 * - 开发态：shim 用系统 node（裸 `node`）运行同级 deepseek-harness 的 CLI 产物；pnpm 走系统 corepack。
 * - 打包态：shim 用便携 Node 绝对路径运行 dsh-dist/lib/bin.js；额外 chmod 便携 node/pnpm，并把
 *   pnpm 与便携 Node 的 bin 前置到 PATH（pnpm 生命周期脚本按名调用 node）。
 */
import { app } from 'electron';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function isWin(): boolean {
  return process.platform === 'win32';
}

/** 便携 Node 可执行文件绝对路径（仅打包态）。 */
function bundledNodeBin(): string {
  const base = join(process.resourcesPath, 'runtime', 'node');
  return isWin() ? join(base, 'node.exe') : join(base, 'bin', 'node');
}

/** dsh CLI 入口（dsh plugin 命令）。开发态用同级 deepseek-harness 源码产物，打包态用 dsh-dist。 */
function dshBinJs(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'dsh-dist', 'lib', 'bin.js')
    : resolve(__dirname, '../../../deepseek-harness/apps/cli/lib/bin.js');
}

/** 生成 dsh shim 内容。 */
function dshShim(): string {
  const bin = dshBinJs();
  if (isWin()) {
    const cmd = app.isPackaged ? `"${bundledNodeBin()}" "${bin}" %*` : `node "${bin}" %*`;
    return `@echo off\r\n${cmd}\r\nexit /b %errorlevel%\r\n`;
  }
  const cmd = app.isPackaged ? `exec "${bundledNodeBin()}" "${bin}" "$@"` : `exec node "${bin}" "$@"`;
  return `#!/bin/sh\n${cmd}\n`;
}

/**
 * 引导 dsh-market 的包操作运行时（dsh CLI + pnpm）。幂等，每次启动重写 shim。
 */
export function setupMarketRuntime(): void {
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

  const sep = isWin() ? ';' : ':';
  const prev = process.env.PATH ?? '';
  if (app.isPackaged) {
    // POSIX：deb/rpm 打包可能丢失可执行位，兜底恢复
    if (!isWin()) {
      const pnpm = join(process.resourcesPath, 'runtime', 'pnpm', 'pnpm');
      for (const bin of [bundledNodeBin(), pnpm]) {
        try {
          if (existsSync(bin)) chmodSync(bin, 0o755);
        } catch {
          // 只读资源或不存在，忽略
        }
      }
    }
    const pnpmDir = join(process.resourcesPath, 'runtime', 'pnpm');
    const nodeDir = isWin()
      ? join(process.resourcesPath, 'runtime', 'node')
      : join(process.resourcesPath, 'runtime', 'node', 'bin');
    process.env.PATH = [binDir, pnpmDir, nodeDir, prev].filter(Boolean).join(sep);
  } else {
    process.env.PATH = [binDir, prev].filter(Boolean).join(sep);
  }
  console.log('[dsh-desktop] dsh-market 包操作运行时已就绪');
}
