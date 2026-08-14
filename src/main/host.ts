/**
 * dsh Host 宿主：在主进程内 runProfile('desktop') 挂起 dsh Host（含 webserver），
 * 渲染进程同源加载 localhost（产品概念设计第 7、9 节）。
 *
 * 参考（源码级核实，2026-08-14）：
 * - runProfile：deepseek-harness/apps/cli/src/profile-boot.ts:207
 *   `runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }>`
 * - RunProfileOptions：`{ environment, profile, patchFiles, args }`（profile-boot.ts:174-183）
 * - webserver：`ctx.webServer.port` —— config.port 传 0 时返回 OS 分配端口
 *   （deepseek-harness/packages/host/webserver/src/index.ts:78-81）
 * - 调用示例：apps/cli/src/bin.ts:31-38（environment 用 loadLayeredEnv('dsh')）
 */

/** dsh Cordis Context 的最小接口（脚手架占位；消费 dsh 后替换为真实类型） */
export interface HostContext {
  webServer: { port: number };
  /** 订阅 host 事件（cordis ctx.on），供托盘/通知用 */
  on(event: string, listener: (...args: unknown[]) => void): void;
}

/** dsh Host 句柄 */
export interface HostHandle {
  ctx: HostContext;
  /** 优雅关闭：dispose 插件树（ProcessShutdown.shutdown） */
  shutdown: (code?: number) => Promise<void> | void;
  /** webserver 实际绑定端口（--port 0 → OS 分配） */
  port: number;
  /** 同源加载 URL：http://127.0.0.1:<port>/ */
  url: string;
}

/**
 * 启动 dsh Host（desktop profile，进程内，MVP）。
 *
 * TODO(消费 dsh)：接入 deepseek-harness 源码引用（产品概念设计第 8、11、12 节）：
 *   1. 构建 ../deepseek-harness（pnpm install + build:lib:host + build:web）
 *   2. 使用 profiles/desktop（dsh.profile.bundles = [dsh-base, dsh-web-app]，
 *      cordis.patch.yml 已覆盖 web-runtime.printUrl: false）
 *   3. 调用（参考 apps/cli/src/bin.ts:31-38）：
 *        const { runProfile } = await import('deepseek-harness/apps/cli/src/profile-boot');
 *        const { ctx, shutdown } = await runProfile({
 *          environment: loadLayeredEnv('dsh'),
 *          profile: 'desktop',
 *          patchFiles: [],
 *          args: ['--port', '0'],
 *        });
 *        const port = ctx.webServer.port;
 *        return { ctx, shutdown: (c) => shutdown.shutdown(c ?? 0), port,
 *                 url: `http://127.0.0.1:${port}/` };
 *   4. 在 vite.main.config.ts 把 dsh 依赖（@deepseek-ai/*、cordis）标 external
 *
 * 脚手架阶段 dsh 尚未接入，返回 null；主进程据此显示兜底页，不阻塞 Electron 启动。
 */
export async function startHost(): Promise<HostHandle | null> {
  return null;
}
