# overall-data-model.md — 数据模型

> deepseek-harness-desktop 全局数据实体与状态定义（2026-08-14）。
> 本项目为桌面壳，数据面在 dsh 侧（session/消息/文件等），此处仅记录桌面壳自身的实体与状态。

## 1. 实体清单

### 1.1 HostHandle（宿主句柄）

主进程持有的 dsh Host 句柄（`src/main/host.ts`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `ctx` | HostContext | dsh Cordis Context（含 `webServer.port`、事件订阅 `on`） |
| `shutdown` | `(code?) => Promise<void> \| void` | 优雅关闭（dispose 插件树） |
| `port` | `number` | webserver 实际绑定端口（`--port 0` → OS 分配） |
| `url` | `string` | 同源加载 URL：`http://127.0.0.1:<port>/` |

### 1.2 HostContext（宿主上下文，最小接口）

| 字段 | 类型 | 说明 |
|---|---|---|
| `webServer` | `{ port: number }` | webserver 端口 |
| `on` | `(event, listener) => void` | 订阅 host 事件（cordis ctx.on） |

> 脚手架占位为最小接口；消费 dsh 后替换为 `@deepseek-ai/dsh-*` 真实 Context 类型。

### 1.3 SessionEventLike（会话事件，最小结构）

通知模块订阅的 `session/event` 载荷（`src/main/notifications.ts`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | `string` | 事件类型（`turn/end`、`approval/asked` 等） |
| `reason` | `{ kind?: string }` | turn 结束原因（completed/aborted/blocked/error/max-tokens/interrupted） |
| `data` | `{ id?; toolName?; reason? }` | approval 请求数据 |

### 1.4 DesktopProfile（desktop profile 配置）

| 字段 | 值 | 说明 |
|---|---|---|
| `dsh.profile.bundles` | `[dsh-base, dsh-web-app]` | 复用 web 组合 |
| `cordis.patch.yml` | 覆盖 `web-runtime.printUrl: false` | 关闭 URL 打印 |

## 2. 状态机

### 2.1 窗口生命周期

```
created → (loadURL localhost / 兜底页) → ready-to-show → shown
                                          ↓
                        close → closed → window-all-closed → app.quit（关窗即退出）
```

### 2.2 Host 启动状态

```
startHost() → null（脚手架：未接入 dsh）
            → HostHandle（已就绪：port/url 可用）→ shutdown() → disposed
```

## 3. 事件流（桌面壳订阅）

| 事件 | 来源 | 触发通知 |
|---|---|---|
| `session/event` type=`turn/end`（reason.kind=completed/error） | dsh session core | turn 完成/出错 |
| `session/event` type=`approval/asked` | dsh-user-approval | 审批请求 |
| `agent/error` | dsh agent core | agent 出错 |

> question 通知：host ctx 层无事件，唯一来源是 `apiProxy.events.mux` 流的 `question/requested` 帧（后续如需再接入）。

## 4. 数据边界

- **桌面壳数据**：仅上述少量实体（句柄、状态标志、事件载荷最小结构）。
- **业务数据**（session/消息/文件/工具调用等）：完全在 dsh 侧，桌面壳不持有、不缓存。
