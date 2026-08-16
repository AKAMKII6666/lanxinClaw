# 执行索引契约（`--exFile`）

> 本文件定义编排器可机器消费的 **最小约定**。  
> 正文仍可写人类可读说明；**frontmatter（或 companion YAML）是脚本真源**。

---

## 1. 单一入口原则

```bash
gbx --exFile path/to/执行索引.md [--config path/to/workflow.project.yaml] [--workdir .]
```

- `--exFile`：本次运行的 **宪法**（任务、批次、默认验收、必读文档、本批约束）  
- `--config`：可选；跨多份索引复用的项目默认（hard-stop、模型、max_iterations 等）  
- 合并优先级：**CLI 显式参数 > exFile frontmatter > --config > 内置默认**

编排器 **不** 从宿主仓库硬编码路径读取 SlimVID 文档；要看什么、遵守什么，写在索引里。

---

## 2. Frontmatter 最小字段（目标 schema）

**必须从文件第 1 行开始**为 `---` YAML 块；标题与说明写在闭合 `---` **之后**（否则多数解析器不认 frontmatter）。

面向使用者的格式说明与顺利执行步骤见 [../README.md](../README.md#给本-skill-的执行索引必须是什么格式)；可复制模板见 [../examples/minimal-execution-index.md](../examples/minimal-execution-index.md)。

文首 YAML 建议字段：

```yaml
---
# --- 批次控制 ---
batch_size: 3
max_rounds: 40
max_fix_attempts: 2
stop_on_fail: true
group: order          # order | milestone（与实现同步演进）

# --- 默认机器验收（任务未写 verify 时使用）---
verify_default:
  - npm run typecheck
  - npm run lint

# --- 每轮角色必读（注入 Executor / Reviewer prompt）---
read_first:
  - path/to/REQUIREMENTS.md
  - path/to/coding-rules.md

# --- 硬停：命中则写入 BLOCKED，不自动 FIX 猜 ---
hard_stop_patterns:
  - "协议未定|待确认"
  - "需要人工|密钥|生产数据"

# --- 普通 Fixer 耗尽后的自动阻断恢复（可选，默认开启）---
block_recovery:
  enabled: true
  max_attempts: 2
  min_confidence: high
  dependency_policy: declared-only
  task_scopes:
    M1-1:
      allowed_paths: [src/foo/**]
      related_paths: [tests/foo/**]

# --- 角色附加（可选）---
executor_extra: |
  只实现 ACTIVE 批次；不要改需求文档。
reviewer_extra: |
  禁止修改业务代码；审查结果写入约定 JSON。
fixer_extra: |
  只修审查报告中确认成立的问题。

# --- 工作流落盘（相对 --workdir；可选）---
workflow_dir: .ai-workflow
---
```

无 frontmatter 时拒绝运行。正式 FSM 必须通过 frontmatter 显式给出批次、验证与 workflow 契约。

---

## 3. 正文任务形式（adapter）

编排器通过 **adapter** 解析，不要求全世界同一版式。优先支持：

### A. 状态表格（常见）

```markdown
| 状态 | ID | 任务 | verify |
|------|-----|------|--------|
| ⬜ | M1-1 | 实现 xxx | npm run typecheck |
| ✅ | M1-2 | 已完成 | — |
```

- 待办：`⬜` / `- [ ]` / `[ ]`  
- 完成：`✅` / `- [x]` / `[x]`  

### B. Checkbox 列表

```markdown
- [ ] M1-1 实现 xxx
- [x] M1-2 已完成
```

### C. 显式 Batch 块（推荐用于 FSM）

```markdown
## Batch 3：压缩任务轮询

Status: ACTIVE

### Tasks

- [x] 增加压缩状态查询接口
- [ ] 处理失败状态

### Automated checks

- `npm run typecheck`
- `npm test -- compression`

### Exit criteria

- 所有任务已勾选
- Automated checks 通过
- Reviewer 无 blocker / critical
```

`--adapter` 或自动探测：`table` | `checkbox` | `batch-block`。

---

## 4. 正文中的人类说明

鼓励写清：

- 需求链接与「已钉死口径」  
- 编码规范 / 分层边界（可与 `read_first` 重复强调）  
- 验收标准与手动 QA 项  
- 本索引 **禁止** Agent 做的事  

人读段落不替代 frontmatter 列表：脚本必须能把 `read_first` / `hard_stop_patterns` 注入 prompt 与停条件。

---

## 5. 与 `--config` 的分工

`block_recovery.task_scopes` 可以放在单次执行索引，也可以放在项目
config。涉及多个模块的长任务建议按 task ID 声明 `allowed_paths` 与
`related_paths`；设为 `require_declared_scope: true` 后，未声明范围的任务
会直接要求人工评审。完整策略见
[05-automatic-block-recovery.md](./05-automatic-block-recovery.md)。

| 内容 | 优先放哪 |
|------|----------|
| 本里程碑任务与批次 | `--exFile` |
| 全公司/全仓默认 verify、模型、max_iterations | `--config` |
| 该仓安全 hard-stop（计费、OAuth、契约） | `--config` 或索引覆盖 |
| 单次临时加严 hard-stop | `--exFile` frontmatter |

示例 `workflow.project.yaml`（概念）：

```yaml
verify_default:
  - npm run typecheck
max_fix_attempts: 2
hard_stop_patterns:
  - "billing|subscription|oauth"
  - "docs/AI文档/"
agent:
  command: cursor-agent
  print_flag: -p
```

---

## 6. 运行时目录（目标）

当 `workflow_dir: .ai-workflow`（或默认值）时：

```text
.ai-workflow/
├── STATE.json
├── GUARDRAILS.md          # 可选：从索引渲染的本次约束快照
├── reviews/
│   ├── batch-001.md
│   ├── latest.json        # 机器读；见 02-review-json.md
│   └── final-review.md
├── reports/
└── logs/
    └── loop.log
```

执行索引本身可位于 `docs/...`；不必搬进 `.ai-workflow/`。

---

## 7. 不合格索引（编排器应拒绝或降级）

- 路径不存在  
- 无法解析出任何待办，且未声明「仅 FULL_REVIEW」  
- 既无 `verify_default` 又无任务级 verify，又要求自动推进（应 BLOCKED 或要求人补）  
- frontmatter YAML 语法错误  
- **高风险引擎任务**缺少落点声明（见 §8）时，dry-run / Reviewer 应标为不可执行，而非让 Executor 猜落点  

---

## 8. 高风险引擎任务声明（本库质量门禁对接）

涉及 Resolver / EffectExecutor / Schedule / StorySave / Profile 隔离 / schemaVersion 的任务，执行索引正文或任务备注须写明：

```text
行为目标：要实现什么
目标模块：主要逻辑放在哪里
允许修改：哪些文件/目录
禁止落点：不得继续塞入哪些上帝模块（如 createEngineHost / scheduleTick / effectExecutor）
状态不变量：必须保持什么
回归测试：至少哪些负向/恢复场景
verify：npm run quality:engine
结构预算：是否触碰历史基线，指标只能持平或下降
```

引擎批默认 verify 应为 `npm run quality:engine`（本库根命令），不是单独的 `npm test`。结构门禁真源在本库 `scripts/engine-quality/`，不在本 skill 内实现。

---

## 9. 拷到其它项目时

1. 复制整个 `general-batch-exe` 目录（自带 `package.json`）  
2. 准备该项目自己的执行索引（遵守本契约）  
3. `node bin/gbx.js --exFile ... --workdir <那个项目根>`  

无需安装宿主项目依赖，也无需存在 `batch-execute` skill。  
