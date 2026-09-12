# OpenClaw 执行失败回报闭环

> 适用范围：张老板通话回报、后台回电、控制面板任务状态展示。  
> 依赖设计：[OpenClaw到Lanxin状态映射.md](OpenClaw到Lanxin状态映射.md)。

## 1. 目标

当 OpenClaw 没能完成用户目标时，系统必须把失败或阻塞透明传给用户：

- 通话还在时，张老板可即时说明状态；
- 通话结束后，后台监督可在状态变为 blocked/failed/completed 时触发回电；
- 控制面板能显示当前 job 不是“还在跑”或“完成了”，而是卡在哪里。

核心原则：

- 不成功也要回报。
- 不把 OpenClaw 自然语言解释伪装成结构化成功。
- 不暴露 token、原始工具参数、完整命令输出、敏感路径。
- 回报必须绑定当前 `affairId/jobId/runId`，不能拿旧结果说新事务。

## 2. 回报输入

张老板和 UI 消费 Lanxin job 事件，不直接消费 OpenClaw 私有状态。

推荐事件来源：

| 来源 | 内容 |
|------|------|
| `job.needs_permission` | 已把任务请求发到电脑端，但仍需用户在桌面授权 |
| `job.progress` | 正在做什么，最近看到什么进展 |
| `job.blocked` | 为什么卡住，需要用户做什么 |
| `job.failed` | 当前尝试为什么失败，是否可重试 |
| `job.completed` | worker 完成摘要，等待用户验收 |
| `job.canceled` | companion 已确认执行停止 |
| `affair.update` | affair 当前状态和监督模式 |

每个事件至少带：

- `affairId`
- `jobId`
- `status`
- `progressSummary`
- `blockedReason`
- `resumeCondition`
- `statusReasonCode`
- `statusObservedAt`

后续实现可在 companion 内部保留更丰富的 `evidence`，但 phone 协议只接收脱敏摘要。

## 3. 回报分类

| Lanxin 状态 | 张老板口径 | UI 口径 |
|-------------|------------|---------|
| `needs_permission` | “我已经把任务发到电脑端了，现在等你在电脑上授权。” | 等待授权，不显示执行中 |
| `running` | “我正在处理，刚刚进行到……” | 进行中，显示最近进度 |
| `blocked` | “这一步卡住了，需要你……” | 阻塞，显示原因和恢复条件 |
| `failed` | “这次尝试没成功，原因是……” | 失败，显示安全错误摘要 |
| `canceled` | “这件事我已经停下来了。” | 已取消 |
| `completed` | “我这边做完了一版结果，你看这样是否可以。” | 执行已结束，等待验收 |

`completed` 的措辞必须表达“电脑端产出了一版结果，等待确认”，不能说“事务已关闭”。只有用户验收后才说“这件事结束了”。

## 4. 失败原因映射

| OpenClaw 证据 | JobStatus | 张老板可说 |
|---------------|-----------|------------|
| policy/tool blocked | `blocked` | “电脑端策略挡住了这个动作。” |
| approval required | `needs_permission` | “这一步需要你在电脑端授权。” |
| missing capability/tool | `blocked` | “我现在没有这个能力，需要换一种做法或启用能力。” |
| auth/config/model issue | `blocked` | “电脑端配置还没准备好，需要先修配置。” |
| tool failed | `failed` | “工具执行失败了，我拿到了失败信号。” |
| terminal timeout | `failed` | “这次执行超时了，可以缩小范围或重试。” |
| wait-only timeout | `running` | “我还没等到最终结果，会继续盯着。” |
| run ok + final negative | `blocked` | “OpenClaw 回报说它没法按原方案完成。” |
| run ok/completed 但只有 `stop/ok/done` | `blocked` | “电脑端这轮停了，但没有拿到可验收结果，需要我复验或换个办法。” |

## 5. 通话中回报

通话仍在时：

- 收到 `job.needs_permission` 或 `companion.create_job` 返回 `needs_permission`，只能说明“任务请求已发送，等待电脑端授权”，不能说“已经开始执行”。
- 收到 `job.progress` 可短句插入，不打断用户主要表达。
- 收到 `job.blocked` 必须尽快说明，并请求用户选择下一步。
- 收到 `job.failed` 必须说明失败，不继续假装执行中。
- 收到 `job.completed` 进入验收话术。

话术模板：

| 场景 | 模板 |
|------|------|
| 等待授权 | “我已经把这件事发到电脑端了，现在需要你在电脑上授权，授权后我再继续盯。” |
| policy blocked | “我试了，电脑端这一步被策略拦住了：{reason}。你要我换个方式继续，还是先停一下？” |
| 缺权限 | “这一步需要你在电脑上授权 {permission}，授权后我才能继续。” |
| 工具失败 | “这次工具执行失败了：{summary}。我可以换一种办法再试。” |
| wait-only timeout | “我这边还没等到最终结果，会继续盯着，不先算完成。” |
| completed with result | “我这边已经做完一版：{summary}。你看看这样算不算可以？” |
| terminal without result | “电脑端这轮停了，但没给出可验收结果。你要我换个办法继续，还是先停一下？” |

## 6. 后台回电

通话结束后，phone 侧监督任务监听 job/affair 变化。

触发回电的状态：

- execution job `needs_permission`，用于提醒用户授权；回电前必须复验仍在等待授权
- execution job `blocked`
- execution job `failed`
- execution job `completed`

不触发回电：

- exploration job completed；
- affair 已 `closed/canceled`；
- job 已被新 job 替代；
- 当前状态与 callback task 记录的 expected 状态不一致；
- 电话当前忙或用户设置禁止打扰。

回电前必须复验：

- `affairId` 当前存在；
- `jobId` 是 affair 当前 job 或指定历史 job；
- `runId` 与当时事件一致；
- affair/job 状态仍匹配；
- 事件未过期，且未被用户读过或处理过。

回电话术：

| 状态 | 开场 |
|------|------|
| `needs_permission` | “刚才那件事还在等你电脑端授权，我回来说一下。” |
| `blocked` | “刚才那件事卡住了，我回来说一下原因。” |
| `failed` | “刚才那次电脑执行没成功，我回报一下。” |
| `completed` | “刚才交代的事我这边做完一版了，需要你确认一下。” |

## 7. 控制面板展示

控制面板展示要避免假成功：

- `job.completed` 标签显示“执行已结束”，同时明确事务仍待验收。
- `job.needs_permission` 标签显示“等待电脑端授权”，不得合并成 running。
- affair `waiting_acceptance` 标签显示“待验收”。
- `job.blocked` 显示 `blockedReason` 和 `resumeCondition`。
- `job.failed` 显示最近失败摘要和可重试提示。
- `running` 超过监督阈值但无新证据时显示“观察中/等待 OpenClaw 回报”，不显示“成功”。

展示脱敏：

- 不显示 Gateway token、API key、pairing secret。
- 不显示完整 tool args。
- 原始路径按安全策略裁剪，必要时只显示用户提供过的 workspace 名称。
- 原始错误仅用于本机日志，UI 和 phone 使用摘要。

## 8. 当前浏览器案例

用户目标：让 OpenClaw 打开浏览器新闻页。  
观察：OpenClaw 没有成功打开，最终反馈浏览器导航受策略限制，并建议改用搜索/抓取新闻内容。

正确回报：

- UI：`blocked`，原因“浏览器导航被 OpenClaw 策略限制”。
- 张老板： “我试了，直接打开浏览器新闻页被电脑端策略拦住了。可以换成搜索/抓取新闻内容来继续，你要我这样做吗？”
- 后台：如果通话已结束，生成 blocked 回电任务；回电前复验 job 仍 blocked。

不正确回报：

- 继续显示 running；
- 显示 completed；
- 张老板沉默；
- 张老板说“已经打开了”。

## 9. 验收标准

- 任意失败/阻塞都能进入 `job.blocked` 或 `job.failed`。
- `needs_permission` 能在 phone 与 UI 中显示为等待授权，并可在通话后进入回电提醒。
- `agent.wait ok` 不会直接导致“已完成”文案。
- `agent.wait ok` 只有在同时携带可验收业务结果证据时才会进入 `job.completed`。
- `agent.wait ok/completed` 但只有 `stop/ok/done/endedAt` 时进入 `job.blocked`，不得进入待验收。
- 通话中能回报最新状态。
- 挂机后 blocked/failed/completed 能进入回电闭环。
- 控制面板与 phone 看到的状态一致。
- 所有回报都能追溯到当前 `affairId/jobId/runId`。
