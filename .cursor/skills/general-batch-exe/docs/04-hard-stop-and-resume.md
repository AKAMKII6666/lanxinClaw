# Hard-stop 与 BLOCKED 恢复（v0.6.1）

## 否定语境

`checkHardStop` 在匹配附近 ±120 字符内若出现下列否定语境，**不**触发 BLOCKED：

- 「非本仓／不做／禁止／后置／不算进…」
- 「未见／未改／未实现／未接入／不涉及」
- 「无 Host／无 调试…」

仍建议 pattern 写成行动句，例如：

```yaml
hard_stop_patterns:
  - "接入 Realtime|实现电话壳|对标迁移旧话机"
  - "接入 Host|真实保存|写盘闭环|PUT /api"
```

避免单独的 `Host 写口` / `Realtime`——Reviewer 写「未见 Host 写口」时容易误伤（否定词虽已放宽，行动句更稳）。

扫描前会把 cursor-agent `system/init` 元数据里的 `apiKeySource` 改写成中性字段名，避免 `API[ _-]?key` 误伤子串 `apiKey`。索引侧仍建议写成 `API[ _-]?key(?!Source)`。

## 自动恢复期间的扫描边界

`BLOCK_ANALYZE`、`BLOCK_REPAIR`、`BLOCK_VERIFY` 不运行常规 hard-stop
扫描。Analyzer / Resolver 的 prompt、报告必须引用原阻断原因；若继续扫描这些
元文本，会把引用误判成新违规，使 Resolver 在 spawn 前反复退回 Analyzer。

分析通过策略门后，`latest.json` 中已消费的旧审查证据会被清除；恢复交接时
也会清空恢复角色 stdout/stderr。完整审计仍保留在 prompt agent log、block
analysis 和 block repair 报告中。

v0.6.1 启动时还会修复 v0.6.0 循环遗留的
`recoveryResumeState=BLOCK_ANALYZE|BLOCK_REPAIR|BLOCK_VERIFY`：
普通批次回到 `VERIFY_BATCH`，全量修复回到 `FULL_VERIFY`。

## `--clear-blocked` / `--after-manual`

v0.5 会自动重新打开 verify/fix/checkbox/hard-stop 类的旧 `BLOCKED`
状态，先走阻断分析与策略门。若分析已经明确要求人工，或阻断类型不在
自动重开范围，仍使用以下人工恢复命令。

当 `STATE.status=BLOCKED`：

```bash
# 基础解锁：归档 stale reviews/latest.json，清空 agent stdout，再续跑
node bin/gbx.js --exFile … --workdir . --clear-blocked

# 人类已本机跑通 verify / 已把卡住批次勾成 ✅ 后：
node bin/gbx.js --exFile … --workdir . --clear-blocked --after-manual
```

若 BLOCKED 原因是 `checkbox_missing`（门禁已绿、索引未勾）：人工把 `activeTaskIds` 勾成 ✅，再用 `--clear-blocked --after-manual`。

行为：

| 条件 | 下一状态 |
|------|----------|
| 无剩余 ⬜ | `FULL_REVIEW` |
| `--after-manual` 且原 `activeTaskIds` 全 ✅ | `VERIFY_BATCH`（保留 active ids） |
| `--after-manual` 且原批次仍有 ⬜ | `FIX_BATCH`（常带 `fixTrigger=checkbox_missing`） |
| 其它 | `EXECUTE_BATCH` |

同时：

- 把 `reviews/latest.json` **归档**为 `latest-blocked-<stamp>.json`（避免 hard_stop 再扫旧 notes）
- 设 `skipHardStopOnce=true`，下一轮循环跳过一次 hard_stop 扫描
- 清空 `lastAgentStdout/Stderr`；重置 `checkboxFixAttempts` / `batchFixAttempts`
- 不可与 `--reset-state` 同时用

## 终端心跳（live）

默认仍直播 agent stdout/stderr。心跳仅在 **子进程静默满一个心跳窗口** 时打印，且不再刷完整 log 路径：

```text
[gbx] … executor:… still running (90s elapsed, no output for 30s)
```

`--no-heartbeat`：完全关闭周期性心跳（输出仍 live）。  
`--quiet`：旧行为，捕获到文件、不直播。
