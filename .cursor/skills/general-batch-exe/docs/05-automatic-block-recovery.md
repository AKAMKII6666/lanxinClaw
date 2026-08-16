# 自动阻断恢复（v0.5.0）

## 目标

普通 Fixer 预算耗尽或同一 verify 指纹反复失败后，gbx 不再立即把所有情况都交给人类。默认进入一条独立、有限、可审计的恢复链：

```text
FIX/VERIFY
   │ 原修复预算耗尽
   ▼
BLOCK_ANALYZE → BLOCK_REPAIR → BLOCK_VERIFY
      │               │              │
      └─ 不安全 ──────┴─ 越界 ──────┴─ 仍失败且恢复预算耗尽
                              ▼
                           BLOCKED
```

`BLOCK_VERIFY` 把状态交回原批次的 `VERIFY_BATCH` / `FULL_VERIFY`；机器门禁通过后从断点继续。旧版本留下的 verify/fix 类 `BLOCKED` 状态，在下次启动时也会自动重新打开一次分析流程。

若正式启动时执行索引存在可定位的 schema/字段错误，gbx 会使用独立
`.ai-workflow-preflight/` 报告目录进行一次严格恢复：唯一可批准路径是
`--exFile` 本身，修复后必须重新完整解析。`--dry-run` 始终只读，不启动
该恢复流程。

## 权限模型

阻断解决器没有更高的操作系统权限。它获得的是：

- 最近 verify/review、失败指纹、工作流日志和当前 diff；
- 与普通 Fixer 分离的恢复预算；
- 经脚本策略门批准的任务内路径集合。

`Block Analyzer` 只读业务源码，只能写 `reports/latest-block-analysis.json`。Node 编排器校验报告后才启动可写的 `Block Resolver`。

### cursor-agent 执行权限（v0.6.2+）

gbx 默认向 `cursor-agent` 传递 `--force` 与 `--trust`，以便 headless 批跑中自动批准 **shell** 与 **删文件**（例如 `git rm` 删除 `@deprecated` 空壳）。这与 gbx 策略门（批准路径集合）是两层：

| 层 | 控制什么 |
|----|----------|
| gbx `block_recovery` / `approved_paths` | 允许改哪些路径、何种分类 |
| `cursor-agent --force --trust` | CLI 是否拦截破坏性 tool call |

若 agent 日志出现 `File deletion rejected` / `Shell rejected`，检查 launch 行是否含 `force trust`；可用 `--no-agent-force` 或 `GBX_AGENT_FORCE=0` 关闭自动批准（改回交互式）。可选：`agent.approve_mcps: true`、`agent.sandbox: disabled`。

## 可自动恢复的分类

- `INDEX_SCHEMA_CORRUPTION`：机器字段或任务格式损坏，且修复不改变产品语义；
- `HARD_STOP_FALSE_POSITIVE`：明确的否定语境或旧报告措辞误判；
- `FIXER_ACCUMULATION`：多轮 Fixer 累积造成的本任务问题；
- `IN_SCOPE_VERIFY`：本任务及直接 import/test 闭包内的硬门禁；
- `PROJECT_DEPENDENCY_MISSING`：仅项目内、已声明依赖。

下列分类直接要求人工评审：

- `OUT_OF_SCOPE_MODULE`
- `EXTERNAL_ENVIRONMENT`
- `GBX_INTERNAL_FAILURE`
- `AUTH_OR_SECRET_REQUIRED`
- `UNKNOWN`

## 配置

```yaml
block_recovery:
  enabled: true
  max_attempts: 2
  min_confidence: high
  require_declared_scope: false
  dependency_policy: declared-only # none | declared-only
  deny_paths:
    - .cursor/skills/general-batch-exe/**
  task_scopes:
    M1-1:
      allowed_paths:
        - src/features/foo/**
      related_paths:
        - tests/foo/**
```

`require_declared_scope: true` 时，没有 `task_scopes` 的任务不会自动修。若未开启该选项，Analyzer 仍必须以 `high` 置信度声明完整 `requiredPaths`，策略门继续拒绝 gbx 自身、项目目录外和 deny_paths。

## 依赖恢复边界

`declared-only` 只允许在项目目录内使用当前 lockfile 对应的包管理器安装已经声明的依赖。禁止：

- `sudo`、全局安装、系统包管理器；
- 新增未经任务声明的包；
- 修改环境变量、代理、证书；
- 索取 Token、密钥或私有源登录。

## 越界检测

Resolver 启动前后，gbx 对 Git 可见的 tracked/untracked 文件计算内容快照。实际变化必须落在 Analyzer 批准路径内；workflow 运行产物除外。发现越界后立即进入 `BLOCKED` 并列出路径。

该检测是事后熔断，不是 OS 沙箱。高风险项目应同时：

1. 在执行索引为每个任务声明 `task_scopes`；
2. 在隔离 worktree/容器中运行 gbx；
3. 保留人工最终验收。

## 报告

| 文件 | 写入者 | 用途 |
|------|--------|------|
| `reports/latest-block-analysis.json` | Block Analyzer | 根因、分类、完整修改路径和范围证据 |
| `reports/latest-block-repair.json` | Block Resolver | 本轮修复结果和声明的改动 |
| `STATE.json` recovery 字段 | gbx | 独立预算、来源状态、恢复目标和批准路径 |

若无法安全恢复，终端文案明确区分“需要无关模块”和“需要项目外环境”，不会建议盲目 `--reset-state`。
