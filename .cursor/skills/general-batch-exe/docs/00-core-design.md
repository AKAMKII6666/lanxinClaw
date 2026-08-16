# general-batch-exe — 核心设计思想

> **状态：** 设计定稿（实现分阶段）  
> **运行时：** 本 skill 目录内独立 Node（纯 JS），CLI 名 `gbx`  
> **依赖关系：** 与宿主项目、`@batch-execute` **零依赖**；执行索引路径由 `--exFile` 注入

---

## 1. 要解决什么问题

长任务如果只靠「对话里让 Agent 继续」，会出现：

- 上下文被实现 + 审查 + 修复污染
- Agent 自称完成，但无机器验收
- 同一错误反复打转
- 审查者与实现者同思维盲区
- 无限循环消耗额度

本工具的目标不是「让 Cursor 一直干到完成」，而是：

> **Batch Execute–Review–Repair Loop**  
> 有限状态机 + 多角色 Agent + 机器验收门槛 + 有限重试 + 人工终验

经典「裸 Ralph」（`while true; cursor-agent 同一 prompt`）是其中一种弱实现；本设计是 **分阶段受控 Ralph**。

---

## 2. 四层能力分离

| 能力 | 解决的问题 | 本工具是否内置 |
|------|------------|----------------|
| Subagent / 角色 Prompt | 专业分工、上下文隔离 | 是（角色模板 + 调用不同 agent 配置） |
| Worktree（可选） | 同批互不冲突任务的文件隔离 | 后续可选；默认单 workdir 顺序 |
| Loop | 多轮持续 | 是（有限迭代） |
| Orchestrator | 决定下一步调用谁、何时停 | **是（本工具主语）** |

主调度器 **不大量写业务代码**；它只读执行索引与报告、切换状态、启动角色、执行停止规则。

---

## 3. 状态机（主流程）

```text
PLAN_APPROVED
      │
      ▼
EXECUTE_BATCH
      │
      ▼
BATCH_REVIEW
      │
      ├── 有问题 ──▶ FIX_BATCH ──▶ VERIFY_BATCH
      │                            │
      │                            └── 仍有问题 → FIX_BATCH（有上限）
      │
      └── 通过
            │
            ▼
      是否还有任务？
       │          │
       是         否
       │          │
       ▼          ▼
EXECUTE_BATCH   FULL_REVIEW
                   │
                   ├── 有问题 → FULL_FIX → FULL_VERIFY
                   │
                   └── 通过 → READY_FOR_MANUAL_QA

普通 Fixer 预算耗尽 / 同指纹反复失败
                   │
                   ▼
            BLOCK_ANALYZE（只读）
                   │ 策略门允许
                   ▼
            BLOCK_REPAIR（受限写）
                   │
                   ▼
            BLOCK_VERIFY → 返回批次/全量 VERIFY
```

只有策略门判定越界、涉及项目外/gbx 自身/授权，或恢复预算也耗尽时，才进入 `BLOCKED`（需人介入）。

**关键原则：Agent 不能仅靠自报「完成」结束阶段。**  
阶段切换由编排脚本根据 **机器可验证条件** 决定。

---

## 4. 角色（每轮干净上下文）

| 角色 | 职责 | 工具约束（目标） |
|------|------|------------------|
| Orchestrator | 读 STATE、起角色、解析报告、改状态 | 本进程（Node），不是 Agent |
| Executor | 只实现当前 ACTIVE 批次；跑 verify；更新勾选 | 可写目标仓 |
| Reviewer | 审 diff / 需求符合度；只写审查报告 | **只读**目标仓源码 |
| Fixer | 只根据审查报告修确认成立的问题 | 可写；禁止顺手大重构 |
| Verifier | 重跑验收命令；核对勾选与报告关闭项 | 以命令输出为准 |
| Final Reviewer | 全量闭环、跨模块一致、临时兼容、漏测 | 只读 + 写 final-review |
| Block Analyzer | 重建阻断前事实、分类并声明完整修改路径 | 业务源码只读；只写 analysis 报告 |
| Block Resolver | 仅在策略批准路径内解决阻断 | 可写批准范围；独立有限预算 |

角色 Prompt 从执行索引的 `read_first`、正文约束、`--config` 拼出；**项目特化规则不写死在编排核里**。

---

## 5. 状态放哪里

进度 **不保存在聊天上下文**，而保存在磁盘：

```text
（相对 --workdir 或 --exFile 旁的 workflow 目录，具体布局由实现约定）
STATE.json              # 当前 FSM 状态；仅编排脚本写入
执行索引.md              # --exFile；任务勾选、批次、验收、必读
reviews/                # 批次 / 终审报告（md + latest.json）
reports/                # 执行与修复纪要
logs/loop.log           # 编排日志
```

`STATE.json` 概念示例：

```json
{
  "status": "BATCH_REVIEW",
  "currentBatch": 3,
  "totalBatches": 8,
  "batchFixAttempts": 1,
  "fullReviewAttempts": 0,
  "lastSuccessfulCommit": "abc1234",
  "manualQaRequired": false,
  "exFile": "docs/.../执行索引.md"
}
```

---

## 6. 谁改 STATE：方案 B（推荐，已定为默认）

| 方案 | 做法 | 本工具态度 |
|------|------|------------|
| A | Agent 自己改 STATE | 不用作默认（会跳阶段「假完成」） |
| **B** | Agent 输出结构化报告；**脚本** `jq`/Node 更新 STATE | **默认** |

原则：

> Agent 提供事实和建议；脚本掌握流程控制权。

审查结果最小出口见 [02-review-json.md](./02-review-json.md)。

---

## 7. 完成与强制停止

### 正常完成（进入 READY_FOR_MANUAL_QA 的典型条件）

- 执行索引中约定的任务已勾选完成  
- 索引 / config 声明的 verify 命令全部成功；FULL_FIX 后重跑全部任务级与默认命令  
- 全量审查无 blocker / critical（或按索引阈值）  
- FULL_VERIFY 通过  

### 自动恢复后仍强制停止（示例）

- 超过最大循环次数 / 单批最大修复次数  
- 同一错误签名连续 N 次  
- 自动分析确认 verify 需要修改无关模块
- 索引声明的 hard-stop 是真实需求冲突而非措辞误判
- 需要密钥、授权、项目外环境或修改 gbx 自身
- 阻断恢复预算耗尽
- 工作区出现无法判断的外部改动（可选策略）  

### 回滚

- 启动时由 **编排脚本** 确认业务工作树干净；每批 review + verify 通过后做 Git checkpoint（若开启），并排除 workflow 运行产物  
- `reset --hard` **禁止**交给业务 Agent 自由执行；仅脚本在明确策略下执行  

---

## 8. 并行策略（默认关闭）

默认 **同批顺序**。并行仅当：

- 任务标记为可并行，且  
- 不共享热点文件，且  
- 有独立 worktree（后续阶段）

合并进 integration 后再 REVIEW。纯调查 / 多维只读审查可优先并行。

---

## 9. 通用核 vs 项目注入

```text
通用核（本仓库本 skill）
  FSM、角色调度、读报告、写 STATE、重试上限、CLI、agent runner 适配

项目 / 本次运行注入
  --exFile     任务 + 本批必读 + 本批 hard-stop 覆盖
  --config     跨多份索引复用的项目默认（可选）
```

**SlimVID 安全/协议 hard-stop 不写死在核里**；写在该项目的执行索引或 `workflow.project.yaml`。换项目只换文件，不换编排器。

执行索引契约见 [01-exfile-contract.md](./01-exfile-contract.md)。

---

## 10. 实现分期（产品路线）

| 阶段 | 能力 | 状态 |
|------|------|------|
| 0 | 独立 `package.json`、CLI、文档 | **done** |
| 1 | 解析 frontmatter、STATE、单 batch：EXECUTE→REVIEW→FIX→VERIFY | **done** |
| 2 | 批次自动推进；hard-stop；Git checkpoint | **done** |
| 3 | FULL_REVIEW / FULL_FIX / FULL_VERIFY → READY_FOR_MANUAL_QA | **done** |

Agent runner：`cursor-agent -p`（`lib/agent/runner.js`）；测试用 `--mock-agent`。Worktree 并行仍为非目标。

---

## 11. 非目标

- 不替代人工最终验收（`READY_FOR_MANUAL_QA` 是设计出口）  
- 不强制所有 Markdown 任务表格式同一；通过 adapter 兼容几种约定  
- 不绑定某个 monorepo 目录结构  
- **不依赖也不扩展** `@batch-execute` skill（二者并列，见 README）  
