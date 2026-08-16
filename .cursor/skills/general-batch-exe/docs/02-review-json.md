# 审查报告契约（`reviews/latest.json`）

> 方案 B：Agent 写报告；**编排脚本**读本 JSON 更新 `STATE.json`。  
> 人类可读详述可同目录写 `batch-NNN.md`；**阶段切换以 JSON 为准**。

---

## 1. 文件位置

相对 `workflow_dir`（见执行索引 frontmatter）：

```text
reviews/latest.json          # 最近一次 Review / Verify 的机器结果（覆盖写）
reviews/batch-001.json       # 可选：按批归档
reviews/batch-001.md         # 可选：给人看的详述
reviews/final-review.json
```

编排器每次 REVIEW / FULL_REVIEW / VERIFY 结束后读取 `latest.json`（或角色约定写出的同名路径）。

---

## 2. Schema（目标 v0）

Batch Reviewer 与 Final Reviewer **使用不同的 `batchId` 契约**；不得共用含糊占位符 `"<n>"`。

### 2.1 Batch Reviewer

```json
{
  "schemaVersion": 1,
  "reviewRunId": "batch-reviewer-3-<uuid>",
  "role": "batch-reviewer",
  "batchId": "3",
  "exFile": "docs/.../执行索引.md",
  "result": "fail",
  "blocker": 0,
  "critical": 2,
  "major": 3,
  "minor": 1,
  "recommendedNextState": "FIX_BATCH",
  "summary": "两处契约映射与测试缺口",
  "issues": [
    {
      "id": "R3-1",
      "severity": "critical",
      "file": "app/server/foo.ts",
      "location": "fn bar ~L80",
      "description": "失败态未写入 mapping",
      "expectedBehavior": "失败时 state 保持可重试且 UI 可见",
      "suggestedVerification": "单元测试覆盖 fail 分支"
    }
  ],
  "checks": {
    "typecheck": "skipped",
    "lint": "skipped",
    "tests": "skipped",
    "behaviorChecks": "pass",
    "negativeChecks": "pass",
    "structureChecks": "pass",
    "baselineDelta": "0",
    "qualityEngine": "pass"
  },
  "notes": "只读审查；未改代码"
}
```

引擎批 Reviewer 应在 `checks`（或等价 notes）中覆盖：`behaviorChecks`、`negativeChecks`、`structureChecks`、`baselineDelta`、`qualityEngine`。`npm test` 通过但未跑 / 未过 `quality:engine` 至少记 major。

`batchId` = 当前批号字符串（与 prompt 中 `Current batch number` 一致）。

### 2.2 Final Reviewer

```json
{
  "schemaVersion": 1,
  "reviewRunId": "final-reviewer-final-<uuid>",
  "role": "final-reviewer",
  "batchId": "final",
  "result": "pass",
  "blocker": 0,
  "critical": 0,
  "major": 0,
  "minor": 0,
  "recommendedNextState": "READY_FOR_MANUAL_QA",
  "summary": "...",
  "issues": []
}
```

`batchId` **只能**是字符串 `"final"`。编排器校验 `role=final-reviewer + batchId=final + 当前 reviewRunId`；写批号（如 `"8"`）会导致 `BLOCKED`，**不会**放宽校验兼容数字。

### 字段说明

| 字段 | 要求 |
|------|------|
| `schemaVersion` | 数字；破坏性变更时递增 |
| `reviewRunId` | 必须逐字复制当前 Reviewer prompt 中的本轮 ID；缺失或不匹配时 BLOCKED |
| `role` | `batch-reviewer` \| `batch-verifier` \| `final-reviewer` \| `final-verifier` \| … |
| `batchId` | batch-reviewer → 批号字符串；**final-reviewer → 必须 `"final"`** |
| `result` | `pass` \| `fail` \| `blocked` |
| `blocker` / `critical` / `major` / `minor` | 非负整数；与 `issues` 一致为佳 |
| `recommendedNextState` | FSM 状态名建议；脚本可拒绝不合理跳转 |
| `issues[].severity` | `blocker` \| `critical` \| `major` \| `minor` \| `info` |
| `issues[]` | fail 时至少 1 条（blocked 可说明原因） |

---

## 3. 脚本如何切状态（示意）

```text
if result == "blocked":
  → BLOCKED
else if result == "pass" AND blocker==0 AND critical==0:
  → 若仍有未完成任务 → EXECUTE_BATCH
    否则 → FULL_REVIEW 或 READY_FOR_MANUAL_QA（按阶段）
else:
  → FIX_BATCH（若未超 max_fix_attempts）
    或 BLOCKED（超限）
```

`recommendedNextState` **仅作建议**；与计数矛盾时以计数 + 编排规则为准（防 Agent「建议直接完成」）。

编排器启动每轮 Reviewer 前会清除旧 `latest.json`，并同时校验 Agent exit code、`reviewRunId`、`role`、`batchId`、schema 与严重度计数。旧报告、错角色报告或 Reviewer 未产出报告均不得推进状态。

---

## 4. Markdown 详述（可选但推荐）

`batch-NNN.md` 每个问题包含：

- severity  
- file / location  
- description  
- expected behavior  
- suggested verification  

Fixer 提示词应要求：**先逐项核实 issues 是否仍成立，再改代码**。

---

## 5. Verifier 报告

Verifier 角色也应写 `latest.json`，例如：

```json
{
  "schemaVersion": 1,
  "role": "batch-verifier",
  "result": "pass",
  "blocker": 0,
  "critical": 0,
  "major": 0,
  "minor": 0,
  "recommendedNextState": "EXECUTE_BATCH",
  "checks": {
    "typecheck": "pass",
    "lint": "pass",
    "tests": "pass"
  },
  "issues": []
}
```

命令失败 → `result: "fail"`，并在 `issues` 或 `notes` 引用日志摘要；**不得**在测试红时写 `pass`。

---

## 6. 与 Orchestrator 的边界

| 谁 | 允许 |
|----|------|
| Reviewer / Verifier Agent | 写 `reviews/*`；**不写** `STATE.json` |
| Fixer / Executor | 改业务代码与执行索引勾选；**不写** `STATE.json` |
| `gbx` 进程 | 读 JSON、跑 verify 子进程、写 `STATE.json`、打 log、exit code |

此边界是本工具可靠性的核心，实现时不得放宽为「Agent 顺手改状态」。  
