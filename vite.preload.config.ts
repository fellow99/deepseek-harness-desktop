import { defineConfig } from 'vite';

// preload Vite 配置（薄 IPC：contextBridge 暴露 window.dsh）。
//
// 入口 src/preload/index.ts 的 basename 为 index，插件默认 entryFileNames
// '[name].js' 会输出 index.js（且与 main 的输出冲突），而 windows.ts 引用
// 的是 preload.js，故此处显式指定输出文件名为 preload.js。
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'preload.js',
      },
    },
  },
});
