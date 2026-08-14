import { Notification } from 'electron';
import type { HostContext } from './host';

/**
 * 原生通知：订阅 dsh Host 的 ctx 事件 → Electron Notification。
 * 产品概念设计第 13 节「原生通知」。
 *
 * 订阅事件（源码级核实 2026-08-14，deepseek-harness）：
 * - ctx.on('session/event', (session, event))：
 *     · event.type === 'turn/end' —— turn 完成，event.reason.kind ∈
 *       completed|aborted|blocked|error|max-tokens|interrupted
 *       （packages/core/session/src/types.ts:252, 155-174）
 *     · event.type === 'approval/asked' —— 审批请求（dsh-user-approval 插件增广，
 *       event.data = { id, toolName, callId?, reason? }）
 *       （packages/interaction/user-approval/src/index.ts:44-49）
 * - ctx.on('agent/status', ({ agent, status }))：status ∈ 'idle' | 'running'
 * - ctx.on('agent/error', ({ agent, turn, step, error }))
 * - question 通知：host ctx 层无事件，唯一来源是 apiProxy.events.mux 流的
 *   question/requested 帧（packages/host/apiproxy/src/api/events.ts:74）
 */

/** SessionEvent 最小结构（脚手架占位；消费 dsh 后替换为真实类型） */
interface SessionEventLike {
  type: string;
  reason?: { kind?: string };
  data?: { id?: string; toolName?: string; reason?: string };
}

export function setupNotifications(ctx: HostContext): void {
  ctx.on('session/event', (_session, event) => {
    const e = event as SessionEventLike;
    switch (e.type) {
      case 'turn/end': {
        // turn 完成通知：仅对 completed / error 弹通知，其余静默
        const kind = e.reason?.kind;
        if (kind === 'completed') {
          new Notification({
            title: 'DeepSeek Harness',
            body: 'Agent 已完成本轮任务',
          }).show();
        } else if (kind === 'error') {
          new Notification({
            title: 'DeepSeek Harness',
            body: 'Agent 执行出错',
          }).show();
        }
        break;
      }
      case 'approval/asked': {
        // 审批请求通知（点击唤起窗口：后续实现）
        new Notification({
          title: 'DeepSeek Harness — 需要审批',
          body: e.data?.toolName
            ? `工具「${e.data.toolName}」请求执行`
            : '有操作需要你的确认',
        }).show();
        break;
      }
      default:
        break;
    }
  });

  ctx.on('agent/error', (_agent, _error) => {
    new Notification({
      title: 'DeepSeek Harness — Agent 错误',
      body: 'Agent 运行出错，请查看应用详情',
    }).show();
  });
}
