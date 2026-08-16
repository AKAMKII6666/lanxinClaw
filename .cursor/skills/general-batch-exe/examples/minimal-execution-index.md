---
# 复制本文件后：改 read_first / verify / 任务表；作为 --exFile 传入。
# 编码 UTF-8。文首本 YAML 与下方任务表缺一不可（顺利跑通模式）。

batch_size: 3
max_rounds: 40
max_fix_attempts: 5
max_ineffective_fixes: 2
stop_on_fail: true
group: order

verify_default:
  - npm run typecheck

read_first:
  - README.md

hard_stop_patterns:
  - "待确认|协议未定|需要人工"

# 普通 Fixer 耗尽后的自动阻断恢复；正式项目建议逐任务声明路径。
block_recovery:
  enabled: true
  max_attempts: 2
  min_confidence: high
  dependency_policy: declared-only
  task_scopes:
    M1-1:
      allowed_paths:
        - src/features/example/**
      related_paths:
        - tests/example/**

executor_extra: |
  只实现当前 ACTIVE / 本轮选出的任务；不要改需求口径与本索引 frontmatter 语义。
  完成后把对应行 ⬜ 改为 ✅，并跑 verify。
reviewer_extra: |
  只读审查；禁止改业务代码。写出 reviews/latest.json（见 general-batch-exe/docs/02-review-json.md）。
fixer_extra: |
  只根据审查报告修确认成立的问题；禁止顺手重构。

workflow_dir: .ai-workflow
adapter: table
---

# 示例里程碑 — 执行索引

> **用法：** `gbx --exFile <本文件路径> --workdir <项目根> [--dry-run]`  
> **说明：** 本文件是 general-batch-exe 可复制最小模板；把任务改成真实项后再跑。

## 0. 已钉死口径（给人看；与 read_first 对齐）

- 需求真源：……
- 编码规范：……
- 本索引禁止：改生产密钥、擅自改协议未定项

## 1. 任务表

| 状态 | ID | 任务 | verify |
|------|-----|------|--------|
| ⬜ | M1-1 | （改成真实任务） | npm run typecheck |
| ⬜ | M1-2 | （改成真实任务） | npm run typecheck |
| ⬜ | M1-3 | （改成真实任务） | npm run typecheck |

## 2. 批次出口（每批结束后）

- 本批任务均为 ✅
- `verify_default` / 任务 `verify` 命令 exit 0
- Reviewer：`reviews/latest.json` 中 `blocker=0` 且 `critical=0`
