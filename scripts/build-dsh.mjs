#!/usr/bin/env node
/**
 * 构建 dsh（deepseek-harness）：apply Electron 兼容 patch + 安装依赖 + 构建产物。
 *
 * 用法：npm run build:dsh
 * 前置：dsh 与本工程同级目录（../deepseek-harness），git 仓库。
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dshRoot = resolve(desktopRoot, '../deepseek-harness');
const patchFiles = [
  resolve(desktopRoot, 'patches/dsh-disable-hmr.patch'),
  resolve(desktopRoot, 'patches/dsh-disable-native-picker.patch'),
];

// pnpm/tsdown 在无 TTY 时中止模块重建与依赖检查，故设 CI 使其自动处理
process.env.CI = process.env.CI ?? 'true';
process.env.npm_config_confirm_modules_purge = 'false';
process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';

function run(cmd, cwd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

/** 静默执行，返回是否成功。 */
function runQuiet(cmd, cwd) {
  try {
    execSync(cmd, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// 0. 校验前置
if (!existsSync(dshRoot)) {
  console.error(`[build-dsh] dsh 未找到: ${dshRoot}`);
  process.exit(1);
}

// 0.5 清理 vendor 残留（collect/deploy 历史错误产物，会被 tsdown 的 vendor/* glob 匹配
//     并导致 build 报 dsh-root entry 失败）
const vendorJunk = resolve(dshRoot, 'vendor/deepseek-harness-desktop');
if (existsSync(vendorJunk)) {
  rmSync(vendorJunk, { recursive: true, force: true });
  console.log('[build-dsh] 清理 vendor 残留: vendor/deepseek-harness-desktop');
}

// 1. apply patches（幂等：--reverse --check 成功即已应用，跳过）
for (const patchFile of patchFiles) {
  if (!existsSync(patchFile)) {
    console.error(`[build-dsh] patch 未找到: ${patchFile}`);
    process.exit(1);
  }
  const applied = runQuiet(`git apply --reverse --check "${patchFile}"`, dshRoot);
  if (applied) {
    console.log(`[build-dsh] patch 已应用: ${basename(patchFile)}`);
  } else {
    try {
      run(`git apply "${patchFile}"`, dshRoot);
    } catch {
      console.error(`[build-dsh] patch 应用失败（可能与 dsh 版本冲突）: ${basename(patchFile)}`);
      process.exit(1);
    }
  }
}

// 2. 安装依赖（node_modules 缺失时）
if (!existsSync(resolve(dshRoot, 'node_modules'))) {
  run('corepack pnpm install', dshRoot);
}

// 3. 构建产物（host lib + client lib + web dist）
run('corepack pnpm run build:lib:host', dshRoot);
run('corepack pnpm run build:lib:client', dshRoot);
run('corepack pnpm run build:web', dshRoot);

console.log('\n[build-dsh] 完成：dsh lib host/client + web dist 已就绪');
