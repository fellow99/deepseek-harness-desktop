import { BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import path from 'node:path';

/**
 * 浏览器窗口创建 + 安全加固 + 无边框自绘标题栏。
 * 参考 opencode desktop：packages/desktop/src/main/windows.ts。
 *
 * 安全基线（产品概念设计第 6.1 节「采用」项）：
 * - sandbox:true + contextIsolation:true + nodeIntegration:false
 * - 无边框 + titleBarOverlay（win32）
 * - 导航加固 + 权限白名单（clipboard-sanitized-write + notifications）
 */

/** 权限白名单：仅安全剪贴板写入 + 通知 */
const RENDERER_PERMISSIONS = new Set(['clipboard-sanitized-write', 'notifications']);

let quitting = false;

/** 标记「真正退出」：放行窗口 close（区别于「关窗隐藏到托盘」） */
export function setQuitting(value: boolean): void {
  quitting = value;
}

/** 受信导航/权限来源：仅 localhost（dsh webserver）或 vite dev server */
function isTrustedOrigin(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const isLoopbackHttp =
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    let isDevServer = false;
    if (
      typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' &&
      MAIN_WINDOW_VITE_DEV_SERVER_URL.length > 0
    ) {
      // 用 origin 精确比对，避免前缀匹配绕过（如 localhost:5173.evil.com）
      isDevServer = url.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    }
    return isLoopbackHttp || isDevServer;
  } catch {
    return false;
  }
}

/** 仅允许 http/https 交给系统浏览器（拦截 javascript:/data:/file: 等危险 scheme） */
function isExternalUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** 注册窗口控制薄 IPC（min/max/close，供 preload 的 window.dsh 调用） */
export function registerWindowIpcHandlers(): void {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
}

/**
 * 创建主窗口。
 * @param url dsh Host 的 localhost URL；为 null 时加载兜底页（host 未接入）
 */
export function createMainWindow(url: string | null): BrowserWindow {
  const isWindows = process.platform === 'win32';
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    // 无边框 + 自绘标题栏（win32 用 titleBarOverlay，全透明让渲染层自绘背景）
    ...(isWindows
      ? {
          frame: false,
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#00000000',
            symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
            height: 40,
          },
        }
      : { titleBarStyle: 'hidden' as const }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 导航加固：仅允许应用自身 URL 原地导航，外部 http/https URL 交系统浏览器
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!isTrustedOrigin(target) && isExternalUrl(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (isTrustedOrigin(target)) return;
    event.preventDefault();
    if (isExternalUrl(target)) shell.openExternal(target);
  });

  // 权限白名单（受信来源 + 白名单权限 + 对应 webContents）
  const webContentsId = win.webContents.id;
  win.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(
      RENDERER_PERMISSIONS.has(permission) &&
        isTrustedOrigin(details.requestingUrl) &&
        wc.id === webContentsId,
    );
  });

  // 后台驻留：非退出状态下关窗 = 隐藏到托盘（产品概念设计第 13 节）
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.webContents.on('did-fail-load', (_event, code, desc, failedUrl) => {
    console.error(`[dsh-desktop] failed to load ${failedUrl}: ${code} ${desc}`);
  });

  // 加载：dsh localhost（host 就绪）或兜底页（host 未接入）
  if (url) {
    void win.loadURL(url);
  } else if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  win.once('ready-to-show', () => win.show());
  return win;
}
