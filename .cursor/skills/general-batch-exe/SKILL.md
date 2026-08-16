---
name: general-batch-exe
description: >-
  External FSM orchestrator for batch Execute–Review–Repair loops via Node CLI
  (gbx). Use when the user asks for general-batch-exe, gbx, perfectbatch-ex,
  外置批执行, 受控 Ralph, Execute-Review-Repair Loop, or to run an execution index
  with --exFile outside the IDE chat. Independent of @batch-execute.
---

# general-batch-exe（外置批执行编排）

用 **独立 Node/JS CLI（`gbx`）** 驱动「执行 → 审查 → 修复 → 验证 → 全量审查」状态机。进度落在执行索引与工作目录文件上，每轮起干净 Agent 上下文。

**v0.7.0（doubao Windows merge）：** airpc 0.7 + 本仓 Windows 补丁（`resolveAgentCommand`、STATE 写盘重试、Win 默认 plain、hard_stop 否定语境）。普通 Fixer 熔断后自动进入阻断分析 → 策略门 → 受限修复 → 复验。

## 独立性（必须）

- **不依赖** `.cursor/skills/batch-execute/`（不 import、不调用、不复用其逻辑）。
- **不依赖** 宿主仓库 `package.json` / `node_modules`（本目录有自己的 `package.json`）。
- 可拷到任意项目；唯一必传的是 `--exFile`（可选 `--config`）。

与 IDE 内 `@batch-execute` 的差异见 [README.md](./README.md#与-batch-execute-的关系并列无依赖)。

## 何时使用

- 用户要 **CLI / 无人值守 / FSM 编排** 的批执行
- 用户提到：`gbx`、`general-batch-exe`、`--exFile`、受控 Ralph、Execute–Review–Repair

## Agent 接到本 skill 时应做的事

1. 确认可运行：`cd .cursor/skills/general-batch-exe && node bin/gbx.js --help`
2. **先核对执行索引格式**（见 [README.md](./README.md#给本-skill-的执行索引必须是什么格式)）；不合格则按 [`examples/minimal-execution-index.md`](./examples/minimal-execution-index.md) 补全，**不要开跑**
3. 确认 `--exFile`、`--workdir`（可选 `--config`）
4. 先 `--dry-run`，再正式跑：
   ```bash
   node bin/gbx.js --exFile <path> --workdir <root> --dry-run
   node bin/gbx.js --exFile <path> --workdir <root>
   # 默认直播 Agent／verify 输出；要静默：--quiet
   # 无 cursor-agent 时：--mock-agent（索引请用副本）
   # 需要 git checkpoint 时显式：--checkpoint（脏树会 BLOCKED）
  # 自动恢复仍判定需人工后：--clear-blocked --after-manual
  # 不要心跳刷屏：--no-heartbeat
   ```
5. **禁止**调用或改写 `batch-execute` skill


## 文档入口

| 文件 | 内容 |
|------|------|
| [README.md](./README.md) | 索引格式、CLI、顺利执行步骤 |
| [examples/minimal-execution-index.md](./examples/minimal-execution-index.md) | 可复制最小执行索引 |
| [examples/mock-happy-index.md](./examples/mock-happy-index.md) | mock 联调索引 |
| [docs/00-core-design.md](./docs/00-core-design.md) | 核心设计 |
| [docs/01-exfile-contract.md](./docs/01-exfile-contract.md) | 执行索引契约 |
| [docs/02-review-json.md](./docs/02-review-json.md) | 审查报告 JSON |
| [docs/03-verify-fix.md](./docs/03-verify-fix.md) | Verify 失败与 Fixer 契约 |
| [docs/04-hard-stop-and-resume.md](./docs/04-hard-stop-and-resume.md) | hard_stop 否定语境与 --clear-blocked |
| [docs/05-automatic-block-recovery.md](./docs/05-automatic-block-recovery.md) | 自动阻断分析、策略门与断点续跑 |
