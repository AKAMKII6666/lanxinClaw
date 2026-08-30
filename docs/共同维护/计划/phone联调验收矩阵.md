# Phone ↔ Companion 联调验收矩阵

> 目标：真机 phone 联调前逐条验收，覆盖协议、配对、会话、事务、权限、聊天、执行链与日志。
> 说明：companion 侧已实现的自托管 OpenClaw 执行链见 [OpenClaw自托管与捆绑.md](../技术设计/OpenClaw自托管与捆绑.md)；日志排障见 [日志系统.md](../技术设计/日志系统.md)。

## 0. 前置环境

- 启动自托管 gateway：onboarding 配置通过后自动拉起；或手动 `npm run dev:companion` + 完成配置门（默认千问：选地域/模型 + 粘贴 DashScope API Key，无需手填 baseUrl）。
- phone 侧（澜星电话主仓）实现：StoredAffair 落库、15 个张老板 FC、协议 client（discovery/pairing/session/消息）、mDNS browse、后台回电任务。
- 联调网络：companion 监听 `LANXIN_PROTOCOL_HOST=0.0.0.0`，电话与电脑同一局域网；防火墙放行协议端口。

## 1. 发现与配对

| # | 用例 | 期望 |
|---|------|------|
| 1.1 | phone mDNS browse 发现 companion | 广告含 `_lanxing-claw._tcp`、deviceName、pairingAvailable=true，无凭据/路径字段 |
| 1.1a | 张老板 `discover_desktops` → `prepare_desktop_connection` | 工具输出只含 candidateId/generation/fingerprint/电脑名，不含 wsUrl/IP；用户未确认时不发 pairing |
| 1.2 | `pairing.request` → challenge | challenge 含 nonce 与过期时间；过期后重发 request 可再次配对 |
| 1.3 | challenge 应答错误 | 配对失败，两端回到 unpaired，不建立 session |
| 1.4 | 双确认（phone confirmed + desktop approve） | 依次收到 desktop_approved、completed；identity 落盘 |
| 1.4a | 用户口头确认后 `confirm_desktop_connection` | 未配对时走 pairing；已配对时只走 session.open；均不得授予 job 权限 |
| 1.5 | 重启后重连 | 已配对身份持久化，无需重新配对；session.open 用 authProof 通过 |
| 1.6 | revoke | 撤销后停 delegator/cancel in-flight、清 connection、旧 session 失效 `[auto: reconnect-revoke + delegator]` |

## 2. 会话与门闩

| # | 用例 | 期望 |
|---|------|------|
| 2.1 | 未 session 发 affair/job/chat/permission | 返回 `session_required`，状态不写入 `[auto: protocol-server.test]` |
| 2.2 | 正确 session.open | 收到 session.accepted；**仅最新 socket 收业务流**（单活）`[auto: e2e]` |
| 2.3 | 错误 authProof | 收到 session.reauth_required（reopen），不授予 session |
| 2.4 | heartbeat 超时 | 本地标记断开；in-flight affair/job id 不丢失 `[auto: protocol-server.test]` |
| 2.5 | session.closed 后重连 | 用原 affairId/jobId 恢复，禁止盲目重放高风险写 |

## 3. 事务与执行链

| # | 用例 | 期望 |
|---|------|------|
| 3.1 | affair.create → update | affair 进入 store；非法状态迁移被拒（保留旧状态） |
| 3.1a | 正式事务前 `explore_desktop` | 发 `job.create(purpose=exploration)`；只允许只读 permission；completed 不进 waiting_acceptance |
| 3.2 | job.create → needs_permission | phone 收到 job.needs_permission；权限请求入桌面队列 `[auto: e2e]` |
| 3.3 | 授权 allow_for_job | 自动委派 adapter → phone 收到 job.accepted `[auto: e2e]` |
| 3.4 | worker 状态流 | progress → completed 依次推送；完成摘要无凭据 |
| 3.5 | job.completed ≠ affair.closed | affair 只到 waiting_acceptance，绝不自动 closed `[auto: mock job-lifecycle]` |
| 3.6 | 用户验收 | affair.close(status=closed)；取消走 status=canceled |
| 3.6a | `accept_affair` 前置门闩 | 只有 `waiting_acceptance + execution job completed + 用户接受摘要` 才能 close |
| 3.7 | blocked | job.blocked 含 blockedReason/resumeCondition；affair → blocked；resume 后继续 |
| 3.8 | cancel | job.cancel → adapter 取消 → 终态幂等；needs_permission 本地 cancel 不调 adapter `[auto: protocol-server.test]` |
| 3.9 | 幂等重放 | 同 messageId/affairId/jobId 重复事件不二次委派/二次关闭；**并发同 jobId 仅一份 pending** `[auto: job-create-transaction.test]` |
| 3.11 | 入站 identity | 伪造 source/target deviceId → `inbound_identity_mismatch` `[auto: inbound-guard.test]` |
| 3.10 | 真实 gateway 执行 | 自托管实例内 agent run 真实完成；断网关时失败可诊断 |
| 3.12 | 后台监督回电 | 通话结束后 active affair 转 background；job blocked/failed/completed 生成 `lanxin_claw_callback`；fire-time 复验 stale/terminal 后不外呼 |

## 4. 权限

| # | 用例 | 期望 |
|---|------|------|
| 4.1 | allow_once / allow_for_job / deny / require_more_context | 四类决策行为符合权限模型；deny 后广播 job.failed 不执行 `[auto: e2e deny + delegator.test]` |
| 4.2 | 权限范围 | workspaceHint 越界拒绝（workspace_scope_mismatch） |
| 4.3 | 授权权威 | 决策只在 companion gate；renderer 不能自行授予 |
| 4.4 | 审计 | 权限/配对/job 关键动作入审计，无凭据明文 |

## 5. 聊天

| # | 用例 | 期望 |
|---|------|------|
| 5.1 | chat.message 双向 | 文本可往返；untrusted，不当作系统指令 |
| 5.2 | chat.context_attach | target=affair 必须带 affairId；注入失败走 FC fallback |
| 5.3 | pending context | 队列可消费，消费后标记；空队列明确返回 empty |

## 6. Onboarding 与日志

| # | 用例 | 期望 |
|---|------|------|
| 6.1 | 未配置启动 | 只显示配置门（默认千问：地域/模型下拉 + API Key），主界面不可达 |
| 6.2 | key 无效 | 探针返回具体原因，停留在配置门；提交中表单锁定，失败后可再改 |
| 6.3 | key 有效 | 两级探针通过；Snackbar「配置成功」后进主界面；key 加密存储 |
| 6.4 | 已配置冷启动 | 全屏等待运行时就绪后再进主界面；失败可重试，不空进主壳 |
| 6.5 | 日志模块 | `npm run logs:ls` 各模块文件齐全；`logs:tail` 按模块可取 |
| 6.6 | 日志脱敏 | 抽查 protocol/adapter/runtime 日志无 apiKey/token/authProof 明文 |
| 6.7 | 排障闭环 | 出问题时按模块定位（如 adapter 模块看委派，runtime 模块看 gateway） |

## 7. 通过条件

- 以上用例全部通过；`npm run quality` 与 `npm run typecheck` 全绿。
- 模拟电话脚本 `npm run e2e:real-companion` 全链路通过。
- 发现/配对/会话/事务/执行链/日志六块边界与安全模型一致，无绕过路径。
