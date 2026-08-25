import { app, BrowserWindow } from 'electron';
// 静态 import 使 Vite 将其打包进 bundle（forge Vite 插件的 ignore 会排除 node_modules，运行时无法 require）
import started from 'electron-squirrel-startup';
import {
  ensureLoopbackNoProxy,
  installCrashHandlers,
  setupSystemCertificates,
} from './lifecycle';
import { startHost, type HostHandle } from './host';
import { setupMarketRuntime } from './runtime';
import { createMainWindow, registerWindowIpcHandlers } from './windows';
import { createTray, destroyTray } from './tray';
import { setupNotifications } from './notifications';

// 处理 Squirrel.Windows 安装/卸载时的快捷方式创建/删除（必须在 main 入口最前）
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let host: HostHandle | null = null;
let isQuitting = false;

// ── 1. 单实例锁（最前，失败即退）─────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // ── 2. 启动前安全设置（whenReady 前）───────────────────────
  setupSystemCertificates();
  ensureLoopbackNoProxy();
  installCrashHandlers();

  // ── 3. 主流程 ─────────────────────────────────────────────
  void app.whenReady().then(async () => {
    // Windows 原生通知需要 AppUserModelID
    app.setAppUserModelId('com.fellow99.deepseek-harness-desktop');

    // 包操作运行时引导：dsh shim + PATH 注入（供 dsh-market 安装/删除插件；开发/打包均生效）
    setupMarketRuntime();

    // 注册窗口控制薄 IPC（preload 的 window.dsh 调用）
    registerWindowIpcHandlers();

    // 启动 dsh Host（脚手架阶段未接入，返回 null；主进程显示兜底页）
    host = await startHost();

    // 就绪后建窗：loadURL(localhost) 或兜底页
    mainWindow = createMainWindow(host?.url ?? null);

    // 托盘：MVP 独立能力（不依赖 host），始终创建，保证后台驻留与退出通道
    createTray(mainWindow);

    // 通知：依赖 host.ctx
    if (host) {
      setupNotifications(host.ctx);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(host?.url ?? null);
      }
    });
  });

  // ── 4. 生命周期 ───────────────────────────────────────────
  // 关窗即退出：所有窗口关闭后退出（触发 before-quit 优雅关闭后端）
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', (event) => {
    if (isQuitting) return; // 二次 quit 放行（优雅关闭完成后的真正退出）
    event.preventDefault();
    isQuitting = true;
    // 优雅关闭：dispose dsh 插件树（ProcessShutdown.shutdown），完成后退出
    void Promise.resolve(host?.shutdown()).finally(() => {
      destroyTray();
      app.quit();
    });
  });
}
