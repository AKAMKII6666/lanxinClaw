# OpenClaw 源码勘探记录

> 事实快照日期：2026-07-23  
> 上游仓库：`https://github.com/openclaw/openclaw`（`main`）  
> 用途：支撑 v1.2 P5/P6 — 明确澜星侧 **外部 adapter** 接入路线，避免侵入 OpenClaw core。

本文是 Agent 维护的当前事实，不是产品需求真源。集成边界真源见 [执行引擎集成.md](../共同维护/技术设计/执行引擎集成.md)。

## 1. 结论（先读）

| 问题 | 结论 |
|------|------|
| 首选接入方式 | **进程外 Gateway client**：通过 Gateway WebSocket RPC 或官方 gateway client/protocol 包连接本机 Gateway，创建/查询/取消 agent run |
| 备选 | Plugin SDK（`openclaw/plugin-sdk/*`）— 仅当必须挂进 OpenClaw 进程内 hook 时 |
| 默认禁止 | 大范围改 OpenClaw core；把张老板人格、pairing、affair 关闭写进 core |
| 本仓落点 | `packages/openclaw-adapter` 翻译 Lanxing job ↔ OpenClaw run；companion 仍是权限与配对边界 |
| Patch 条件 | 仅当公开 SDK/Gateway RPC 无法覆盖 MVP，且 patch 小、可解释、可回滚并写文档 |

**一句话**：澜星 Claw companion 把已授权的 job 交给 adapter；adapter 通过 Gateway 驱动 OpenClaw worker；`job.completed` 不得自动变成 `affair.closed`。

## 2. 仓库结构速览

上游大致分层：

| 路径 | 作用 |
|------|------|
| `openclaw.mjs` | CLI / 包入口启动器；校验 Node 版本后加载 `dist/entry.(m)js` |
| `src/entry.ts` | TypeScript 运行时入口（源码树需先 build） |
| `src/gateway/` | Gateway daemon：WebSocket RPC、会话、agent 调度 |
| `src/agents/` | Agent 配置与执行编排 |
| `src/channels/` | 消息通道（Discord / Slack / Telegram 等）— **不是**澜星电话协议 |
| `src/sessions/`、`src/tasks/` | 会话与任务账本 |
| `src/cli/` | `openclaw gateway` / `agent` / `tasks` / `doctor` 等命令 |
| `src/plugins/`、`packages/plugin-sdk/` | 进程内扩展点 |
| `packages/gateway-client/`、`packages/gateway-protocol/` | Gateway 传输与协议；线上文档推荐的外部 client 包 |
| `packages/sdk/` | 历史 App SDK 入口；若本地版本缺失，不作为当前实现真源 |
| `extensions/` | 捆绑/可选 harness 与插件（如 Codex） |
| `config` / 用户态 `~/.openclaw/openclaw.json` | 本机配置（模型、runtime、插件） |

本机常见 Gateway 地址形态：`ws://127.0.0.1:18789`（以本机配置为准；**不得**把 Gateway token 写入本仓）。

## 3. 启动与运行入口

1. 用户或 companion 启动 OpenClaw（安装包 / `openclaw` CLI）。
2. `openclaw.mjs` 做 Node 版本门禁，再导入构建产物 `dist/entry.js`（或 `.mjs`）。
3. CLI 子命令中与集成相关的重点：
   - `gateway`：启动或管理 Gateway
   - `agent`：一次性 agent 调用（调试用）
   - `sessions` / `tasks`：会话与任务账本
   - `doctor`：配置与插件健康检查
4. 外部集成应把 Gateway 视为 **稳定控制面**，而不是直接 import `src/agents/**` 内部模块。

## 4. Job / Run / Session / Channel 概念对照

| OpenClaw 概念 | 含义 | 澜星侧对应 |
|---------------|------|------------|
| Agent | 可调用的 worker 配置（如 `main`） | executor=`openclaw`；不承载张老板人格 |
| Run | 一次 agent 执行（`agent.run` / `oc.runs`） | 一个 Lanxing `jobId` 映射一个（或串行多个）run |
| Session | 可跨 run 的 transcript 上下文 | 可选；MVP 可用 job 级 sessionKey，不把 pairing 身份塞进 session |
| Task ledger | Gateway 持久任务条目（`oc.tasks`） | 可作诊断补充；**事务真相**仍在 affair/job 协议层 |
| Channel | IM/聊天入口 | **不**用于澜星电话；电话走本仓 companion 协议 |
| Approval | exec/plugin 审批（`oc.approvals`） | 映射为 companion `needs_permission`；最终裁决在 companion，不在 OpenClaw |

## 5. 公开扩展点（按优先级）

### 5.1 Gateway client / Gateway RPC（推荐）

2026-08-29 对照官方文档和本地 `openclaw@2026.7.1-2` 后，当前推荐把 Gateway WebSocket RPC 视为稳定控制面。本仓现状采用 raw WebSocket transport；线上文档同时提供 `@openclaw/gateway-client` 和 `@openclaw/gateway-protocol` 作为外部 client 包。

重点入口：

- `agent`：创建 run，使用 `idempotencyKey` 去重。
- `agent.wait`：等待 run lifecycle，返回 `ok/error/timeout` 粗状态。
- `chat.abort`：取消 run。
- `audit.activity.list` / `audit.list`：读取 run/tool 结构化结果。
- `tasks.list/get`：读取后台 task ledger。
- `chat.history` / `chat.message.get`：读取用户可见最终回复和摘要。

测试可注入假 Gateway transport，适合本仓 contract test。

**注意**：历史文档曾提到 `@openclaw/sdk` App SDK；当前外部接入实现以 Gateway RPC 为准，若未来切到官方 gateway client/protocol 包，仍必须保持本仓 `OpenClawRuntimeClient` 窄接口和状态证据语义不变。

### 5.2 Plugin SDK（次选）

进程内插件可通过 `api.runtime.agent.runEmbeddedAgent` / `api.runtime.subagent.run` 等 helper 启动执行。适用于要挂 tool hook、channel 或 provider 的场景。

**不适合**作为澜星默认路径：会把 companion 边界拖进 OpenClaw 进程，增加耦合与升级成本。

### 5.3 Core patch（最后手段）

仅当公开 RPC/SDK 无法表达「创建、查状态、取消」MVP，或必须修严重 bug 时。要求：

- 变更面尽量小
- 可回滚
- 在 `docs/智能体维护/` 记录原因、上游版本与退出条件

## 6. 状态映射（OpenClaw → Lanxing job）

状态映射已在 2026-08-29 重新研究，详见 [OpenClaw状态研究记录.md](OpenClaw状态研究记录.md)、[../共同维护/技术设计/OpenClaw状态观测与探针.md](../共同维护/技术设计/OpenClaw状态观测与探针.md) 和 [../共同维护/技术设计/OpenClaw到Lanxin状态映射.md](../共同维护/技术设计/OpenClaw到Lanxin状态映射.md)。下表保留为高层摘要。

| OpenClaw / SDK 侧信号 | Lanxing `JobStatus` | 说明 |
|------------------------|---------------------|------|
| run 已接受、尚未产出终态 | `queued` → `running` | adapter 本地可先 `queued` 再刷新为 `running` |
| `run.started` / 流式 progress | `running` | `progressSummary` 只放安全摘要 |
| `approval.requested` | `needs_permission` | companion 弹确认；OpenClaw 不替代权限门 |
| 工具失败且需外部输入 / 明确阻塞 | `blocked` | 填 `blockedReason` + `resumeCondition` |
| run 正常结束且无负证据 | `completed` | **仅** worker 完成；affair → `waiting_acceptance` 由事务层处理 |
| `run.failed` / 不可恢复错误 | `failed` | |
| `run.cancelled` / abort / `timed_out`（按产品口径） | `canceled` 或 `failed` | MVP：用户取消 → `canceled`；超时可先 `failed` 并带原因 |

禁止：把 OpenClaw `completed` 映射为 affair `closed` / `accepted`。

## 7. 推荐集成架构（本仓）

```text
Phone / 张老板
  -> affair / job 协议
  -> Companion（pairing + permission gate + audit）
  -> packages/openclaw-adapter（create / read / cancel）
  -> OpenClawRuntimeClient（真实：Gateway RPC/client；测试：mock）
  -> OpenClaw Gateway / agent run
```

MVP API（见 `packages/openclaw-adapter`）：

1. `createJob` — 接受显式 `allowedPermissions` 与可选 `workspaceHint`，创建 run 并登记 `jobId ↔ runId`
2. `readJob` — 读本地登记并可选向 runtime 刷新状态后映射
3. `cancelJob` — 请求 runtime 取消；终态幂等

后续（V1.2-15+）：真实 Gateway 低风险只读任务、progress 流回 companion。

## 8. 安全与凭据

- Gateway token / 模型 API 凭据只存在 OS 安全存储或本机环境，**不得**进入 repo、日志、示例、测试快照。
- Discovery/配对身份不属于 OpenClaw；adapter 不接收 pairing secret。
- 任何文件、命令、网络、git 副作用仍须先过 companion permission gate，再进入 adapter。
- `chat.message` / 用户上下文不得被当成系统指令直接抬权。

## 9. 风险与后续核对项

| 风险 | 缓解 |
|------|------|
| Gateway RPC/client 版本演进快 | adapter 只依赖窄接口 `OpenClawRuntimeClient`；真实 client 单独实现并钉版本 |
| per-run workspace/approval override 未接线 | MVP 用 Gateway 默认 workspace + companion 侧权限门；接线前用 mock 验契约 |
| Channel/插件与电话协议混淆 | 文档与代码命名严格区分；电话只走本仓协议 |
| 误改 core | 默认 PR/任务范围排除 vendored OpenClaw；勘探结论优先 SDK |

## 10. 参考链接

- 上游：`https://github.com/openclaw/openclaw`
- App SDK 概念：`https://open-claw.bot/docs/concepts/openclaw-sdk/`
- Agent runtimes：`https://docs.openclaw.ai/concepts/agent-runtimes`
- 本仓边界：[执行引擎集成.md](../共同维护/技术设计/执行引擎集成.md)、[安全模型.md](../共同维护/技术设计/安全模型.md)
