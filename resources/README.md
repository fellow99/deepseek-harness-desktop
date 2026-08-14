# resources

应用图标与托盘图标的占位目录。

产品概念设计第 12 节规划：`resources/` 存放应用图标、托盘图标。

## 待补充

- `icon.png` / `icon.ico` —— Electron 应用图标（Windows 打包用，供 packagerConfig.icon 引用）
- `tray.png` —— 系统托盘图标（供 src/main/tray.ts 的 createTray 引用）

脚手架阶段未提供真实图标，`tray.ts` 目前用 `nativeImage.createEmpty()` 占位；
Electron Forge 打包时使用默认图标。后续补齐图标后在此说明并更新引用。
