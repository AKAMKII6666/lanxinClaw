# OpenClaw 状态观测与探针

> 适用范围：companion 与 `packages/openclaw-adapter` 观测 OpenClaw Gateway 状态。  
> 原则来源：[携证状态转移原则.md](携证状态转移原则.md)。  
> 事实来源：[../../智能体维护/OpenClaw状态研究记录.md](../../智能体维护/OpenClaw状态研究记录.md)。

## 1. 目标

让 Lanxin 在不读取 OpenClaw 私有文件的前提下，获得足够证据回答：

- run 是否被接受、开始、仍在执行、已经终结；
- 工具是否被 policy、权限、能力缺失、超时或错误阻塞；
- OpenClaw 给出的最终自然语言反馈是什么；
- 哪些证据足以推进 Lanxin job 状态，哪些只能展示。

生产实现必须通过 Gateway RPC 和 Gateway event 观测。`~/.openclaw` 下的 SQLite、transcript、cache、runtime log 只可作为人工诊断材料，不可作为稳定接口。

## 2. 连接与能力探针

Gateway 连接成功的应用级证据是 `hello-ok`。

连接流程：

1. 打开 WebSocket。
2. 等待 `connect.challenge`。
3. 发送 `connect`，声明协议版本、role、scopes、caps 和 auth。
4. 收到 `hello-ok` 后，记录 `server.version`、`features.methods`、`features.events`、`auth.scopes`、`policy`。

推荐 scope：

- `operator.read`：读取 run/task/audit/history，接收事件。
- `operator.write`：创建 run、取消 run。
- `operator.approvals`：后续需要接 OpenClaw exec/plugin approval 时再启用。
- 不默认申请 `operator.admin`。

推荐 cap：

- `tool-events`：接收结构化工具事件。

能力检测：

- `audit.activity.list` 在 `hello-ok.features.methods` 中出现时优先用。
- 未出现时 fallback 到 `audit.list`。
- `tasks.list/get/cancel` 也以 `features.methods` 为准。
- `hello-ok.features.methods` 是保守发现清单，不是全部方法枚举；但对新增方法启用策略必须以它为强信号。

## 3. 观测层级

| 层级 | 入口 | 强度 | 用途 |
|------|------|------|------|
| 创建回执 | `agent` | 强 | 证明 run 已被 Gateway 接受或已有 in-flight |
| 实时事件 | `agent` event | 强 | 证明生命周期、工具进度、工具失败 |
| 等待快照 | `agent.wait` | 中 | 证明 run lifecycle 已结束，或等待窗口超时 |
| Audit | `audit.activity.list` / `audit.list` | 强 | 证明 run/tool 结构化结果 |
| Task ledger | `tasks.list/get` | 中 | 补充后台 task 状态，不覆盖 run/audit |
| History | `chat.history` / `chat.message.get` | 弱 | 提供用户可读最终回复 |
| 本地缓存 | adapter job store | 辅助 | 去重、重连恢复、单调防护 |

强度说明：

- 强证据可推进 `blocked/failed/canceled/completed`。
- 中证据需要与其它证据合并后推进终态。
- 弱证据可用于摘要和避免假成功，但不能单独证明成功。

## 4. Run 创建探针

调用 `agent` 时必须记录：

- `jobId`
- `affairId`
- `sessionKey`
- `idempotencyKey`
- `runId`
- `agentId`
- `createdAt`
- `allowedPermissions`
- `workspaceHint`
- `purpose`

返回处理：

| 返回 | Lanxin 初步状态 | 说明 |
|------|-----------------|------|
| `accepted` 或有 `runId` | `running` | run 已进入 OpenClaw 控制面 |
| `in_flight` | 保持当前非终态 | 同幂等键已有 run，不能重建 |
| RPC error | `failed` 或不创建 job | 由 companion 事务门闩决定 |

本仓 v1 可在本地先写 `queued`，只有拿到 OpenClaw 接受证据后才广播 `job.accepted/running`。

## 5. 实时事件探针

长连接 observer 只接收并应用自己能证明归属的事件：

- `payload.runId` 必须等于当前 job 绑定的 `openclawRunId`。
- 若 event 带 `sessionKey`，必须与 job 绑定 `sessionKey` 一致。
- `payload.seq` 必须大于该 run 已处理最高 seq。
- 已终态 job 不被迟到非终态事件覆盖。
- 发现 seq 缺口时，不推进终态，触发 history/audit reconcile。

事件处理：

| event | 处理 |
|-------|------|
| lifecycle start | `running`，更新 `progressSummary` |
| lifecycle end | 进入待判定，不能直接 completed |
| lifecycle error | 结合 `error/stopReason/livenessState` 判 `blocked/failed/canceled` |
| tool start/progress | 更新进度摘要 |
| tool blocked | `blocked` |
| tool failed | 默认 `failed`，若需要用户/配置/权限介入则 `blocked` |
| tool timed_out | `failed`，摘要写 timeout |
| tool cancelled | 用户取消则 `canceled`，否则 `failed` |

## 6. `agent.wait` 探针

`agent.wait` 只能作为 run lifecycle 探针。

结果处理：

| 返回 | 判断 |
|------|------|
| `status: "ok"` | run 正常结束，等待 audit/tool/history 合并后再决定 job |
| `status: "error"` | run 异常，结合 `livenessState/stopReason/error` 判 `blocked/failed/canceled` |
| `status: "timeout"` 且无 `endedAt` | wait-only timeout，保持 `running` |
| `status: "timeout"` 且有 terminal timeout 证据 | `failed`，摘要写超时 |

terminal timeout 证据包括：

- `endedAt` 存在；
- `timeoutPhase` 指向 `preflight/provider/post_turn` 等终止阶段；
- `timeoutPhase: "gateway_draining"` 同时伴随 `endedAt`、lifecycle terminal 或 audit/task terminal timeout；
- audit 记录 `run_timed_out` 或 `tool_timed_out`；
- task ledger 返回 `timed_out`。

`agent.wait` 的 timeout 不会停止底层 run。短轮询只能判断“这次没等到”，不能判断“run 仍然健康”。

## 7. Audit 探针

优先使用 `audit.activity.list`：

- 需要 `operator.read`。
- 支持 run、tool、message activity。
- 返回 `schemaVersion` 和 `redaction: "metadata_only"`。

fallback 使用 `audit.list`：

- 需要 `operator.read`。
- 只覆盖 agent run 和 tool action。

查询策略：

- 先按 `runId` 查最近记录。
- 再按 `sessionKey` 查短窗口补漏。
- 只接收 `occurredAt >= job.createdAt` 的记录。
- 对同一 `toolCallId` 取最高 sequence 的 terminal 记录。

强判定：

| Audit status/errorCode | Lanxin |
|------------------------|--------|
| `blocked` / `run_blocked` / `tool_blocked` | `blocked` |
| `cancelled` / `run_cancelled` / `tool_cancelled` | `canceled` 或 `failed`，看是否用户取消 |
| `timed_out` / `run_timed_out` / `tool_timed_out` | `failed` |
| `failed` / `run_failed` / `tool_failed` | `failed`，若错误需要用户介入则 `blocked` |
| `succeeded` | 只证明对应 run/tool 成功，不单独证明整件事完成 |

## 8. Task ledger 探针

使用范围：

- task 存在时用于补充后台任务状态；
- 不用 task 缺失证明 run 不存在；
- 不用 task completed 单独证明业务完成。

查询策略：

- 若已知 `taskId`，用 `tasks.get`。
- 若只有 `runId`，用 `tasks.list` 按 `sessionKey/agentId` 缩小范围后匹配 `runId`。
- 对 RPC `status: "failed"` 保守处理，因为它可能来自内部 `lost` 映射。

状态处理：

| RPC 状态 | Lanxin |
|----------|--------|
| `queued` | `running` 或本地 `queued`，不广播终态 |
| `running` | `running` |
| `completed` | 需要无失败/阻塞证据才可 `completed` |
| `failed` | `failed`，若疑似 lost 则 `blocked` 并要求重连/重试 |
| `timed_out` | `failed` |
| `cancelled` | `canceled` |

## 9. History 探针

`chat.history` 和 `chat.message.get` 用于取用户可读摘要。

使用规则：

- 根据 `sessionKey` 和 `runId` 过滤最新 assistant 输出。
- 可用于 `progressSummary`、`blockedReason` 的自然语言描述。
- 可用于发现“OpenClaw 明确说无法完成”的弱阻塞。
- 不能单独证明 `job.completed`。
- 文本进入 phone/UI 前必须脱敏，避免泄露路径、token、命令输出中的敏感值。

## 10. 证据对象

后续实现建议新增 adapter 内部对象：

```ts
interface OpenClawExecutionEvidence {
  jobId: string;
  affairId: string;
  runId: string;
  sessionKey: string;
  observedAt: string;
  wait?: {
    status: "ok" | "error" | "timeout" | "pending" | string;
    startedAt?: number;
    endedAt?: number;
    stopReason?: string;
    livenessState?: string;
    timeoutPhase?: string;
    error?: string;
  };
  lifecycle?: {
    startedAt?: number;
    endedAt?: number;
    terminalPhase?: "end" | "error";
    terminalReason?: string;
    highestSeq?: number;
  };
  toolFindings: Array<{
    toolCallId?: string;
    toolName?: string;
    status: "succeeded" | "failed" | "blocked" | "timed_out" | "cancelled" | "unknown";
    errorCode?: string;
    summary?: string;
  }>;
  task?: {
    taskId?: string;
    status?: string;
    terminalOutcome?: string;
    progressSummary?: string;
    terminalSummary?: string;
    error?: string;
  };
  finalReply?: {
    text: string;
    source: "event" | "history" | "wait-result";
    confidence: "weak" | "medium";
  };
}
```

该对象是 adapter 内部证据，不直接进入公开协议。公开协议继续发 `job.progress/job.blocked/job.completed/job.failed/job.canceled`。

## 11. 探针合并顺序

默认合并顺序：

1. 已终态 Lanxin job 优先，拒绝迟到覆盖。
2. 用户取消证据优先，写 `canceled`。
3. audit/tool 阻塞证据写 `blocked`。
4. audit/tool/run terminal 失败写 `failed`。
5. terminal timeout 写 `failed`。
6. run `ok` 且无负证据，再结合 final reply 判定是否 `completed` 或 `blocked`。
7. 没有终态证据时保持 `running`。

成功态门闩：

- 必须是当前 job 的 run；
- run 已有 lifecycle terminal；
- 未发现阻塞/失败/取消证据；
- final reply 没有明确“无法完成、受限制、需要用户提供信息”的负向语义；
- job 仍处于可推进状态。

## 12. 反例样本目录

后续实机采样按下表记录。研究阶段已从源码和官方文档确认每类状态存在，实机联调时补充真实 payload。

| 样本 | 预期强证据 | 期望 Lanxin |
|------|------------|-------------|
| 正常完成 | lifecycle end + no failed tool + final reply | `completed` |
| policy blocked | audit/tool `blocked` 或 errorCode `tool_blocked` | `blocked` |
| 工具执行失败 | audit/tool `failed` | `failed` |
| 工具超时 | audit/tool `timed_out` | `failed` |
| 模型正常但目标未完成 | wait `ok` + final reply negative | `blocked` |
| wait-only timeout | wait `timeout` 无终态证据 | `running` |
| 运行终态超时 | wait/task/audit 证明运行已超时终止 | `failed` |
| 用户取消 | local cancel intent + abort ack | `canceled` |
| Gateway 断连重连 | reconnect + history/audit/task reconcile | 不凭断线推进终态 |

## 13. 维护规则

- OpenClaw 升级时先更新状态研究记录，再更新映射。
- 新增 RPC 或字段必须说明 owner、方向、认证要求、兼容策略。
- 任何状态推进必须携带 `jobId/runId/sessionKey` 关联证据。
- mock/local-safe 状态必须和真实 Gateway 外部契约同构，且不得伪装真实 Gateway 成功。
