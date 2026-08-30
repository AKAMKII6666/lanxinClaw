# OpenClaw 状态研究记录

> 研究日期：2026-08-29  
> 本地基线：`vendor/openclaw/package.json` 中 `openclaw@2026.7.1-2`  
> 线上对照：`https://docs.openclaw.ai`，以 2026-08-29 抓取结果为准  
> 用途：支撑 Lanxin job 状态映射、张老板失败回报、控制面板状态展示。

本文记录事实，不直接规定产品需求。状态迁移约束以共同维护设计文档为准。

## 1. 总结

OpenClaw 没有一套可以直接等同于 Lanxin job 的单一任务状态。它至少有五层事实：

| 层 | 对象 | 主要用途 | 结论 |
|----|------|----------|------|
| Agent run | `runId` | 一次 agent 执行 | `agent.wait` 只给粗状态，不能独立证明业务完成 |
| Agent event | `runId` + `seq` | 实时进度、工具流、生命周期 | 需要长连接订阅，按 run 序号去重 |
| Task ledger | `taskId` + `runId?` | 后台任务账本 | 不是每个 run 都有 task，只能补充 |
| Audit ledger | `runId` / `toolCallId` | 结构化失败、阻塞、超时证据 | 最适合做失败/阻塞判定证据 |
| Transcript/history | `sessionKey` | 用户可读最终回复 | 适合回报摘要，不适合单独推进成功态 |

因此澜星适配器不能把 `agent.wait.status = "ok"` 直接映射为 `job.completed`。`ok` 只证明 OpenClaw agent loop 正常结束；如果工具被策略阻止但模型给了文字解释，run 仍可能是 `ok`。

## 2. Agent run

创建入口：

- Gateway RPC：`agent`
- 推荐外部接入：Gateway WebSocket RPC；线上文档也提供 `@openclaw/gateway-client` 和 `@openclaw/gateway-protocol` 作为参考包，但本仓当前仍以 raw WebSocket transport 为准。
- 必要能力：`operator.write` 用于创建 run，`operator.read` 用于读取和接收事件。
- 幂等键：`idempotencyKey`。本仓现用 `lanxing-job:<jobId>`，方向正确。

创建返回：

- `runId`
- 可能返回 `status: "accepted"` 或 `status: "in_flight"`。
- `in_flight` 表示同一个幂等键已有活动 run，不应创建第二个 Lanxin job。

等待入口：

- Gateway RPC：`agent.wait`
- 参数：`runId`，可选 `timeoutMs`
- 返回粗状态：`ok`、`error`、`timeout`
- 官方说明：`agent.wait` 等的是 lifecycle end/error，并且 wait timeout 不会停止底层 run。

本地源码里还有内部 terminal reason：

| 内部 reason | 对外 wait status | 含义 |
|-------------|------------------|------|
| `completed` | `ok` | agent loop 正常结束 |
| `blocked` | `error` | liveness 被标记阻塞 |
| `aborted` | `error` | run 被 abort |
| `cancelled` | `error` | RPC/stop 等取消 |
| `abandoned` | `error` | run 未产生可用结果 |
| `timed_out` | `timeout` | timeout 状态 |
| `hard_timeout` | `timeout` | provider/preflight/post-turn 硬超时 |
| `failed` | `error` | 普通错误 |

源码依据：

- `vendor/openclaw/dist/agent-run-terminal-outcome-Dv8Iorx2.js`：`buildAgentRunTerminalOutcome` 把内部 reason 映射为 `ok/error/timeout`。
- `vendor/openclaw/dist/agent-D6kiZtPt.js`：`agent.wait` 等待 lifecycle/dedupe 快照，未拿到终态时也会返回 `status: "timeout"`。

设计影响：

- `agent.wait timeout` 有两种语义：等待窗口超时，或 run 已经以超时方式终结。
- 仅当存在 `endedAt`、明确 terminal timeout 归因、或 audit/task 证据时，才把它当终态超时。
- `ok` 不是业务成功，只能作为“OpenClaw 已给出最终回复”的证据之一。

## 3. Agent event

Agent event 结构：

- `runId`
- `seq`
- `stream`
- `ts`
- `data`

主要 stream：

| stream | 内容 | 用途 |
|--------|------|------|
| `lifecycle` | `phase: start/end/error` | 判断 run 开始和结束 |
| `assistant` | 模型输出增量 | 形成可听/可展示进度摘要 |
| `tool` | 工具开始、进度、结果、错误 | 判断工具是否失败、阻塞、超时 |

线上 Gateway client 文档明确：`tool-events` 是 client capability，不是权限。没有声明 `tool-events` 时，连接不会收到结构化工具事件，也不会报错。

设计影响：

- Lanxin companion 需要长连接 observer，握手声明 `caps: ["tool-events"]`。
- 每个 run 单独维护最高 `seq`，重复或倒退事件忽略。
- 发现 `seq` 缺口时，应重新读 `chat.history` 和 audit ledger，而不是根据缺失片段推进终态。

## 4. Task ledger

Task 是 OpenClaw 的后台活动账本，不是所有 run 的统一外壳。

会创建 task 的来源：

| 来源 | runtime | 默认通知 |
|------|---------|----------|
| ACP background run | `acp` | `done_only` |
| Subagent orchestration | `subagent` | `done_only` |
| Automation/Cron job | `cron` | `silent` |
| Gateway 派发的 CLI agent | `cli` | `silent` |
| Agent 媒体任务 | `cli` | `silent` |

不会总是创建 task：

- 普通 interactive chat run 不保证有 task。
- heartbeat run 不创建 task。

内部持久化状态：

| 内部状态 | 含义 |
|----------|------|
| `queued` | 已建账，等待开始 |
| `running` | 正在执行 |
| `succeeded` | 执行成功 |
| `failed` | 执行错误 |
| `timed_out` | 执行超时 |
| `cancelled` | 操作者取消或 run abort |
| `lost` | 运行时失去权威 backing state 超过宽限期 |

内部还存在 `terminalOutcome`：

- `succeeded`
- `blocked`

这说明“执行成功”和“结果交付成功”是两件事。线上 CLI 文档说明，`--status blocked` 可以查“执行完成但完成结果交付阻塞”的任务；这些 task 存储状态仍是 `succeeded`，JSON 保留 `terminalOutcome: "blocked"`。

Gateway RPC `TaskSummary.status` 与内部状态不同：

| 内部状态 | RPC 摘要状态 |
|----------|--------------|
| `queued` | `queued` |
| `running` | `running` |
| `succeeded` | `completed` |
| `failed` | `failed` |
| `timed_out` | `timed_out` |
| `cancelled` | `cancelled` |
| `lost` | `failed` |

源码依据：

- `vendor/openclaw/dist/task-registry.store-CssXnO54.js`：内部 `TASK_STATUSES`。
- `vendor/openclaw/dist/task-summary-CnT4L5A1.js`：`succeeded -> completed`，`lost -> failed`。

设计影响：

- RPC `tasks.list/get` 不能作为唯一真源。
- 若只能看到 RPC `failed`，无法确定它是内部 `failed` 还是 `lost`，需要 audit 或 CLI/内部诊断补证。
- 对 Lanxin 来说，`task.completed` 也仍然只是 worker/task 完成，不等于 affair closed。

## 5. Task Flow

OpenClaw 还有 Task Flow 层，用于编排多个后台 task。

线上文档列出的 flow 状态：

- `queued`
- `running`
- `waiting`
- `blocked`
- `succeeded`
- `failed`
- `cancelled`
- `lost`

本阶段 Lanxin 不直接使用 Task Flow 作为事务真源。它可作为未来多步骤任务编排参考，但 v1 应优先把 Lanxin affair/job 状态机做稳。

## 6. Audit ledger

旧兼容 RPC：

- `audit.list`
- 返回 agent run 和 tool action 记录。

新推荐 RPC：

- `audit.activity.list`
- 当 Gateway 在 `hello-ok.features.methods` 中广告该方法时优先使用。
- 支持更多 activity，包括 inbound/outbound message metadata。

兼容规则：

- 新客户端先检查 `hello-ok.features.methods`。
- 广告 `audit.activity.list` 时使用它。
- 未广告时使用 `audit.list`。
- 旧 Gateway 对 `audit.activity.list` 可能返回 unknown method，也可能因为授权先于方法查询而返回 `missing scope: operator.admin`。仅在方法未广告时把后者视为方法缺失。

Audit 状态：

- `started`
- `succeeded`
- `failed`
- `cancelled`
- `timed_out`
- `blocked`
- `unknown`

错误码：

- `run_failed`
- `run_cancelled`
- `run_timed_out`
- `run_blocked`
- `tool_failed`
- `tool_cancelled`
- `tool_timed_out`
- `tool_blocked`
- `tool_outcome_unknown`

隐私边界：

- `redaction: "metadata_only"`
- 不存 prompt、message body、tool args、tool result、command output、raw error text。
- `sessionKey` 仍可含平台账号或会话标识，进入 Lanxin timeline 前要按本仓脱敏规则处理。

设计影响：

- Audit 是判断 `blocked/failed/timed_out/cancelled` 的强证据。
- Audit 不是合规级完整审计。线上文档明确，队列饱和、持久化失败、异常 shutdown 可能丢失 best-effort evidence。缺 audit 不能证明没有失败。

## 7. Chat history 与 final reply

相关入口：

- `chat.history`
- `chat.message.get`
- live `session.message` events

用途：

- 获取 OpenClaw 最终给用户的自然语言解释。
- 用于张老板可说的话和控制面板摘要。
- 在 event 缺口、重连、adapter 进程重启后重建显示态。

限制：

- `chat.history` 是 display-normalized 投影，可能截断或省略超大消息。
- final reply 是自然语言，不是结构化状态证据。
- “模型说已经做完了”不能单独推进 `job.completed`。
- “模型说不能做”可以作为弱阻塞证据，用于避免假成功，并提示需要 audit/tool 进一步补证。

## 8. Tool action 与失败分类

源码里工具结果失败类型：

- `blocked`
- `cancelled`
- `failed`
- `timed_out`

OpenClaw 工具 hook 和 policy 能产生：

- policy block
- approval wait/cancel
- hook failure
- tool execution error
- timeout
- result blocked

设计影响：

- tool/audit 的 `blocked` 优先映射为 Lanxin `job.blocked`。
- tool timeout 或 runtime timeout 映射为 Lanxin `job.failed`，并保留 `resumeCondition=retry_or_reduce_scope` 这类恢复建议。
- policy block、缺权限、缺工具能力、需要用户换方案，映射为 Lanxin `job.blocked`。

## 9. 本仓现状差距

当前 adapter 事实：

- `packages/openclaw-adapter/src/client/gateway/raw-ws/transport.ts` 已能通过 raw WS 调 `agent`、`agent.wait`、`chat.abort`。
- 状态别名里没有 `ok -> completed`。
- `timeout -> running` 的注释只覆盖 wait-only timeout，不能覆盖 run terminal timeout。
- 缺长连接事件订阅。
- 缺 `tool-events` capability。
- 缺 audit/task/history 探针。
- `OpenClawRunSnapshot` 只有 `status/summary/blockedReason/resumeCondition`，无法携带证据来源和 confidence。

这解释了最近的问题：OpenClaw 可以正常返回“浏览器受策略限制”的文字，但 Lanxin 侧既可能看不见结构化失败，也可能把 wait timeout 当 running，导致界面和张老板无法稳定回报。

## 10. 参考资料

官方资料：

- Gateway protocol：`https://docs.openclaw.ai/gateway/protocol`
- Building a Gateway client：`https://docs.openclaw.ai/gateway/clients`
- Embedding OpenClaw：`https://docs.openclaw.ai/gateway/embedding`
- Agent loop：`https://docs.openclaw.ai/concepts/agent-loop`
- Background tasks：`https://docs.openclaw.ai/automation/tasks`
- CLI tasks：`https://docs.openclaw.ai/cli/tasks`
- Audit history：`https://docs.openclaw.ai/gateway/audit`

本地源码：

- `vendor/openclaw/package.json`
- `vendor/openclaw/dist/agent-D6kiZtPt.js`
- `vendor/openclaw/dist/agent-run-terminal-outcome-Dv8Iorx2.js`
- `vendor/openclaw/dist/task-registry.store-CssXnO54.js`
- `vendor/openclaw/dist/task-summary-CnT4L5A1.js`
- `vendor/openclaw/dist/schema-DtyqV_v0.d.ts`

说明：

- 未采用社区帖子作为状态真源。状态和协议以官方文档、本地 vendored 源码和实机样本为准。
