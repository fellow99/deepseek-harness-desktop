import { app, BrowserWindow, screen } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 主窗口状态持久化 + F11 全屏切换。
 *
 * 状态写入 `$userData/window-state.json`：记录最大化 / 普通，以及普通状态下的位置与尺寸
 * （经 `BrowserWindow.getNormalBounds()` 获取，最大化时也能拿到还原后的边界）。
 * 恢复时校验边界是否仍落在某个显示器工作区内，避免显示器变更后窗口落在屏幕外。
 */

/** 持久化的窗口状态。 */
interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

/** 无历史状态时的默认窗口尺寸。 */
const DEFAULT_STATE: WindowState = { width: 1200, height: 800, isMaximized: false };

function stateFilePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

/** 边界是否与任一显示器工作区相交（相交即可见）。 */
function isVisibleOnSomeDisplay(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapX = Math.max(
      0,
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x),
    );
    const overlapY = Math.max(
      0,
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y),
    );
    return overlapX > 0 && overlapY > 0;
  });
}

/** 读取上次保存的窗口状态；缺失或损坏时回退默认值。 */
export function loadWindowState(): WindowState {
  try {
    const raw = JSON.parse(readFileSync(stateFilePath(), 'utf8')) as Partial<WindowState>;
    const width =
      typeof raw.width === 'number' && raw.width > 0 ? raw.width : DEFAULT_STATE.width;
    const height =
      typeof raw.height === 'number' && raw.height > 0 ? raw.height : DEFAULT_STATE.height;
    const state: WindowState = { width, height, isMaximized: raw.isMaximized === true };
    if (
      typeof raw.x === 'number' &&
      typeof raw.y === 'number' &&
      isVisibleOnSomeDisplay({ x: raw.x, y: raw.y, width, height })
    ) {
      state.x = raw.x;
      state.y = raw.y;
    }
    return state;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized(),
  };
  try {
    mkdirSync(path.dirname(stateFilePath()), { recursive: true });
    writeFileSync(stateFilePath(), JSON.stringify(state), 'utf8');
  } catch (err) {
    console.error('[dsh-desktop] 保存窗口状态失败:', err);
  }
}

/** 监听窗口位置/尺寸/最大化变化并防抖落盘，关闭前同步保存一次。 */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSave = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    saveWindowState(win);
  });
}

/** 注册 F11 切换全屏（拦截按键，避免下发到页面）。 */
export function installFullscreenShortcut(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.code === 'F11' || input.key === 'F11')) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
}
