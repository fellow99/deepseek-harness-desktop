import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { installFullscreenShortcut, loadWindowState, trackWindowState } from './window-state';

/**
 * 浏览器窗口创建 + 安全加固。
 * 参考 opencode desktop：packages/desktop/src/main/windows.ts。
 *
 * 安全基线（产品概念设计第 6.1 节「采用」项）：
 * - sandbox:true + contextIsolation:true + nodeIntegration:false
 * - 常规 Windows 标题栏（frame:true，系统原生 min/max/close）
 * - 导航加固 + 权限白名单（clipboard-sanitized-write + notifications）
 */

/** 权限白名单：仅安全剪贴板写入 + 通知 */
const RENDERER_PERMISSIONS = new Set(['clipboard-sanitized-write', 'notifications']);

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

/**
 * 创建主窗口。
 * @param url dsh Host 的 localhost URL；为 null 时加载兜底页（host 未接入）
 */
export function createMainWindow(url: string | null): BrowserWindow {
  // 窗口图标：开发态取工程根 resources/，打包态取 process.resourcesPath（与 runtime.ts 一致）
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../resources/icon.png');
  // 恢复上次窗口状态（位置/尺寸/最大化）；无历史或边界不可见则退默认尺寸
  const savedState = loadWindowState();
  const win = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    ...(savedState.x !== undefined && savedState.y !== undefined
      ? { x: savedState.x, y: savedState.y }
      : {}),
    minWidth: 800,
    minHeight: 600,
    show: false,
    icon: iconPath,
    // 常规 Windows 标题栏：原生 frame（含系统 min/max/close），不再自绘无边框窗口
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 窗口状态持久化 + F11 全屏切换
  trackWindowState(win);
  installFullscreenShortcut(win);

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

  // 关窗即退出：放行 close，由 window-all-closed 触发 app.quit 优雅关闭（含后端 shutdown）

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

  win.once('ready-to-show', () => {
    if (savedState.isMaximized) win.maximize();
    win.show();
  });
  return win;
}
