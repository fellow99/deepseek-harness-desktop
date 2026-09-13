/**
 * 预加载脚本。
 *
 * 本工程窗口已改为常规 Windows 标题栏（frame:true），最小化/最大化/关闭由系统原生提供，
 * 不再经 contextBridge 暴露 window.dsh 之类的自定义窗口控制。
 * 保留此入口文件以维持 forge/vite 的 preload 构建配置（无副作用）。
 */
export {};
