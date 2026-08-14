import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';

/**
 * 系统托盘 + 后台驻留（产品概念设计第 13 节「系统托盘 + 后台驻留」）。
 * 关窗 = 隐藏到托盘（由 windows.ts 的 close 事件处理），真正退出走托盘菜单「退出」。
 */

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow): Tray {
  // TODO(资源)：使用 resources/ 下的真实托盘图标；脚手架阶段用空图标占位
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const showWindow = (): void => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  tray.setToolTip('DeepSeek Harness Desktop');
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
