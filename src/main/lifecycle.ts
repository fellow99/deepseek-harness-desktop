import { app } from 'electron';

/**
 * 进程内 Host 的安全准备与生命周期兜底。
 * 参考 opencode desktop：packages/desktop/src/main/index.ts（NO_PROXY/CA/崩溃观测）。
 */

/**
 * 将 loopback 地址并入 NO_PROXY / no_proxy，避免 dsh webserver（127.0.0.1）
 * 的本地请求被系统代理劫持；同时给 Chromium 加 proxy-bypass-list（whenReady 前）。
 */
export function ensureLoopbackNoProxy(): void {
  const loopback = ['127.0.0.1', 'localhost', '::1'];
  for (const key of ['NO_PROXY', 'no_proxy'] as const) {
    const existing = (process.env[key] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const next = new Set<string>(existing);
    for (const host of loopback) next.add(host);
    process.env[key] = [...next].join(',');
  }
  app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
}

/**
 * 合并系统 CA 到默认证书集，避免 Electron 无法校验企业代理/自签证书。
 * 依赖 Node 24.4+ 的 node:tls getCACertificates/setDefaultCACertificates；
 * 用动态 require + 运行时守卫，兼容类型定义缺失与旧 Node 运行时。
 */
export function setupSystemCertificates(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tls = require('node:tls') as {
    getCACertificates?: (source: 'default' | 'system') => string[];
    setDefaultCACertificates?: (certs: string[]) => void;
  };
  if (
    typeof tls.getCACertificates === 'function' &&
    typeof tls.setDefaultCACertificates === 'function'
  ) {
    const certs = new Set<string>([
      ...tls.getCACertificates('default'),
      ...tls.getCACertificates('system'),
    ]);
    tls.setDefaultCACertificates([...certs]);
  }
}

/**
 * 崩溃兜底：MVP 阶段 harness 在主进程运行，异常即应用级崩溃（已知代价，见
 * 产品概念设计第 14 节）。此处记录 + 防止静默崩溃；host 边界预留 utilityProcess 迁移点。
 */
export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    // TODO：接入日志框架后替换 console
    console.error('[dsh-desktop] uncaughtException:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[dsh-desktop] unhandledRejection:', reason);
  });
}
