#!/usr/bin/env node
/**
 * 收集 dsh 部署产物：pnpm deploy 物化依赖闭包 → 物化 Junction → 补全 @deepseek-ai 包
 * 与非 hoisted 依赖 → 复制 web dist。
 *
 * 产出 desktop/dsh-dist/（真实文件、无 Junction、无 .pnpm），供 forge extraResource 打进
 * out/resources/dsh-dist。前置：dsh 已构建（npm run build:dsh）。
 *
 * 背景：pnpm deploy --legacy 物化的 node_modules 是「链接结构」（外部依赖为 Junction 指向
 * .pnpm store），打包分发后指向失效，故需物化为真实文件。且 deploy 不物化：① peerDependencies
 * （如 cordis-plugin-group、大量 packages 下插件）；② 非 hoisted 的外部依赖（如 zod）。
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dshRoot = resolve(desktopRoot, '../deepseek-harness');
const distDir = resolve(desktopRoot, 'dsh-dist');

function run(cmd, cwd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

/** 递归物化目录下的 Junction 为真实文件（跳过 .bin 与 .pnpm）。 */
function materializeJunctions(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.name === '.bin' || entry.name === '.pnpm') continue;
    let st;
    try {
      st = lstatSync(fullPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      try {
        const target = realpathSync(fullPath);
        rmSync(fullPath, { recursive: true, force: true });
        cpSync(target, fullPath, { recursive: true, dereference: true });
      } catch (err) {
        console.warn(`[collect-dsh] 物化失败 ${fullPath}: ${err.message}`);
      }
    } else if (st.isDirectory()) {
      materializeJunctions(fullPath, depth + 1);
    }
  }
}

/** 复制单个 @deepseek-ai 包（lib + package.json + cordis.patch.yml 等，排除 node_modules）。 */
function copyPackage(pkgDir, destRoot) {
  const pkgJson = resolve(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) return;
  let name;
  try {
    name = JSON.parse(readFileSync(pkgJson, 'utf8')).name;
  } catch {
    return;
  }
  if (!name || !name.startsWith('@deepseek-ai/')) return;
  const shortName = name.slice('@deepseek-ai/'.length);
  const dest = resolve(destRoot, shortName);
  if (existsSync(dest)) return; // 已物化
  cpSync(pkgDir, dest, {
    recursive: true,
    dereference: true,
    // 排除 node_modules：嵌套依赖是 Junction 指向其它包，递归物化会循环；扁平结构里已有
    filter: (src) => !src.includes('node_modules'),
  });
  console.log(`[collect-dsh] 物化 @deepseek-ai/${shortName}`);
}

/** 物化 dsh-market（插件市场，非 scoped 包）到 dsh-dist/node_modules/dshmarket。
 *  仅复制运行时必需产物：package.json + cordis.patch.yml + lib/ + client/（排除源码/测试/node_modules）。 */
function collectDshMarket() {
  const marketRoot = resolve(desktopRoot, '../dsh-market');
  const dest = resolve(distDir, 'node_modules/dshmarket');
  if (!existsSync(resolve(marketRoot, 'package.json'))) {
    console.warn(`[collect-dsh] dsh-market 未找到，跳过: ${marketRoot}`);
    return;
  }
  if (existsSync(resolve(dest, 'package.json'))) {
    console.log('[collect-dsh] dshmarket 已物化');
    return;
  }
  cpSync(marketRoot, dest, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const rel = src.slice(marketRoot.length + 1);
      if (rel === '') return true;
      const top = rel.split(/[\\/]/)[0];
      return top === 'package.json' || top === 'cordis.patch.yml' || top === 'lib' || top === 'client';
    },
  });
  console.log('[collect-dsh] 物化 dshmarket（lib/client/cordis.patch.yml/package.json）');
}

/** 补全所有 @deepseek-ai 包（packages、vendor、apps 下），覆盖 peer 依赖与 link: override。 */
function collectWorkspacePackages() {
  const destRoot = resolve(distDir, 'node_modules/@deepseek-ai');
  for (const root of ['packages', 'vendor', 'apps']) {
    const rootDir = resolve(dshRoot, root);
    if (!existsSync(rootDir)) continue;
    for (const cat of readdirSync(rootDir)) {
      const catDir = resolve(rootDir, cat);
      if (!existsSync(catDir)) continue;
      if (existsSync(resolve(catDir, 'package.json'))) {
        copyPackage(catDir, destRoot); // 一级（vendor/*、apps/*）
      } else {
        try {
          for (const pkg of readdirSync(catDir)) {
            copyPackage(resolve(catDir, pkg), destRoot); // 两级（packages/*/*）
          }
        } catch {
          // 非目录，跳过
        }
      }
    }
  }
}

/** 物化非 hoisted 的外部依赖到顶层 node_modules。
 *  从每个 .pnpm entry 的 node_modules 子目录提取真实包名（entry 名可能是截断+hash，
 *  如 @opentelemetry+exporter-log_8841...，真实包名在 node_modules/@opentelemetry/exporter-logs-otlp-http）。 */
function collectNonHoistedDeps() {
  const pnpmDir = resolve(distDir, 'node_modules/.pnpm');
  const topDir = resolve(distDir, 'node_modules');
  if (!existsSync(pnpmDir)) return;
  const seen = new Set();
  const materialize = (entry, pkgName) => {
    if (seen.has(pkgName)) return;
    seen.add(pkgName);
    const dest = resolve(topDir, ...pkgName.split('/'));
    if (existsSync(dest)) return; // 已 hoisted 或已物化
    const nested = resolve(pnpmDir, entry, 'node_modules', ...pkgName.split('/'));
    if (!existsSync(nested)) return;
    cpSync(nested, dest, { recursive: true, dereference: true });
    console.log(`[collect-dsh] 物化非 hoisted 依赖 ${pkgName}`);
  };
  for (const entry of readdirSync(pnpmDir)) {
    const entryNodeModules = resolve(pnpmDir, entry, 'node_modules');
    if (!existsSync(entryNodeModules)) continue;
    for (const scopeOrName of readdirSync(entryNodeModules)) {
      const full = resolve(entryNodeModules, scopeOrName);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (scopeOrName.startsWith('@')) {
        for (const name of readdirSync(full)) {
          materialize(entry, `${scopeOrName}/${name}`);
        }
      } else {
        materialize(entry, scopeOrName);
      }
    }
  }
}

/** 递归清理原生模块中非目标平台的 prebuilds（如 node-pty 的 linux-arm64/win32-x64 等），
 *  避免 rpmbuild 的 brp-strip 遇到非目标架构 .node 报错，并减小包体积。 */
function pruneForeignPrebuilds(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const target = `${process.platform}-${process.arch}`;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(dir, entry.name);
    if (entry.name === 'prebuilds') {
      for (const sub of readdirSync(fullPath)) {
        const subPath = resolve(fullPath, sub);
        let st;
        try {
          st = lstatSync(subPath);
        } catch {
          continue;
        }
        if (!st.isDirectory()) continue;
        if (sub !== target) {
          rmSync(subPath, { recursive: true, force: true });
          console.log(`[collect-dsh] 清理非目标架构 prebuilds: ${sub}`);
        }
      }
    } else {
      pruneForeignPrebuilds(fullPath, depth + 1);
    }
  }
}

// 0. 校验
if (!existsSync(dshRoot)) {
  console.error(`[collect-dsh] dsh 未找到: ${dshRoot}`);
  process.exit(1);
}

// 1. 清理旧产物
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });

// 2. pnpm deploy 物化依赖闭包（apps/cli 的 dependencies 含 web profile 全部插件）
run(`corepack pnpm --filter @deepseek-ai/dsh deploy --legacy "${distDir}"`, dshRoot);

// 3. 物化顶层 Junction（js-yaml 等）
console.log('\n[collect-dsh] 物化 Junction 为真实文件...');
materializeJunctions(join(distDir, 'node_modules'));

// 4. 补全 @deepseek-ai 包（peer 依赖与 link: override）
console.log('\n[collect-dsh] 补全 @deepseek-ai 包...');
collectWorkspacePackages();

// 4b. 物化 landlock-run 入口包（native 原生模块，win32 无平台 .node，但沙箱插件静态 import 其入口；
//     产品概念设计已确认 MVP 裁掉 landlock 原生沙箱，此处仅物化入口使 import 不报错）
const landlockEntry = resolve(dshRoot, 'native/landlock-run/packages/entry');
copyPackage(landlockEntry, resolve(distDir, 'node_modules/@deepseek-ai'));

// 5. 物化非 hoisted 依赖（zod 等）
console.log('\n[collect-dsh] 物化非 hoisted 依赖...');
collectNonHoistedDeps();

// 6. 删除 .pnpm store（已物化，冗余）
const pnpmStore = resolve(distDir, 'node_modules/.pnpm');
if (existsSync(pnpmStore)) rmSync(pnpmStore, { recursive: true, force: true });

// 6b. 清理非目标架构的原生模块 prebuilds（node-pty 等），避免 rpmbuild brp-strip 失败
console.log('\n[collect-dsh] 清理非目标架构 prebuilds...');
pruneForeignPrebuilds(join(distDir, 'node_modules'));

// 7. 复制 web dist（pnpm deploy 不物化 build 产物，frontend-static 经
//    require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html') 定位）
const webDist = resolve(dshRoot, 'apps/web/dist');
const webFrontendDist = resolve(distDir, 'node_modules/@deepseek-ai/dsh-web-frontend/dist');
if (existsSync(webDist)) {
  cpSync(webDist, webFrontendDist, { recursive: true });
  console.log('[collect-dsh] web dist 已复制到 dsh-web-frontend/dist');
} else {
  console.error('[collect-dsh] web dist 缺失（先跑 npm run build:dsh）');
  process.exit(1);
}

// 8. 复制 desktop profile 到 dsh-dist/profiles/desktop（供 host.ts 复制到 $DSH_HOME）
const profileSrc = resolve(desktopRoot, 'profiles/desktop');
const profileDest = resolve(distDir, 'profiles/desktop');
if (existsSync(profileSrc)) {
  cpSync(profileSrc, profileDest, { recursive: true });
  console.log('[collect-dsh] desktop profile 已复制到 dsh-dist/profiles/desktop');
}

// 9. 物化 dsh-market（插件市场）到 dsh-dist/node_modules/dshmarket
collectDshMarket();

console.log(`\n[collect-dsh] 完成: ${distDir}`);
