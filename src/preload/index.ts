import { contextBridge, ipcRenderer } from 'electron';

/**
 * contextBridge：暴露 window.dsh（薄 IPC）。
 * 产品概念设计第 9 节：数据面（HTTP + WebSocket）不过 IPC，
 * 仅窗口控制（min/max/close）等壳层关注点走薄 IPC。
 *
 * 注意：此 preload 对「所有」该窗口加载的页面生效，包括 loadURL 到
 * localhost 的 dsh Web UI——dsh UI 可经 window.dsh 控制无边框窗口。
 */

const api = {
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
};

contextBridge.exposeInMainWorld('dsh', api);

export type DshApi = typeof api;
