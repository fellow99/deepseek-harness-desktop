#!/usr/bin/env node
/**
 * 获取便携运行时（Node.js + standalone pnpm）到 runtime/，供 Electron Forge extraResource 打包。
 *
 * 用法：npm run fetch:runtime
 * 幂等：runtime/.versions.json 记录已下载版本，匹配则跳过。
 * 支持平台：win32（x64/arm64）、linux（x64/arm64）、darwin（x64/arm64）。
 * 布局（平台原生）：
 *   runtime/node/     —— Node 发行版（win: node.exe 在根；linux/darwin: bin/node）
 *   runtime/pnpm/     —— standalone pnpm 单二进制（pnpm[.exe]）
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runtimeRoot = resolve(desktopRoot, 'runtime');

// 版本固定：Node 24 LTS（对齐 Electron 43 内置 Node 24）；pnpm 9.x（规避 pnpm≥10 构建脚本拦截）
const NODE_VERSION = '24.11.1';
const PNPM_VERSION = '9.15.9';

const platform = process.platform;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

function nodeAsset() {
  if (platform === 'win32') return { file: `node-v${NODE_VERSION}-win-${arch}.zip`, kind: 'zip' };
  if (platform === 'linux') return { file: `node-v${NODE_VERSION}-linux-${arch}.tar.xz`, kind: 'tar' };
  if (platform === 'darwin') {
    // macOS 官方仅提供 .tar.gz（无 .tar.xz）；Intel=x64，Apple Silicon=arm64。
    return { file: `node-v${NODE_VERSION}-darwin-${arch}.tar.gz`, kind: 'tar' };
  }
  throw new Error(`[fetch-runtime] unsupported platform: ${platform}`);
}

function pnpmAsset() {
  if (platform === 'win32') {
    return { file: 'pnpm.exe', url: `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-win-${arch}.exe` };
  }
  if (platform === 'linux') {
    return { file: 'pnpm', url: `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linuxstatic-${arch}` };
  }
  if (platform === 'darwin') {
    return { file: 'pnpm', url: `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-macos-${arch}` };
  }
  throw new Error(`[fetch-runtime] unsupported platform: ${platform}`);
}

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status}: ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

async function main() {
  const stamp = join(runtimeRoot, '.versions.json');
  const wanted = JSON.stringify({ node: NODE_VERSION, pnpm: PNPM_VERSION, platform, arch });
  if (existsSync(stamp)) {
    try {
      if (readFileSync(stamp, 'utf8') === wanted) {
        console.log('[fetch-runtime] 运行时已就绪，跳过');
        return;
      }
    } catch {
      // 重新下载
    }
  }

  // 1. 下载并解压 Node → runtime/node/
  const { file: nodeFile, kind } = nodeAsset();
  const nodeUrl = `https://nodejs.org/dist/v${NODE_VERSION}/${nodeFile}`;
  const nodeArchive = join(runtimeRoot, nodeFile);
  console.log(`[fetch-runtime] 下载 Node: ${nodeUrl}`);
  await download(nodeUrl, nodeArchive);

  const nodeDir = join(runtimeRoot, 'node');
  rmSync(nodeDir, { recursive: true, force: true });
  if (kind === 'zip') {
    run(`powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '${nodeArchive}' -DestinationPath '${runtimeRoot}'"`);
    const extracted = join(runtimeRoot, `node-v${NODE_VERSION}-win-${arch}`);
    run(`powershell -NoProfile -Command "Rename-Item -LiteralPath '${extracted}' -NewName 'node'"`);
  } else {
    mkdirSync(nodeDir, { recursive: true });
    run(`tar -xf "${nodeArchive}" -C "${nodeDir}" --strip-components=1`);
  }
  rmSync(nodeArchive, { force: true });

  // 2. 下载 pnpm 单二进制 → runtime/pnpm/
  const { file: pnpmFile, url: pnpmUrl } = pnpmAsset();
  const pnpmDir = join(runtimeRoot, 'pnpm');
  mkdirSync(pnpmDir, { recursive: true });
  const pnpmDest = join(pnpmDir, pnpmFile);
  console.log(`[fetch-runtime] 下载 pnpm: ${pnpmUrl}`);
  await download(pnpmUrl, pnpmDest);
  if (platform !== 'win32') chmodSync(pnpmDest, 0o755);

  // 3. 版本戳
  writeFileSync(stamp, wanted);
  console.log('\n[fetch-runtime] 完成');
}

main().catch((err) => {
  console.error('[fetch-runtime] 失败:', err.message);
  process.exit(1);
});
