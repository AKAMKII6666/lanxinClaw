# OpenClaw 到 Lanxin 状态映射

> 适用范围：`packages/openclaw-adapter`、companion job delegation、phone 侧事务簿消费。  
> 事实来源：[OpenClaw状态观测与探针.md](OpenClaw状态观测与探针.md)。  
> 安全原则：[携证状态转移原则.md](携证状态转移原则.md)。

## 1. 核心规则

OpenClaw 状态只能证明 worker 执行事实，不能直接证明 Lanxin affair 完成。

必须保持三层分离：

| 层 | Owner | 状态含义 |
|----|-------|----------|
| OpenClaw run/task/tool | OpenClaw runtime | worker 是否接受、执行、失败、阻塞、结束 |
| Lanxin job | companion + adapter | 一次已授权电脑工作是否推进、阻塞、失败、完成 |
| Zhang affair | phone affair store | 用户事务是否澄清、执行、待验收、关闭 |

禁止映射：

- `agent.wait ok -> affair.closed`
- `job.completed -> affair.closed`
- `task.completed -> affair.closed`
- 仅凭 final reply 文本写 `job.completed`
- 仅凭 discovery/session connected 写 `job.running`

## 2. Lanxin job 状态口径

| JobStatus | 允许来源 | 用户语义 |
|-----------|----------|----------|
| `queued` | companion 本地已接收但尚未获得 OpenClaw 接受证据 | 已登记，未开始 |
| `needs_permission` | companion permission gate | 等用户授权 |
| `running` | OpenClaw accepted/start/progress 或 wait-only timeout | 正在做或仍在等待 |
| `blocked` | 需要用户、权限、配置、工具能力或方案选择介入 | 卡住了，需要处理 |
| `completed` | worker 已结束且没有负证据 | worker 认为已完成，等待 affair 层验收 |
| `failed` | 当前执行尝试失败或超时 | 没做成，可由张老板决定是否重试/改方案 |
| `canceled` | 用户取消或 companion 明确取消 | 已停止 |

## 3. 证据强度

| 证据 | 强度 | 可否推进终态 |
|------|------|--------------|
| 本地 cancel intent + `chat.abort` ack | 强 | 可写 `canceled` |
| audit/tool terminal blocked | 强 | 可写 `blocked` |
| audit/tool terminal failed/timed_out | 强 | 可写 `failed` |
| lifecycle error + liveness blocked | 强 | 可写 `blocked` |
| lifecycle error 普通失败 | 中 | 可写 `failed` |
| task ledger terminal | 中 | 与 run/audit 合并后可写终态 |
| `agent.wait ok` | 中 | 不能单独 completed |
| final assistant text | 弱 | 可生成摘要，不能单独 completed |
| 本地 adapter cache | 辅助 | 不能单独推进终态 |

## 4. 映射决策表

| OpenClaw 证据 | Lanxin JobStatus | `progressSummary` | `blockedReason` / `resumeCondition` |
|---------------|------------------|-------------------|--------------------------------------|
| `agent` 返回 accepted/runId | `running` | `openclaw_run_accepted` | 空 |
| `agent` 返回 `in_flight` | 保持当前状态 | `openclaw_run_in_flight` | 空 |
| lifecycle start | `running` | `openclaw_run_started` | 空 |
| tool progress | `running` | 工具进度安全摘要 | 空 |
| wait-only `timeout` | `running` | `openclaw_wait_timeout_still_observing` | 空 |
| `audit/tool_blocked` | `blocked` | 工具被阻塞 | 写阻塞原因和恢复条件 |
| `audit/run_blocked` | `blocked` | run 被阻塞 | 写阻塞原因和恢复条件 |
| OpenClaw approval required | `needs_permission` | 等待 OpenClaw/companion 权限 | 绑定 permission request |
| policy block | `blocked` | `openclaw_policy_blocked` | 说明被策略拦截，建议授权或改方案 |
| missing tool/capability | `blocked` | `openclaw_capability_missing` | 说明缺能力，建议启用能力或改方案 |
| auth/config/model 需要用户处理 | `blocked` | `openclaw_configuration_blocked` | 说明需要配置或重新认证 |
| ordinary tool/run failed | `failed` | 错误安全摘要 | 可选 retry hint |
| tool/run timed_out | `failed` | `openclaw_timeout` | `retry_or_reduce_scope` |
| 用户取消后 abort ack | `canceled` | `cancelled_by_user` | 空 |
| 非用户 abort/cancel | `failed` | `openclaw_run_aborted` | `retry_after_reconnect` |
| task RPC `completed` | 待合并 | task 完成摘要 | 不能单独判 completed |
| task RPC `failed` | `failed` 或 `blocked` | task 错误摘要 | 疑似 lost 时建议重连/重试 |
| run `ok` + 无负证据 + final 非负 | `completed` | final 摘要 | 空 |
| run `ok` + final 明确无法完成 | `blocked` | final 摘要 | 需要用户选择替代方案 |

## 5. `ok` 的专门规则

`agent.wait.status = "ok"` 的含义是 agent loop 正常结束。

它只能进入候选完成态，必须再检查：

1. `jobId/runId/sessionKey` 仍匹配当前 job。
2. job 未被取消、未终态、未被新 run 替代。
3. 没有 audit/tool/task 失败或阻塞证据。
4. final reply 没有明确失败或无法完成表达。
5. job purpose 是 `execution` 时，完成后只推进 affair 到 `waiting_acceptance`；purpose 是 `exploration` 时只回写探索结果。

若检查失败：

- 有结构化阻塞证据：`blocked`。
- 有结构化失败证据：`failed`。
- 只有 final 负向文字：`blocked`，`resumeCondition` 写 `choose_alternative_or_grant_capability`。
- 证据缺失：保持 `running` 并触发下一轮探针，超过监督窗口再 `blocked`。

## 6. timeout 的专门规则

OpenClaw timeout 有两个意思：

| 情况 | Lanxin |
|------|--------|
| `agent.wait` 等待窗口超时，run 可能仍在跑 | `running` |
| run runtime 超时或 audit/task terminal timeout | `failed` |

wait-only timeout 判定：

- `agent.wait.status = "timeout"`；
- 无 `endedAt`；
- 无 audit terminal timeout；
- 无 task `timed_out`；
- session 仍显示 active run，或无法证明 run 已终态。

terminal timeout 判定：

- audit `run_timed_out/tool_timed_out`；
- task `timed_out`；
- lifecycle terminal 带 `endedAt` 和 timeout 归因；
- wait 返回含 terminal timeout 的字段组合。

## 7. blocked 与 failed

`blocked` 表示需要外部介入才能继续：

- 需要用户授权；
- 需要用户补充信息；
- 需要用户选择替代方案；
- 工具被 policy 拦截；
- 工具能力不存在或未启用；
- 需要模型/API/配置修复；
- Gateway/任务 backing state 丢失但不能证明执行失败。

`failed` 表示当前执行尝试失败：

- 工具异常且没有明确用户可处理条件；
- run 普通错误；
- terminal timeout；
- adapter/Gateway RPC 不可恢复错误；
- OpenClaw 返回无法恢复的执行错误。

如果无法区分 `blocked` 和 `failed`，默认选择 `blocked`，并写明需要重新探测或人工处理。这样避免把用户仍可补救的事务错误地打死。

## 8. affair 投影

Lanxin job 到 affair 的投影仍按电话侧事务簿：

| Job event | Affair |
|-----------|--------|
| `job.accepted/running/progress` | `running` |
| `job.blocked` | `blocked` |
| `job.failed` | 通常 `blocked`，由张老板解释失败并决定重试/改方案 |
| `job.completed` with `purpose=execution` | `waiting_acceptance` |
| `job.completed` with `purpose=exploration` | 保持澄清/当前态，写 timeline |
| `job.canceled` | 保持或进入 `blocked/canceled`，按用户意图决定 |

只有用户明确验收后，张老板/phone 才能调用 `accept_affair` 并发 `affair.close(status=closed)`。

## 9. 单调与幂等

每次状态更新必须携带：

- `jobId`
- `affairId`
- `runId`
- `sessionKey`
- `observedAt`
- `evidenceKind`
- `sourceSequence` 或等价序号，若存在

规则：

- 已终态 job 不被迟到 running/progress 覆盖。
- 已 canceled job 不被迟到 completed 覆盖。
- 新 run 创建后，旧 run 事件不能推进新 job。
- 重复 event/RPC 只更新时间线去重，不重复广播。
- `blocked -> running` 只能由 resume、retry、用户补证或新的 run 接受证据触发。

## 10. 对当前浏览器失败的映射

现象：

- OpenClaw final reply 表示浏览器导航被策略限制，建议改用搜索/抓取新闻内容。
- run 可能以 `ok` 结束。

正确映射：

- 若 audit/tool 有 policy blocked：`job.blocked`。
- 若只有 final reply 负向文字：`job.blocked`，证据强度为 weak。
- `progressSummary`：`浏览器打开被 OpenClaw 策略拦截`。
- `blockedReason`：`OpenClaw 无法直接打开浏览器新闻页`。
- `resumeCondition`：`用户同意改用搜索/抓取内容，或在电脑端放开相关浏览器能力`。

错误映射：

- `agent.wait ok -> job.completed`
- `agent.wait timeout -> 永久 running`
- 不向 phone/UI 回报任何失败原因
