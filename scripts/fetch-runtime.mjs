#!/usr/bin/env node
/**
 * 获取便携运行时（Node.js + standalone pnpm）到 runtime/，供 Electron Forge extraResource 打包。
 *
 * 用法：npm run fetch:runtime
 * 幂等：逐产物校验完整性（win32 校验完整 PE 映像），仅重新下载缺失或损坏的产物；
 * runtime/.versions.json 仅在全部产物校验通过后写入，截断的下载不会被记录为「就绪」。
 * 支持平台：win32（x64/arm64）、linux（x64/arm64）、darwin（x64/arm64）。
 * 布局（平台原生）：
 *   runtime/node/     —— Node 发行版（win: node.exe 在根；linux/darwin: bin/node）
 *   runtime/pnpm/     —— standalone pnpm 单二进制（pnpm[.exe]）
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, accessSync, closeSync, constants, openSync, readSync, renameSync, statSync } from 'node:fs';
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

/**
 * 下载重试次数：产物可达数十 MB（pnpm 约 54MB），慢速/抖动网络下下载中途被中断很常见，
 * 而中断正是本次问题的成因——重试避免一次中断就让整轮构建失败。
 */
const DOWNLOAD_ATTEMPTS = 3;

/**
 * 下载 url 到 dest：先写 `<dest>.part`，确认大小与响应 Content-Length 一致后才 rename，
 * 避免截断的下载被当成完整产物（本次修复的根因）。
 * 失败（网络中断/大小不符）时清理临时文件并重试，最多 DOWNLOAD_ATTEMPTS 次。
 */
async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const contentLength = await downloadViaFetch(url, part);
      const size = statSync(part).size;
      if (contentLength > 0 && size !== contentLength) {
        throw new Error(`download truncated: expected ${contentLength} bytes, got ${size}: ${url}`);
      }
      renameSync(part, dest);
      return;
    } catch (err) {
      lastError = err;
      // 清理临时文件，避免残留的截断产物被后续误用
      rmSync(part, { force: true });
      console.warn(`[fetch-runtime] 下载失败（第 ${attempt}/${DOWNLOAD_ATTEMPTS} 次）：${err.message}`);
    }
  }
  throw lastError;
}

/**
 * Node 内置 fetch 流式下载到临时文件，返回响应 Content-Length（缺省为 0）。
 */
async function downloadViaFetch(url, part) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status}: ${url}`);
  const contentLength = Number(res.headers.get('content-length'));
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  return contentLength;
}

/**
 * win32 专用：校验文件是完整的 PE 映像。
 * 逐节区要求 PointerToRawData + SizeOfRawData <= 文件实际大小——
 * 截断下载的 PE 能通过「文件存在」检查，但 Windows 加载时会报「不是有效的 Win32 应用程序」。
 */
function isCompletePeImage(path) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return false;
  }
  if (size <= 0) return false;

  const fd = openSync(path, 'r');
  try {
    const magic = Buffer.alloc(2);
    readSync(fd, magic, 0, 2, 0);
    if (magic[0] !== 0x4d || magic[1] !== 0x5a) return false; // 'MZ'

    const lfanew = Buffer.alloc(4);
    readSync(fd, lfanew, 0, 4, 0x3c);
    const peOff = lfanew.readUInt32LE(0);

    // PE 签名(4B) + COFF 头(20B)：Machine@+4、NumberOfSections@+6、SizeOfOptionalHeader@+20
    const coffLen = 24;
    if (peOff + coffLen > size) return false;
    const coff = Buffer.alloc(coffLen);
    readSync(fd, coff, 0, coffLen, peOff);
    if (coff.readUInt32LE(0) !== 0x00004550) return false; // 'PE\0\0'
    const machine = coff.readUInt16LE(4);
    const numberOfSections = coff.readUInt16LE(6);
    const sizeOfOptionalHeader = coff.readUInt16LE(20);
    if (machine === 0 || numberOfSections === 0) return false;

    // 节区表：peOff + 24 + SizeOfOptionalHeader 起，每条目 40 字节
    const sectionTableOff = peOff + coffLen + sizeOfOptionalHeader;
    const sectionTableLen = numberOfSections * 40;
    if (sectionTableOff + sectionTableLen > size) return false;
    const sections = Buffer.alloc(sectionTableLen);
    readSync(fd, sections, 0, sectionTableLen, sectionTableOff);
    for (let i = 0; i < numberOfSections; i += 1) {
      const entry = i * 40;
      const sizeOfRawData = sections.readUInt32LE(entry + 16);
      const pointerToRawData = sections.readUInt32LE(entry + 20);
      if (pointerToRawData + sizeOfRawData > size) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

/**
 * 产物完整性校验（Node 与 pnpm 共用）：
 * win32 要求是完整 PE 映像；其它平台要求存在、非空且可执行。
 */
function isValidArtifact(path) {
  if (platform === 'win32') return isCompletePeImage(path);
  try {
    const st = statSync(path);
    accessSync(path, constants.X_OK);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/**
 * 版本戳是否已等于期望值（逐字节比对）。
 */
function stampUpToDate(stamp, wanted) {
  try {
    return existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted;
  } catch {
    return false;
  }
}

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

async function main() {
  const stamp = join(runtimeRoot, '.versions.json');
  const wanted = JSON.stringify({ node: NODE_VERSION, pnpm: PNPM_VERSION, platform, arch });

  // 1. Node 产物：仅当现有产物校验不通过时才下载解压
  const { file: nodeFile, kind } = nodeAsset();
  const nodeDir = join(runtimeRoot, 'node');
  const nodeBin = platform === 'win32' ? join(nodeDir, 'node.exe') : join(nodeDir, 'bin', 'node');
  if (isValidArtifact(nodeBin)) {
    console.log('[fetch-runtime] Node 运行时已就绪，跳过');
  } else {
    const nodeUrl = `https://nodejs.org/dist/v${NODE_VERSION}/${nodeFile}`;
    const nodeArchive = join(runtimeRoot, nodeFile);
    console.log(`[fetch-runtime] 下载 Node: ${nodeUrl}`);
    await download(nodeUrl, nodeArchive);
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
    if (!isValidArtifact(nodeBin)) throw new Error(`[fetch-runtime] Node 运行时校验失败: ${nodeBin}`);
  }

  // 2. pnpm 产物：仅当现有产物校验不通过时才下载
  const { file: pnpmFile, url: pnpmUrl } = pnpmAsset();
  const pnpmDir = join(runtimeRoot, 'pnpm');
  const pnpmDest = join(pnpmDir, pnpmFile);
  if (isValidArtifact(pnpmDest)) {
    console.log('[fetch-runtime] pnpm 运行时已就绪，跳过');
  } else {
    console.log(`[fetch-runtime] 下载 pnpm: ${pnpmUrl}`);
    await download(pnpmUrl, pnpmDest);
    if (platform !== 'win32') chmodSync(pnpmDest, 0o755);
    if (!isValidArtifact(pnpmDest)) throw new Error(`[fetch-runtime] pnpm 运行时校验失败: ${pnpmDest}`);
  }

  // 3. 仅当全部产物校验通过后写版本戳
  if (!stampUpToDate(stamp, wanted)) writeFileSync(stamp, wanted);
  console.log('\n[fetch-runtime] 完成');
}

main().catch((err) => {
  console.error('[fetch-runtime] 失败:', err.message);
  process.exit(1);
});
