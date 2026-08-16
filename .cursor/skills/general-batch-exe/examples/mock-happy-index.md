---
batch_size: 2
max_rounds: 40
max_fix_attempts: 2
max_full_fix_attempts: 2
stop_on_fail: true
group: order
verify_default:
  - 'node -e "process.exit(0)"'
read_first:
  - README.md
hard_stop_patterns:
  - "GBX_FORCE_HARD_STOP_TOKEN"
workflow_dir: .ai-workflow-mock
adapter: table
executor_extra: |
  Mock-friendly index for gbx --mock-agent.
reviewer_extra: |
  Write reviews/latest.json only.
---

# Mock happy-path execution index

## Tasks

| 状态 | ID | 任务 | verify |
|------|-----|------|--------|
| ⬜ | T1 | First mock task | node -e "process.exit(0)" |
| ⬜ | T2 | Second mock task | node -e "process.exit(0)" |
| ⬜ | T3 | Third mock task | node -e "process.exit(0)" |
