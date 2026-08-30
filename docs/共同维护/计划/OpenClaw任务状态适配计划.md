# OpenClaw 任务状态适配计划

> 前置研究：[../技术设计/OpenClaw状态观测与探针.md](../技术设计/OpenClaw状态观测与探针.md)、[../技术设计/OpenClaw到Lanxin状态映射.md](../技术设计/OpenClaw到Lanxin状态映射.md)。  
> 本计划已转入执行基线；当前代码落点以本文件和对应测试为准。

## 1. 目标

把当前 adapter 从“只用 `agent.wait` 粗状态”升级为“携证状态映射”：

- 能识别 OpenClaw run 正常结束但业务未完成；
- 能把 policy block、工具失败、工具超时、配置阻塞透给 Lanxin job；
- 能让控制面板和张老板拿到可读失败原因；
- 保持 OpenClaw 是 worker，companion 是权限边界，phone affair store 是事务真源。

## 2. Adapter 改造

新增内部证据模型：

- `OpenClawExecutionEvidence`
- `OpenClawProbeResult`
- `OpenClawToLanxinJobDecision`

关键行为：

- raw WS handshake 增加 `caps: ["tool-events"]`。
- `hello-ok.features.methods` 落入 runtime capability snapshot。
- `agent.wait` 支持区分 wait-only timeout 与 terminal timeout。
- `ok` 映射为候选完成，不直接写 `completed`。
- 增加 audit 探针：优先 `audit.activity.list`，fallback `audit.list`。
- 增加 task 探针：有 task 时补充状态，无 task 不视为异常。
- 增加 history 探针：用于摘要和弱阻塞，不单独证明成功。

主要落点：

- `packages/openclaw-adapter/src/client/gateway/raw-ws/transport.ts`
- `packages/openclaw-adapter/src/client/runtime-client.ts`
- `packages/openclaw-adapter/src/evidence/openclaw-execution-evidence.ts`
- `packages/openclaw-adapter/src/mapping/*`
- `packages/openclaw-adapter/src/jobs/*`

## 3. Companion 改造

JobDelegator 继续拥有轮询和广播，但广播来源改为 adapter decision：

- `running`：可继续短轮询，并展示最近 progress。
- `blocked`：广播 `job.blocked`，停止普通轮询，等待 resume/retry。
- `failed`：广播 `job.failed`，停止轮询。
- `completed`：广播 `job.completed`，触发 affair `waiting_acceptance` 投影。
- `canceled`：广播 `job.canceled`，拒绝迟到 completed。
- `running` 但 `progressSummary/blockedReason/resumeCondition/statusReasonCode` 发生变化时也广播，避免“状态没变但信息已经变了”。

控制面板补充展示：

- blocked reason；
- resume condition；
- failed summary；
- OpenClaw evidence source 的脱敏摘要。

不改变 companion 权限边界：OpenClaw 失败原因不能自动扩大权限，仍由 permission gate 处理。

## 4. Phone/张老板消费

Phone 侧不直接读 OpenClaw，只消费 companion 协议事件。

张老板能力接入：

- `get_progress` 能读到 `blockedReason/resumeCondition`。
- 通话中收到 blocked/failed/completed 事件后形成即时回报。
- 挂机后由后台监督任务触发回电，回电前复验 affair/job/run。

话术遵循：

- `completed` 说“worker 已完成，等你验收”。
- `blocked` 说“卡住原因和下一步选择”。
- `failed` 说“这次尝试没成功，可重试或改方案”。

## 5. 测试计划

Adapter 单元测试：

- `ok` 不直接 completed，需无负证据。
- wait-only timeout 保持 running。
- terminal timeout 映射 failed。
- tool/audit blocked 映射 blocked。
- task completed 不覆盖 tool failed。
- task failed/lost 风险映射不产生假 completed。
- final negative text 触发 weak blocked。
- 已 canceled job 不被迟到 completed 覆盖。

Companion 集成测试：

- adapter decision 广播正确 job envelope。
- `job.completed` 只把 affair 推到 `waiting_acceptance`。
- `job.failed` 不关闭 affair。
- `job.blocked` 保存 reason/resumeCondition。
- 重连 reconcile 不重复广播终态。

实机 smoke：

- 正常只读任务。
- 浏览器 policy blocked。
- 工具不存在或能力缺失。
- 用户取消。
- Gateway 断连后恢复。
- OpenClaw run 正常回复“无法完成”。

质量门禁：

- `npm run quality`
- 相关 adapter/companion 窄测
- 真机 phone 联调回归

## 6. 验收标准

- OpenClaw 不能完成目标时，UI 不再显示假 running 或假 completed。
- 张老板能在通话中或回电中说明失败/阻塞原因。
- `agent.wait ok` 不再直接代表业务成功。
- `agent.wait timeout` 不再无条件代表 still running。
- 断线、迟到、重复事件不会推进错误终态。
- 所有终态都有 `jobId/runId/sessionKey` 证据。

## 7. 默认取舍

- v1 不 patch OpenClaw core。
- v1 不读取 OpenClaw 私有 SQLite 或 transcript 文件。
- v1 不把 OpenClaw task ledger 设为唯一真源。
- `blocked` 与 `failed` 无法区分时，默认 `blocked`，避免错误打死可补救事务。
- final reply 只能降级防假成功，不能升级为成功证据。
