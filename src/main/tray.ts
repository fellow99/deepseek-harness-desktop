import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import path from 'node:path';

/**
 * 系统托盘 + 后台驻留（产品概念设计第 13 节「系统托盘 + 后台驻留」）。
 * 关窗 = 隐藏到托盘（由 windows.ts 的 close 事件处理），真正退出走托盘菜单「退出」。
 */

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow): Tray {
  // 托盘图标：开发态取工程根 resources/，打包态取 process.resourcesPath（与 windows.ts 一致）
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray.png')
    : path.join(__dirname, '../../resources/tray.png');
  let icon = nativeImage.createFromPath(trayIconPath);
  if (icon.isEmpty()) {
    console.warn(`[dsh-desktop] 托盘图标加载失败，回退为空图标: ${trayIconPath}`);
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);

  const showWindow = (): void => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  tray.setToolTip('DSH Desktop');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: showWindow },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showWindow);
  return tray;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
