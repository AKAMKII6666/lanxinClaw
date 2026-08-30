# OpenClaw 任务状态研究计划

> 计划日期：2026-08-29  
> 研究对象：OpenClaw run/task/tool/audit/history 状态，以及它们到 Lanxin job/affair 的映射。  
> 原则来源：[../技术设计/携证状态转移原则.md](../技术设计/携证状态转移原则.md)。  
> 后续执行计划：[OpenClaw任务状态适配计划.md](OpenClaw任务状态适配计划.md)。

## 1. 背景

实机联调已经证明 phone 侧可以把事务发到 Lanxin Claw，Lanxin Claw 也能把任务委派给 OpenClaw。当前关键问题不是“能不能发任务”，而是：

- OpenClaw 没完成目标时，Lanxin 侧不能显示假成功或永久 running；
- 张老板必须能在通话中或回电时说明任务卡在哪里；
- companion 控制面板必须展示失败、阻塞、超时、待授权等状态；
- OpenClaw 的复杂状态不能直接等同于 Lanxin affair 状态。

因此在继续写实现前，必须先把 OpenClaw 的任务状态、状态探针、证据强度和 Lanxin 映射研究清楚。

## 2. 目标

本轮研究要回答：

1. OpenClaw 如何创建一次 agent run，以及幂等、session、runId 的边界是什么。
2. `agent.wait` 返回哪些状态，这些状态分别能证明什么、不能证明什么。
3. OpenClaw task ledger 的 task 类型、状态、terminal outcome 与 Gateway RPC 摘要如何对应。
4. 实时事件、工具事件、audit、task、history 哪些可以作为强证据，哪些只能作为摘要。
5. Lanxin job 的 `running/blocked/failed/completed/canceled` 应该如何由证据驱动。
6. Zhang affair 如何消费 job 状态，避免 `job.completed -> affair.closed` 这类越权跃迁。
7. 失败或阻塞如何透出到控制面板、通话中回报和后台回电。
8. 后续实现需要改哪些模块，应该补哪些测试和实机样本。

## 3. 非目标

- 本轮不改 OpenClaw core。
- 本轮不实现 adapter 状态探针代码。
- 本轮不决定 API Key 同步体验项。
- 本轮不把 OpenClaw task ledger 设为 Lanxin 事务真源。
- 本轮不让 phone 直接读取或控制 OpenClaw。

## 4. 事实来源优先级

| 优先级 | 来源 | 用途 |
|--------|------|------|
| P0 | 本仓当前代码与测试 | 确认 Lanxin 现状和已有 adapter 缺口 |
| P0 | `vendor/openclaw` 本地源码 | 确认当前捆绑版本真实状态 |
| P1 | OpenClaw 官方文档 | 对照 Gateway 协议、client、task、audit、agent loop 设计 |
| P1 | 实机 log 与 smoke 样本 | 验证真实 payload 与失败场景 |
| P2 | 社区讨论或文章 | 只作线索，不作状态机真源 |

研究结论必须标明来源类型。源码与官方文档冲突时，按本地捆绑版本约束当前实现，并在文档里记录兼容策略。

## 5. 研究任务

### 5.1 OpenClaw run 生命周期

要确认：

- `agent` RPC 的必要参数、返回字段和幂等语义；
- `accepted`、`in_flight` 与 Lanxin job 创建/重试的关系；
- `agent.wait` 的 `ok/error/timeout` 是否等于终态；
- `timeout` 如何区分 wait-only timeout 和 terminal timeout；
- run 与 `sessionKey/runId/idempotencyKey` 的稳定关联。

输出文档：

- [../../智能体维护/OpenClaw状态研究记录.md](../../智能体维护/OpenClaw状态研究记录.md)
- [../技术设计/OpenClaw状态观测与探针.md](../技术设计/OpenClaw状态观测与探针.md)

### 5.2 OpenClaw task 与 task flow

要确认：

- 哪些 OpenClaw 执行会创建 task，哪些不会；
- task internal status 与 Gateway `TaskSummary.status` 的映射；
- `terminalOutcome=blocked` 与 task `succeeded/completed` 的差异；
- task `failed` 是否可能来自内部 `lost`；
- task flow 是否适合 v1 直接参与 Lanxin affair 状态。

输出文档：

- [../../智能体维护/OpenClaw状态研究记录.md](../../智能体维护/OpenClaw状态研究记录.md)

### 5.3 实时事件、工具事件与重连

要确认：

- Gateway event 的 `runId/seq/stream` 结构；
- `tool-events` capability 的声明方式和缺失表现；
- 重连后如何恢复 `sessions.subscribe`、history、active run；
- event 缺口如何触发 reconcile，而不是直接推进终态；
- 工具 failed/blocked/timed_out/cancelled 的可观测字段。

输出文档：

- [../技术设计/OpenClaw状态观测与探针.md](../技术设计/OpenClaw状态观测与探针.md)

### 5.4 Audit 与 history

要确认：

- `audit.activity.list` 与 `audit.list` 的能力检测和 fallback；
- audit status/errorCode 与工具失败、阻塞、超时的对应关系；
- audit 的 metadata-only 隐私边界；
- 缺 audit 时为什么不能证明没有失败；
- final assistant text 如何只作为摘要或弱阻塞证据。

输出文档：

- [../../智能体维护/OpenClaw状态研究记录.md](../../智能体维护/OpenClaw状态研究记录.md)
- [../技术设计/OpenClaw状态观测与探针.md](../技术设计/OpenClaw状态观测与探针.md)

### 5.5 Lanxin 状态映射

要确认：

- OpenClaw run/task/tool/audit/history 到 Lanxin job 的证据强度；
- `ok`、`timeout`、`blocked`、`failed` 的专门规则；
- `completed` 为什么只能表示 worker 完成，不能关闭 affair；
- 已终态 job 如何防止迟到事件覆盖；
- `blocked -> running` 必须由用户补证、resume、retry 或新 run 证据触发。

输出文档：

- [../技术设计/OpenClaw到Lanxin状态映射.md](../技术设计/OpenClaw到Lanxin状态映射.md)

### 5.6 失败回报闭环

要确认：

- 哪些状态需要通话中即时回报；
- 哪些状态需要挂机后的后台回电；
- 回电前必须复验哪些 `affairId/jobId/runId` 证据；
- 控制面板应该如何显示 blocked、failed、completed；
- 当前浏览器 policy blocked 案例应该如何回报。

输出文档：

- [../技术设计/OpenClaw执行失败回报闭环.md](../技术设计/OpenClaw执行失败回报闭环.md)

### 5.7 后续实现拆分

要确认：

- adapter 应该新增哪些证据模型和探针；
- companion JobDelegator、监督 loop、控制面板需要怎样消费状态；
- phone/张老板只消费哪些协议事件；
- 应该新增哪些单元测试、集成测试和实机 smoke。

输出文档：

- [OpenClaw任务状态适配计划.md](OpenClaw任务状态适配计划.md)

## 6. 对抗审查

研究文档完成后必须做一次对抗审查，按高风险边界优先找问题：

- 是否存在无证状态跃迁；
- 是否存在 `agent.wait ok -> job.completed/affair.closed` 的假成功；
- 是否存在 `agent.wait timeout -> 永久 running` 的假等待；
- 是否存在 phone 绕过 companion 权限层；
- 是否存在读取 OpenClaw 私有文件作为生产接口；
- 是否存在旧 run 事件推进新 job；
- 是否遗漏失败/阻塞回报闭环；
- 是否遗漏后续实现测试项。

审查输出：

- [../技术设计/OpenClaw状态研究审查.md](../技术设计/OpenClaw状态研究审查.md)

## 7. 完成标准

本轮研究完成必须满足：

- 每个研究任务都有对应文档落点；
- 每个终态映射都有证据来源和禁止项；
- `run/task/tool/audit/history/job/affair` 边界清楚；
- 旧设计文档中不再保留会误导实现的旧口径；
- 对抗审查没有 P0/P1 缺口；
- P2 项明确列入后续实现或实机验证。
