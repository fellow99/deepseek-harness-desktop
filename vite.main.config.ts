import { defineConfig } from 'vite';

// 主进程 Vite 配置。
//
// 入口 src/main/index.ts 的 basename 为 index，Forge Vite 插件默认
// `fileName: () => '[name].js'` 会输出 index.js（而非 package.json 的 main
// 字段指向的 main.js），故此处显式指定输出文件名为 main.js。
//
// TODO(消费 dsh)：接入 deepseek-harness 源码引用后，需在此把 dsh 依赖
// 标记为 external（否则会被打进 bundle，导致 __dirname / 原生模块行为异常）：
//   build: {
//     rollupOptions: {
//       external: [/^@deepseek-ai\//, /^cordis/],
//     },
//   }
// 参考：https://www.electronforge.io/config/plugins/vite#native-node-modules
export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
  },
});
