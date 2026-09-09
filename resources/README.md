# resources

应用图标与托盘图标目录。

## 已提供

- `icon.ico` —— Windows 打包图标（供 `forge.config.ts` 的 `packagerConfig.icon` 与 `MakerSquirrel` 的 `setupIcon` 引用）
- `icon.icns` —— macOS 打包图标（供 `packagerConfig.icon` 引用）
- `icon.png` —— 通用 / 窗口图标（供 `src/main/windows.ts` 的 `BrowserWindow.icon` 与 `index.html` 的 favicon 引用）
- `tray.png` —— 系统托盘图标（供 `src/main/tray.ts` 的 `createTray` 引用）

@electron/packager 的 `icon` 约定：传无扩展名路径 `resources/icon`，打包时按平台自动补
`.ico`（win32）/ `.icns`（darwin）/ `.png`（linux）。
