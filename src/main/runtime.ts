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
 * - 防遮蔽：前置前对捆绑 pnpm/Node 做同步结构校验（PE 完整性/可执行位），校验失败的目录不前置，
 *   避免损坏（如截断下载）的捆绑二进制遮蔽系统 PATH 上用户可用的 pnpm/node。
 */
import { app } from 'electron';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  writeFileSync,
} from 'node:fs';
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

/** 从文件描述符同步读取定长块；EOF/截断时返回较短的 Buffer，由调用方按长度判定无效。 */
function readChunk(fd: number, offset: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const n = readSync(fd, buf, 0, length, offset);
  if (n === null || n <= 0) return Buffer.alloc(0);
  return n < length ? buf.subarray(0, n) : buf;
}

/**
 * 同步校验捆绑可执行文件是否结构完整可用（不启动子进程，启动期开销极小）：
 * - win32：必须是完整 PE 镜像——MZ 头、PE 签名、Machine 与宿主架构一致
 *   （x64→0x8664，arm64→0xAA64），且每个 section 的 PointerToRawData + SizeOfRawData
 *   不超出文件大小（截断下载的典型特征，必被拦截）；
 * - 其它平台：文件存在且具备可执行权限。
 * 任何 IO/解析错误均返回 false，绝不抛出。
 */
function isUsableExecutable(file: string): boolean {
  try {
    if (!existsSync(file)) return false;
    if (!isWin()) {
      accessSync(file, constants.X_OK);
      return true;
    }
    const fd = openSync(file, 'r');
    try {
      const size = fstatSync(fd).size;
      if (size === 0) return false;
      // DOS 头：offset 0 必须是 'MZ'
      const dos = readChunk(fd, 0, 2);
      if (dos.length < 2 || dos[0] !== 0x4d || dos[1] !== 0x5a) return false;
      // e_lfanew：u32 LE @ 0x3C，指向 PE 签名
      const lfanew = readChunk(fd, 0x3c, 4);
      if (lfanew.length < 4) return false;
      const peOff = lfanew.readUInt32LE(0);
      const sig = readChunk(fd, peOff, 4);
      if (sig.length < 4 || sig[0] !== 0x50 || sig[1] !== 0x45 || sig[2] !== 0 || sig[3] !== 0) {
        return false;
      }
      // COFF 头：Machine 必须匹配宿主架构（未知架构无法校验，按不可用处理）
      const expectedMachine = process.arch === 'x64' ? 0x8664 : process.arch === 'arm64' ? 0xaa64 : -1;
      const machine = readChunk(fd, peOff + 4, 2);
      if (machine.length < 2 || machine.readUInt16LE(0) !== expectedMachine) return false;
      const secCount = readChunk(fd, peOff + 6, 2);
      const optSize = readChunk(fd, peOff + 20, 2);
      if (secCount.length < 2 || optSize.length < 2) return false;
      const sections = secCount.readUInt16LE(0);
      const optionalSize = optSize.readUInt16LE(0);
      if (sections === 0) return false;
      // section 表：每项 40 字节，起始 peOff+24+SizeOfOptionalHeader，整表不得越界
      const tableOff = peOff + 24 + optionalSize;
      if (tableOff + sections * 40 > size) return false;
      for (let i = 0; i < sections; i += 1) {
        // SizeOfRawData（u32 LE @ 项内 0x10）、PointerToRawData（u32 LE @ 项内 0x14）
        const raw = readChunk(fd, tableOff + i * 40 + 0x10, 8);
        if (raw.length < 8) return false;
        const rawSize = raw.readUInt32LE(0);
        const rawPtr = raw.readUInt32LE(4);
        // 截断下载的典型特征：声明的原始数据范围超出实际文件大小
        if (rawPtr + rawSize > size) return false;
      }
      return true;
    } finally {
      closeSync(fd);
    }
  } catch {
    // 任何 IO/解析异常（文件消失、权限等）一律视为不可用，绝不向外抛出
    return false;
  }
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
    const pnpmBin = isWin() ? join(pnpmDir, 'pnpm.exe') : join(pnpmDir, 'pnpm');
    // 仅前置通过结构校验的产物，避免损坏（如截断下载）的捆绑二进制遮蔽系统可用版本
    const dirs = [binDir];
    if (isUsableExecutable(pnpmBin)) {
      dirs.push(pnpmDir);
    } else {
      console.warn(
        `[dsh-desktop] 捆绑 pnpm 不可用：${pnpmBin} 不是可用的可执行文件（可能不完整或已损坏），回退使用系统 PATH`,
      );
    }
    if (isUsableExecutable(bundledNodeBin())) {
      dirs.push(nodeDir);
    } else {
      console.warn(
        `[dsh-desktop] 捆绑 Node 不可用：${bundledNodeBin()} 不是可用的可执行文件（可能不完整或已损坏），回退使用系统 PATH`,
      );
    }
    process.env.PATH = [...dirs, prev].filter(Boolean).join(sep);
  } else {
    process.env.PATH = [binDir, prev].filter(Boolean).join(sep);
  }
  console.log('[dsh-desktop] dsh-market 包操作运行时已就绪');
}
