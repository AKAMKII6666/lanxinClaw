# OpenClaw 状态研究审查

> 审查日期：2026-08-29  
> 审查对象：OpenClaw 状态研究文档包。  
> 审查方法：按研究计划逐项对照，优先找 P0/P1/P2 缺口。

## 1. 计划对照

| 计划项 | 证据 | 结论 |
|--------|------|------|
| OpenClaw 状态事实盘点 | `OpenClaw状态研究记录.md` | 已覆盖 run、event、task、flow、audit、history、tool |
| 正式研究计划 | `OpenClaw任务状态研究计划.md` | 已列研究问题、来源优先级、输出物和审查标准 |
| 创建任务/run 用法 | `OpenClaw状态研究记录.md`、`OpenClaw状态观测与探针.md` | 已说明 `agent`、`idempotencyKey`、`in_flight` |
| run 状态与 `agent.wait` | `OpenClaw状态研究记录.md` | 已说明 `ok/error/timeout` 与内部 reason |
| task 状态与 task 类型 | `OpenClaw状态研究记录.md` | 已说明 task 来源、内部状态、RPC 映射 |
| 状态探针 | `OpenClaw状态观测与探针.md` | 已覆盖 event、wait、audit、task、history |
| 状态映射 | `OpenClaw到Lanxin状态映射.md` | 已给决策表和特殊规则 |
| 失败回报 | `OpenClaw执行失败回报闭环.md` | 已给 UI/张老板/回电口径 |
| 后续执行计划 | `OpenClaw任务状态适配计划.md` | 已给 adapter、companion、phone、测试计划 |
| 更新旧设计 | `执行引擎集成.md`、`OpenClaw自托管与捆绑.md`、`OpenClaw勘探记录.md` | 已复查，新口径已覆盖旧入口 |

## 2. 对抗发现

### P0：无

未发现会导致“OpenClaw worker 完成直接关闭 affair”的文档指令。

### P1：无

未发现以下高风险问题：

- 把 `agent.wait ok` 直接作为 `job.completed` 充分证据；
- 把 `agent.wait timeout` 无条件视为 still running；
- 要求读取 OpenClaw 私有 SQLite/transcript 作为生产接口；
- 允许 phone 绕过 companion 权限层；
- 允许旧 run 事件推进新 job。

### P2：需要后续实现阶段验证

这些不是研究文档缺口，但实现时必须验证：

- 真实 Gateway 是否按当前版本稳定发送 `tool-events`；
- `audit.activity.list` 在本地 vendored 版本是否缺失；
- task RPC `failed` 是否足够区分内部 `lost`；
- final negative text 的弱阻塞分类需要保守词表和测试样本；
- 实机浏览器 policy blocked 是否能通过 audit/tool event 稳定观测。

## 3. 研究完成判定

完成。

原因：

- 状态枚举均有源码或官方文档来源。
- 线上文档与本地 `openclaw@2026.7.1-2` 的差异已记录。
- 已明确 run、task、tool、audit、history 与 Lanxin job/affair 的边界。
- 已给出后续实现需要的证据模型、探针顺序、映射表和测试场景。
- 剩余事项属于后续代码实现和实机联调验证，不阻断研究文档闭环。
