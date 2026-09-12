# 非 Happy Path 根因审查报告

## 0. 审查定位

本文记录 2026-08-30 周日夜间实机通话后暴露的一组非 happy path 问题。目标不是修单点，而是拆开 phone、张老板 FC、companion、OpenClaw adapter 四层状态链，确认每个边界的 owner、证据、合法转移和失败恢复。

审查依据：

- [携证状态转移原则](携证状态转移原则.md)
- [复杂应用的携证状态与责任链设计原则](原则和规范/复杂应用的携证状态与责任链设计原则.md)
- phone 实机日志：`/lanxindianhua/app/logs/call-turns.jsonl`
- phone 实机状态：`/lanxindianhua/app/runtime/lanxin-claw/`
- desktop companion 日志：`%APPDATA%/@lanxin-claw/companion/logs/`
- desktop companion 镜像：`%APPDATA%/@lanxin-claw/companion/backend-mirror.json`
- desktop adapter job 落盘：`%APPDATA%/@lanxin-claw/companion/adapter-jobs.json`

严重度定义：

- P0：会造成用户可见假成功、任务丢失、错误终态或高风险边界被绕过。
- P1：会造成状态机卡死、用户无法恢复、错误回报、重复执行或难以诊断。
- P2：不会直接破坏安全/终态，但会降低可观测性、可用性或后续维护质量。

## 1. 事件时间线

以下时间为日志 UTC 时间，北京时间需加 8 小时。用户提到的“星期天晚上”对应 2026-08-30 晚间到 2026-08-31 凌晨。

### 1.1 连接中断与自动回拨

- `2026-08-30T16:36:52Z`：phone session `29daab28-70a2-4f33-94f4-dbf2ff3ca6f6` 接入张老板。
- `2026-08-30T16:37:17Z`：`companion.get_connection_status` 返回 `paired=true`、`sessionReady=false`、`sessionStatus=closed`，并携带旧 `activeAffairId=affair_2cee...`。
- `2026-08-30T16:37:19Z`：`companion.discover_desktops` 发现 1 台 `Lanxin Companion`。
- `2026-08-30T16:37:23Z`：`companion.prepare_desktop_connection` 生成 `connection_intent_id=claw_conn_6b6c...`。
- 同一秒出现 `Conversation already has an active response`，随后 `session.disconnect`。

### 1.2 回拨后连接成功，但任务未创建

- `2026-08-30T16:38:32Z`：phone 自动回拨 session `a9f20e65-3259-42e9-873b-9ff46ea1b543`。
- `2026-08-30T16:39:05Z`：再次查询连接状态，仍显示 `paired=true`、`sessionReady=false`，并携带旧 `activeAffairId=affair_2cee...`。
- `2026-08-30T16:39:08Z`：再次 discovery，发现 1 台 desktop，`paired_with_this_phone=true`。
- `2026-08-30T16:39:32Z`：prepare 生成 `connection_intent_id=claw_conn_f5be...`。
- `2026-08-30T16:39:43Z`：`confirm_desktop_connection` 返回 `status=session_ready`、`connectionOpen=true`、`sessionStatus=accepted`。
- desktop `protocol.log.1` 记录同一 session 的 `session.open` 和 `session.accepted`，说明连接本身成功。
- `2026-08-30T16:40:06Z` 到 `16:41:19Z`：张老板多次口头声称“让电脑去建”“任务请求已经发到你电脑上”“旧任务关了，重新来一遍”。
- 但该 session 的 companion tool 调用只有：`get_connection_status`、`discover_desktops`、`prepare_desktop_connection`、`confirm_desktop_connection`、两次 `get_progress`。没有 `companion.create_job`、`companion.cancel_job`、`companion.cancel_affair`。
- desktop `protocol.log.1` 在 `session.open/session.accepted` 之后只有 heartbeat 和后续 `session.closed(heartbeat_timeout)`，没有 `affair.create` 或 `job.create`。

### 1.3 旧 active affair 污染当前任务判断

- 两次 `companion.get_progress` 均查询旧事务 `affair_2cee4e9f2f914b3a8ab6e6383668e7d6`。
- phone 返回该事务 `status=running`，但其 current job `job_7fd0...` 已经 `status=canceled`。
- phone 落盘 `runtime/lanxin-claw/affairs/index.json` 仍把 `activeAffairId` 指向这个旧事务。
- desktop `backend-mirror.json` 中同一个 affair 已经是 `status=canceled`，说明 phone 与 desktop 对同一事务真源出现分叉。

### 1.4 历史 OpenClaw 完成假阳

- desktop `adapter-jobs.json` 中存在 `job_8c227...`、`job_cc6...`，其 `progressSummary=stop`、`statusReasonCode=openclaw.run_completed`、`lastEvidenceKind=wait.completed`。
- 用户截图中 UI 显示“worker 已完成，事务处于待验收”，但实际结果是打开了空白浏览器页，业务目标未完成。
- 当前本地代码已有 `terminalWithoutResultRule` 和 `hasBusinessCompletionEvidence` 相关修复痕迹，但历史落盘证明原缺陷真实发生过，且旧数据需要迁移/修复策略。

## 2. 根因矩阵

| ID | 严重度 | 症状 | 直接证据 | 根因 | 状态 owner | 触发原则 | 修复动作 |
|----|--------|------|----------|------|------------|----------|----------|
| RCA-01 | P0 | 张老板声称任务已发到电脑，但没有 create_job / job.create | `a9f20e65...` 只有连接和 get_progress 工具调用；desktop 无 `affair.create/job.create` | 自然语言把“将要做/正在做”说成了“已完成跨边界动作”，缺少动作回执门闩 | phone 张老板 FC runtime / 工具提示 / 通话审计 | 原则 1、2、5、12 | 引入“动作回执”语义：凡声称连接、发任务、取消、关闭、验收，必须引用最近一次成功 FC receipt；无 receipt 时只能说“我还没发出去/我准备发”。 |
| RCA-02 | P0 | 当前任务被旧任务污染，张老板查询到旧新闻任务并误判“建文档卡住” | phone active affair 指向 `affair_2cee...`；affair running 但 current job canceled | phone store 只按 affair.status 选择 active，不校验 affair + current job 组合不变量 | phone affair store | 原则 1、4、5 | 增加 active affair repair：非终态 affair 若 current execution job 为 failed/completed，必须投影到 blocked/waiting_acceptance 或移出 active；若 current job canceled，普通 job cancel 只能 blocked 或移出 active，只有整件事务取消证据才 canceled。启动/读取/写入时都修复。 |
| RCA-03 | P0 | OpenClaw 返回 `stop` 被显示为 completed / waiting_acceptance | `adapter-jobs.json` 显示 `progressSummary=stop` + `openclaw.run_completed` + `wait.completed` | adapter 把 runtime wait/terminal 信号误当业务完成证据 | OpenClaw adapter | 原则 1、5、10 | 完成态必须有业务完成证据；无业务结果的 terminal success 映射为 blocked；旧落盘数据需迁移或复投影。 |
| RCA-04 | P1 | 同一 turn 多个 `turn.assistant.start`，随后 realtime active response 错误并断线 | `Conversation already has an active response` 多次出现；`companionToolHandler.reply()` 每次工具结果后立即 `client.createResponse()` | 本地 `isResponding` 不是服务端响应真源；工具输出与 response.create 缺串行化/幂等保护 | phone realtime adapter | 原则 2、4、10、12 | 建立 response.create 队列和 in-flight latch；active response 错误按可恢复事件处理；一轮工具结果只触发一次后续 response。 |
| RCA-05 | P1 | 通话挂断后 desktop session 继续 heartbeat，直到 17:07 timeout | `protocol.log.1` 从 16:39 session.accepted 到 17:07 heartbeat_timeout；phone `onCallEnded` 只迁移 supervision，不关闭 desktop session | 协议未明确 desktop session 是 call-scoped 还是 durable；挂断后的连接生命周期缺真源 | phone runtime / companion protocol server | 原则 2、5、6 | 明确 session 生命周期：若 call-scoped，通话结束主动发 `session.closed` 并清 heartbeat；若 durable，需显式 session health/resume 合同和 stale recovery。 |
| RCA-06 | P1 | prepare 后张老板说“电脑会弹确认提示”，但工具返回明确说不会 | `prepare_desktop_connection` hint 写明不会弹窗；Transcript 仍说用户会看到确认提示 | 关键话术只靠软 prompt，缺少工具输出驱动的下一句约束 | phone 张老板 FC prompt / runtime | 原则 7、12 | 工具返回 `allowed_next_utterance` / `forbidden_claims` 或 runtime 层做话术审计；prepare 后只允许询问电话里的口头确认。 |
| RCA-07 | P1 | UI “请求验收/让张老板回报”点击后用户感受像没反应 | `affair.requestAcceptance` 出站函数支持 pending queue，但 `bridge-action-policy` 要求已认证 session；UI 只展示失败 error，无成功 receipt | 桌面 UI 意图投递、实时 session、后台回电三者合同不统一 | companion backend / bridge / phone pending context | 原则 5、7、9、12 | 裁决该动作语义：在线发送、离线排队、还是调度回电；返回可见 receipt；补 phone 消费 pending context 后的回报闭环。 |
| RCA-08 | P2 | 排障需要跨三端手工拼日志，容易漏证据 | phone tool_result summary 太粗；desktop DTO 与 phone FC 缺统一 action/correlation receipt；adapter evidence 不直连 UI 展示 | 可观测性没有按“事务链”聚合 | phone logger / companion protocol logger / adapter evidence store | 原则 12 | 增加跨端 `actionReceiptId/correlationId`，DTO 落盘索引，UI 诊断入口按 affair/job/session 聚合显示。 |

## 3. 状态链审查

### 3.1 连接链

期望链路：

```text
get_connection_status
  -> discover_desktops
  -> prepare_desktop_connection
  -> 用户口头确认
  -> confirm_desktop_connection
  -> session.open
  -> session.accepted
  -> connection.sessionReady=true
```

本轮观察：

- `a9f20e65...` 中这条链最终成立，连接不是主要失败点。
- prepare 阶段出现错误话术：“会看到确认提示”。这会制造用户等待桌面提示的假交互。
- `connection.status` 返回旧 `activeAffairId`，把连接状态与事务状态混在同一个口头上下文里，使张老板后续误用旧事务。

设计缺陷：

- 连接动作缺少“下一句安全话术”的机器约束。
- 连接状态 DTO 混入 active affair，但没有标注该 active affair 是否健康、是否当前通话、是否可继续委派。

### 3.2 任务创建链

期望链路：

```text
用户给目标/上下文/验收标准
  -> companion.create_job
  -> phone 本地 affair/job 落盘
  -> affair.create + job.create 发到 companion
  -> companion permission request
  -> UI 授权
  -> adapter 执行
```

本轮观察：

- 张老板已经拿到目标“创建文本文档，写入廖丽的电脑，闲人免进”。
- 没有调用 `companion.create_job`。
- 没有 desktop `affair.create/job.create`。
- 但张老板口头报告“任务请求已经发到你电脑上了”。

设计缺陷：

- “要做任务”与“已发任务”之间没有硬门闩。
- prompt 提醒不足以保证模型不会越权叙述。
- call-turn logger 能记录工具结果，但没有在运行时阻止无证据成功话术。

### 3.3 事务真源链

期望链路：

```text
phone affair store 拥有事务连续性
desktop mirror 是投影
adapter job 是执行事实
phone activeAffairId 只能指向可继续推进的当前事务
```

本轮观察：

- phone `activeAffairId=affair_2cee...`。
- 该 affair `status=running`，但 current job `status=canceled`。
- desktop mirror 中同一 affair 已为 `canceled`。
- 张老板后续 `get_progress` 查旧 affair，误把“旧任务已取消”投射到新任务“建文档卡住”。

设计缺陷：

- phone active affair repair 只检查 affair status，不检查 current job terminal。
- phone 与 desktop 对同一 affair 的事实分叉后，没有 reconciliation。
- old callSessionId 仍保留 `active_call`，使旧事务看起来还属于可推进通话。

### 3.4 OpenClaw 执行链

期望链路：

```text
OpenClaw runtime event
  -> adapter evidence normalization
  -> Lanxin job status
  -> affair projection
  -> UI / phone report
```

本轮观察：

- 历史 job 以 `stop` 作为 `progressSummary`，被映射为 `openclaw.run_completed`。
- UI 因 job completed 将 affair 推到 `waiting_acceptance`。
- 用户看到“待验收”，但实际任务结果不可验收。

设计缺陷：

- adapter 曾把“执行器停止”当成“业务完成”。
- `waiting_acceptance` 文案没有强提示“这是电脑端声称执行结束，不等于用户满意”。
- 旧落盘数据没有复投影，因此即便代码已修，也可能继续污染 UI。

### 3.5 UI / 回报链

期望链路：

```text
用户在 UI 请求回报/验收/继续
  -> companion backend 校验状态
  -> 在线发送给 phone，或离线排队并调度回电
  -> phone 收到 context / pending context
  -> 张老板 get_progress 复验
  -> 向用户回报
```

本轮观察：

- 协议出站层支持 `chat.context_attach` pending queue。
- 后端 policy 对 `affair.requestAcceptance` 要求 authenticated session，导致离线排队能力在 UI 入口前可能被拦截。
- UI 成功提交后没有可见 receipt；失败只显示 error。
- 本仓 `hasActiveCall()` 恒为 false，桌面端没有自己的电话通话真源。

设计缺陷：

- “请求张老板回报”到底是实时会话动作、离线意图、还是回电任务，未形成单一合同。
- UI 展示层无法告诉用户动作是 sent、queued、rejected 还是 waiting_for_phone。
- phone 对 pending context 的消费需要和后台回电调度显式绑定。

## 4. 修复优先级

### P0 第一组：禁止假成功

1. phone 端增加 action receipt / last tool result gate。
2. 张老板话术约束从软 prompt 升级为工具结果驱动的可审计合同。
3. 回归测试：没有 `companion.create_job` receipt 时，通话日志不得出现“任务已发到电脑/电脑已收到/正在等授权”等成功话术。

### P0 第二组：修复 active affair 不变量

1. phone store 读取、写入、启动时统一 repair active affair。
2. 非终态 affair + terminal current job 必须投影到合法 affair 状态，或从 active selection 排除。
3. 旧 `active_call` + 旧 `callSessionId` 必须转 background 或 stale。
4. 回归测试：旧 running affair + canceled current job 不得被 `getConnectionStatus` / `getProgress` 作为当前可推进事务返回。

### P0 第三组：OpenClaw 完成态必须有业务证据

1. 保留当前本地代码中的 `terminalWithoutResultRule` 方向。
2. 对 `stop`、`endedAt only`、`wait.completed only`、空白浏览器页、工具失败但 run completed 建立反例测试。
3. 旧 adapter jobs 和 backend mirror 需要启动时复投影，避免历史 `stop` completed 继续显示为待验收。

### P1 第一组：Realtime response 串行化

1. `response.create` 建 in-flight latch，不只依赖 `isResponding`。
2. 工具结果批处理：同一个 `response.done` 后的多个 tool output 只触发一次后续 response。
3. `Conversation already has an active response` 作为可恢复错误记录，不应直接造成通话状态丢失。
4. 回归测试：并发/重复 `response.created`、迟到 `response.done`、工具输出后立即 create response 不得触发断线。

### P1 第二组：明确 session 生命周期

1. 做一次产品裁决：desktop session 是通话作用域还是持久工作会话。
2. 若选择通话作用域：`onCallEnded` 主动 close desktop session，清 heartbeat，并同步 companion。
3. 若选择持久会话：引入 durable session health，下一通电话必须先复验 socket/session generation。
4. 回归测试：第一通连接后挂断，第二通重新连接不得出现假阳 session。

### P1 第三组：UI 意图投递与回电闭环

1. 裁决 `affair.requestAcceptance` 的合同：在线发送、离线排队、或调度回电。
2. 若支持离线排队，则从 `SESSION_REQUIRED_AFFAIR_ACTIONS` 移除 `requestAcceptance`，并让 result 返回 `queued`。
3. 若要求在线，则 UI 必须明确显示“需要电话在线/张老板通话中”。
4. 增加 action receipt 展示：`sent`、`queued`、`rejected`、`waiting_for_callback`。

### P2：观测增强

1. phone tool_result summary 必须包含 affair/job/statusReason 的压缩摘要。
2. desktop protocol DTO、adapter job、UI action 都写入同一 correlation/action receipt。
3. 诊断页提供按 session/affair/job 过滤的链路视图。

## 5. 后续修复计划

### 阶段 A：状态真源与假成功门闩

范围：phone repo 为主，desktop 只做必要 schema/文档同步。

交付：

- action receipt 结构与日志字段。
- phone active affair repair。
- 张老板 FC 输出后的受限下一步话术合同。
- 对 `a9f20e65...` 场景的回放测试。

验收：

- 没有 create_job receipt 时不能报告“任务已发”。
- 旧 canceled job 不再让 affair 保持 active running。
- `get_connection_status` 不再把 unhealthy active affair 当作可推进上下文。

### 阶段 B：OpenClaw 状态映射收口

范围：`packages/openclaw-adapter/`、`apps/companion/src/state/`、UI projection。

交付：

- 终态但无业务结果时转为 blocked。
- 历史 adapter job / backend mirror 复投影。
- UI 对 blocked / failed / waiting_acceptance 文案和按钮行为收口。

验收：

- `stop`、空结果、工具失败不会进入 `completed/waiting_acceptance`。
- waiting_acceptance 只表示“电脑端给出可验收结果”，仍需用户接受才 closed。

### 阶段 C：会话与回报闭环

范围：phone runtime、companion protocol server、bridge action。

交付：

- session 生命周期裁决与实现。
- `requestAcceptance` 在线/离线/回电合同。
- pending context 到张老板回报的闭环。

验收：

- 第一通连接后挂断，第二通可重新建立真实 session，不出现假阳。
- UI 点击“让张老板回报”后，用户能看到明确状态，并最终被张老板消费或被明确拒绝。

### 阶段 D：可观测性

范围：phone logger、desktop protocol logger、adapter evidence store、诊断 UI。

交付：

- `actionReceiptId` / `correlationId` 跨三端贯通。
- DTO 落盘索引。
- 诊断页链路视图。

验收：

- 任一 affairId/jobId/sessionId 可在三端日志中追到完整状态链。
- 报告“任务没创建/没授权/执行失败/等待验收/已关闭”时，都能给出机器证据。

## 6. 回归测试矩阵

| 场景 | 期望 |
|------|------|
| 连接成功后，模型未调用 create_job 却想说“已发任务” | 被话术门闩阻止或审计标红 |
| running affair + canceled current job 启动恢复 | affair 转 canceled/blocked 或不再 active |
| desktop mirror 与 phone affair 状态冲突 | reconciliation 记录冲突，不静默采用旧 active |
| OpenClaw terminal reason 为 `stop` | job blocked，reason 为 terminal_without_result |
| OpenClaw run completed 但无 task/tool/final result | job blocked，不进入 waiting_acceptance |
| 工具调用返回后仍有 active response | 不重复 response.create，不断线 |
| 第一通连接后挂断，第二通重新连接 | 旧 session 不假阳；新 session 有 generation/accepted 证据 |
| UI 离线请求张老板回报 | 返回 queued 或明确 session_required，不静默无反馈 |
| UI 在线请求张老板回报 | phone 收到 context，张老板复验 get_progress 后回报 |
| 用户接受验收 | 只有 waiting_acceptance + completed job 可 close |
| 用户取消运行中事务 | job cancel 和 affair canceled 单调，不被迟到 progress 复活 |

## 7. 结论

这批问题不是一个单点 bug，而是三层状态适配进入真实使用后暴露的系统性缺口：

- 张老板语言层可以越过工具证据，制造“任务已发/已关/已执行”的假成功。
- phone 事务簿对 active affair 的健康性检查不足，旧事务会污染新通话。
- adapter 曾把 OpenClaw runtime 的停止信号误判成业务完成。
- UI、pending context、电话回报之间没有统一合同。
- realtime response 生命周期缺少强串行化，导致工具调用后容易乱序。

下一轮修复应先打掉 P0：假成功门闩、active affair repair、OpenClaw completion evidence。否则继续叠 UI 或 prompt 都会在同一类状态假阳上反复出问题。
