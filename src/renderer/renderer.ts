// 渲染进程极薄入口。
// 本工程生产环境由主进程 loadURL(localhost) 同源加载 dsh Web UI，
// 此 renderer 仅作「host 就绪前 / 失败时」的兜底加载页，几乎无逻辑。
console.log('[dsh-desktop] renderer fallback loaded');
