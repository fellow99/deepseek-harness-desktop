import { defineConfig } from 'vite';

// 渲染进程 Vite 配置。
//
// 本工程渲染进程极薄：生产环境主进程直接 loadURL(http://127.0.0.1:<port>)
// 同源加载 dsh Web UI，渲染进程自带内容仅作「host 就绪前/失败时」的兜底加载页。
// 因此 renderer 产物几乎不参与运行时，这里保持最小配置。
export default defineConfig({});
