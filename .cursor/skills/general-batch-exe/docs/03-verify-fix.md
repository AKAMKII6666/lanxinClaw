# Verify ↔ Fix 契约（v0.5.0）

> 解决：Reviewer `pass` 但机器 verify 失败时，Fixer 只读 `reviews/latest.json` 导致空转直至预算耗尽。  
> **v0.4.4：** 「门禁绿但未勾选」与「门禁红」分轨，避免误报 `batch verify failed` 并烧光硬修预算。

## 真源

| 文件 | 谁写 | 谁读 |
|------|------|------|
| `reviews/latest.json` | Reviewer | Fixer（始终） |
| `reports/latest-verify.json` | gbx `runVerifyCommands` | Fixer（`fixTrigger` 含 `verify` 时**强制**）；BLOCKED 打印 |
| `reports/<label>-<ts>.json` | gbx | 审计副本 |

## STATE 关键字段

- `fixTrigger`: `review_fail` \| `verify_fail` \| `checkbox_missing` \| `full_review_fail` \| `full_verify_fail`
- `lastVerifyOk` / `lastVerifySummary` / `lastVerifyFingerprint` / `lastVerifyReportPath`
- `ineffectiveFixStreak`: 同 fingerprint 连续失败计数（仅硬 verify 红）
- `checkboxFixAttempts`: 脚本已绿、索引仍 ⬜ 时的修复计数

## 两道闸（VERIFY 后）

| 条件 | 含义 | 预算 | `fixTrigger` |
|------|------|------|----------------|
| `!verifyOk` | 命令 exit ≠ 0 | `batchFixAttempts` / `max_fix_attempts` | `verify_fail` |
| `verifyOk && !checksOk` | 脚本绿、任务未 ✅ | `checkboxFixAttempts` / `max_checkbox_fix_attempts`（默认 **2**） | `checkbox_missing` |
| 两者都 OK | 批通过 | 清零两侧计数 | — |

`checkbox_missing` **不**占用硬修 `batchFixAttempts`。BLOCKED 文案写清 missing IDs，不以 WARN/告警线为主因。

## 普通 Fixer 熔断条件

1. 硬红：`batchFixAttempts >= max_fix_attempts`（默认 **5**）
2. 勾选缺口：`checkboxFixAttempts >= max_checkbox_fix_attempts`（默认 **2**）
3. `ineffectiveFixStreak >= max_ineffective_fixes`（默认 **2**）— 同一硬 verify 指纹反复失败

v0.5 起，上述条件先进入 `BLOCK_ANALYZE`，不会直接等同于人工
`BLOCKED`。只有分析判定越界/外部环境/gbx 自身问题，或独立
`block_recovery.max_attempts` 预算也耗尽后才终止。见
[05-automatic-block-recovery.md](./05-automatic-block-recovery.md)。

## Executor 硬句

门禁命令全部 exit 0 的**同一轮**必须把 active 任务 ⬜→✅；否则本轮未完成。仅当摘要含 `verify NOT run` / Shell denied 时允许留 ⬜。

## Fixer 与 Studio 门禁

`verify_fail` 时 Fixer **必须**以 `reports/latest-verify.json` 为准：

- `errorLocations` 含 `severity: error|warn`；告警线 WARN 不得作为本轮唯一修复目标。
- excerpt 含 `studioQualityTail`；优先硬 STRUCT / TS。
- `checkbox_missing`：**只勾选**，禁止重构、禁止追 WARN。

## Fixer 优先级

1. `fixTrigger=checkbox_missing` → 只勾选  
2. `latest-verify.json` 且 `ok=false` → 修硬错  
3. review 未解决 blocker/critical/major  

禁止：verify 仍红时因 `review.result=pass` 宣称无活。
