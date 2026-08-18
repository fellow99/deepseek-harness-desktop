import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // dsh 部署产物（dsh-dist/）打进 out/resources/dsh-dist（asar 外，供 host.ts 的
    // ESM 动态 import；含 dsh lib + node_modules + web dist + desktop profile）。
    // 注：@electron/packager 18.x 的 extraResource 仅支持字符串（复制到 resources/<basename>）。
    extraResource: ['dsh-dist'],
  },
  rebuildConfig: {},
  makers: [
    // Windows：Squirrel 安装器（Electron Forge 无官方 NSIS maker）
    new MakerSquirrel({
      // 不签名（本地打包自用）；authors/description 默认取自 package.json
    }),
    // 目录包（免安装，本地自用/调试）
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
    // Linux：deb / rpm（maker-rpm 需单独安装，已在 devDependencies 中）
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // 主进程 / preload 入口（路径可自定义，匹配 src/main、src/preload 布局）
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Electron Fuses：关闭危险能力（RunAsNode 等）
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
