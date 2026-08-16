# general-batch-exe

外置 **Batch Execute–Review–Repair** 编排器（CLI：`gbx`）。

用独立 Node（纯 JS）状态机循环启动 Agent 角色：执行批次 → 审查 → 修复 → 验证 → 全量审查。进度写在执行索引与 workflow 文件上，而不是聊天上下文。

**当前版本：`0.5.0`** — 普通 Fixer 预算耗尽后进入 `BLOCK_ANALYZE → BLOCK_REPAIR → BLOCK_VERIFY`；策略门允许任务内阻断自动修复并断点续跑，越界/项目外/gbx 自身问题才交给人类。

- 真机跑：本机安装并登录 Cursor CLI 后，用默认 `cursor-agent -p`
- 无 CLI / CI：加 `--mock-agent`（见 `examples/mock-happy-index.md`）
- 自测：`cd .cursor/skills/general-batch-exe && npm test`

## 常用命令

在本 skill 目录下执行（或把 `node bin/gbx.js` 换成已 `npm link` 的 `gbx`）：

```bash
node bin/gbx.js --exFile <索引.md> --workdir <项目根> --dry-run
node bin/gbx.js --exFile <索引.md> --workdir <项目根>          # 需 cursor-agent
node bin/gbx.js --exFile <副本.md> --workdir <根> --mock-agent
```

| 命令 | 用途 |
|------|------|
| 带 `--dry-run` | 只解析执行索引、校验 `read_first` / verify；不启 Agent |
| 无额外 flag | 正式 FSM；每轮 spawn `cursor-agent`（prompt 写入临时文件，argv 只传短指针） |
| `--mock-agent` | 无 CLI 时联调状态机；**会改执行索引勾选**，请用副本 |

Git checkpoint **默认关闭**。需要时显式 `--checkpoint`：启动时业务工作树必须干净；每批 review + verify 通过后才提交，并排除 workflow 运行产物。

---

## 怎样才能让本 skill 顺利执行（总览）

1. **准备一份合格执行索引**（UTF-8 Markdown，含 frontmatter + 可勾选任务 + 可跑的 verify）  
2. **`read_first` / verify 命令相对 `--workdir` 真实存在且能跑**  
3. **用 CLI 或 Skill 把 `--exFile` 指到该文件**（不要只丢一段散文需求）  
4. 正式循环开启后：Agent **不得**只口头说完成——须勾选 + verify 过 +（审查轮）写带本轮 `reviewRunId` 的 `reviews/latest.json`

复制起步模板：

[`examples/minimal-execution-index.md`](./examples/minimal-execution-index.md)

契约全文：[docs/01-exfile-contract.md](./docs/01-exfile-contract.md)

---

## 给本 skill 的执行索引：必须是什么格式

### 文件形态

| 项 | 要求 |
|----|------|
| 类型 | **单个 Markdown 文件**（`.md`） |
| 编码 | UTF-8 |
| 传参 | `--exFile <绝对或相对 --workdir 的路径>` |
| 角色 | 本次运行的 **唯一任务真源**（任务、批次、验收、必读、硬停） |
| Frontmatter 位置 | **文件第 1 行**必须是 `---`；标题/说明写在闭合 `---` **之后** |

本工具 **不会** 自动去翻宿主仓库里的「某份 v1.1 执行索引」；你不传 `--exFile`，就无法正式跑。

### 结构：三段式（推荐 = 顺利模式）

```text
① YAML frontmatter（文首 --- ... ---）   ← 机器读：批次 / verify / 必读 / 硬停
② 人类说明（口径、需求链接、禁止事项） ← 人与 Agent 读；不替代 ①
③ 任务清单（表格或勾选或 Batch 块）   ← 机器读：待办与完成态
```

**缺 ① 或 ③：不能按严格 FSM 顺利推进。**  
仅有散文、无可解析待办、又无 verify → 编排器应拒绝或 `BLOCKED`。

---

### ① Frontmatter（必填字段 vs 推荐字段）

文首必须是合法 YAML：

```yaml
---
batch_size: 3
max_fix_attempts: 2
stop_on_fail: true
verify_default:
  - npm run typecheck
read_first:
  - path/relative/to/workdir/REQUIREMENTS.md
hard_stop_patterns:
  - "待确认|协议未定|需要人工"
workflow_dir: .ai-workflow
adapter: table          # table | checkbox | batch-block
---
```

| 字段 | 顺利执行 | 说明 |
|------|----------|------|
| `verify_default` **或** 每个任务自带 verify | **必有其一** | 在 `--workdir` 下执行；exit ≠ 0 则本批不过 |
| 可解析的待办任务（见 ③） | **必有** | 否则无 ACTIVE 工作 |
| `read_first` | **强建议** | 每轮注入 Executor/Reviewer；路径相对 `--workdir`，须存在 |
| `hard_stop_patterns` | **强建议** | 命中则 `BLOCKED`，避免瞎修 |
| `block_recovery` | 推荐 | Fixer 熔断后的分析、范围策略、独立预算与依赖恢复边界 |
| `batch_size` | 推荐 | 默认实现按 3 |
| `max_fix_attempts` | 推荐 | 单批修复上限，默认 2 |
| `max_rounds` | 推荐 | 总轮次上限 |
| `executor_extra` / `reviewer_extra` / `fixer_extra` | 可选 | 追加进角色 prompt |
| `adapter` | 可选 | 任务区版式；可自动探测 |
| `workflow_dir` | 可选 | 默认 `.ai-workflow`（相对 `--workdir`） |

合并优先级：**CLI 显式参数 > 本文件 frontmatter > `--config` > 内置默认**。

项目特有 hard-stop（计费、OAuth、某协议未定）写在 **本索引或 `--config`**，不要写进 `gbx` 内核。

---

### ③ 任务清单：三种合法版式（三选一，勿混用一张表两套语法）

#### A. 状态表格（`adapter: table`，最常用）

表头建议包含：**状态 | ID | 任务 | verify**

```markdown
| 状态 | ID | 任务 | verify |
|------|-----|------|--------|
| ⬜ | M1-1 | 实现 Foo 接口 | npm run typecheck |
| ⬜ | M1-2 | 补单测 | npm run test -- tests/foo.test.ts |
| ✅ | M1-0 | 已完成的基建 | — |
```

| 记号 | 含义 |
|------|------|
| `⬜` / `- [ ]` / `[ ]` | 待办 |
| `✅` / `- [x]` / `[x]` | 已完成 |

- `ID`：稳定唯一（如 `M1-1`）；勾选与报告都引用它  
- `verify`：可写 `—` 表示回落到 `verify_default`  
- 编排器每轮最多取 `batch_size` 条 `⬜`（`group: milestone` 时尽量同前缀不拆）

#### B. Checkbox 列表（`adapter: checkbox`）

```markdown
- [ ] M1-1 实现 Foo 接口
- [x] M1-0 已完成的基建
```

无逐项 verify 时，**必须**有 frontmatter `verify_default`。

#### C. Batch 块（`adapter: batch-block`，适合显式 FSM 批次）

```markdown
## Batch 1：管道地基

Status: ACTIVE

### Tasks

- [ ] L1 实现 mock
- [ ] L2 实现门面

### Automated checks

- `npm run typecheck`
- `npm run test -- tests/server/foo`

### Exit criteria

- 所有 Tasks 已勾选
- Automated checks 全部 exit 0
- Reviewer 无 blocker / critical
```

同一文件可有多个 `## Batch N`；当前只应有一个 `Status: ACTIVE`（实现阶段约定）。

---

### 完整最小示例（复制后改路径即可）

见 [`examples/minimal-execution-index.md`](./examples/minimal-execution-index.md)。结构示意：

```markdown
---
batch_size: 3
verify_default:
  - npm run typecheck
read_first:
  - README.md
hard_stop_patterns:
  - "待确认|需要人工"
workflow_dir: .ai-workflow
adapter: table
---

# 某功能 — 执行索引

## 0. 口径

- 需求：……
- 禁止：改密钥、改未定协议

## 1. 任务表

| 状态 | ID | 任务 | verify |
|------|-----|------|--------|
| ⬜ | M1-1 | …… | npm run typecheck |
```

---

### 不合格（无法顺利执行）

- 没有 `--exFile`，或文件不存在  
- frontmatter YAML 坏掉（`---` 不成对 / 缩进错）  
- 正文无可解析待办，又不是「仅 FULL_REVIEW」模式  
- **既没有** `verify_default` **也没有** 任务级 verify，却要自动推进  
- `read_first` 指向不存在的文件（实现后应在开跑前失败或 BLOCKED）  
- 把「请按仓库里某文档自行发挥」当成索引、无可勾选项  

---

## 使用步骤（让 skill / CLI 顺利跑）

### 步骤 0 — 独立环境自检

```bash
cd .cursor/skills/general-batch-exe   # 或拷贝后的本 skill 根目录
node bin/gbx.js --help
```

不依赖宿主仓 `node_modules`，也不依赖 `@batch-execute`。

### 步骤 1 — 写合格执行索引

1. 复制 [`examples/minimal-execution-index.md`](./examples/minimal-execution-index.md)  
2. 填 `read_first`（需求、规范、协议真源等，路径相对即将使用的 `--workdir`）  
3. 填 `verify_default` / 任务 `verify`（必须是该 workdir 里真实可跑的命令）  
4. 填任务表；待办用 `⬜`  
5. 按需写 `hard_stop_patterns`、角色 `*_extra`

### 步骤 2 — 开跑前 dry-run

```bash
node bin/gbx.js \
  --exFile /绝对或相对路径/你的执行索引.md \
  --workdir /你的项目根 \
  --dry-run
```

- exit `0`：解析成功且 `read_first` 都存在、有 verify  
- exit `1`：参数、文件、YAML、缺 read_first / verify  

### 步骤 3 — 正式执行

```bash
# 真 Agent（需 cursor-agent）
node bin/gbx.js \
  --exFile docs/.../执行索引.md \
  --workdir /path/to/project

# 无 CLI 联调 FSM（会改执行索引勾选；请用副本）
cp examples/mock-happy-index.md /tmp/idx.md
node bin/gbx.js --exFile /tmp/idx.md --workdir /tmp/project-copy --mock-agent
```

可选：`--config`、`--agent-cmd`、`--max-iterations`、`--checkpoint`、`--reset-state`、`--continue-on-executor-fail`。

**在 Cursor 里触发本 skill 时**，应明确给出：

```text
@general-batch-exe --exFile docs/.../执行索引.md --workdir .
```

Agent 应：核对索引格式 → 运行本目录 `node bin/gbx.js …` → **禁止**转去调用 `batch-execute`。

### 步骤 4 — VERIFY 约定

`VERIFY_BATCH` / `FULL_VERIFY` **只跑脚本**（不启 Agent）：检查本批任务是否已勾选 ✅，并执行 `verify` 命令。审查 JSON 由 Reviewer / Final Reviewer 写入。

Hard-stop 匹配范围：Agent 输出与 `reviews/latest.json`（**不**扫整份执行索引正文，避免文档里写「待确认」误伤）。  
命中时若窗口内有「非本仓／不做／禁止／后置／未见／无 Host」等否定语境 → **跳过**（避免「写明不做 Realtime」「未见 Host 写口」反而 BLOCKED）。运行期仍命中时，v0.5 会先由 Block Analyzer 区分误判与真实需求冲突；只有后者进入人工 `BLOCKED`。

普通 Fixer 预算耗尽或同一 verify 指纹反复失败时，默认自动进入阻断恢复链。建议在执行索引用 `block_recovery.task_scopes` 声明每个任务的允许路径；完整契约见 [docs/05-automatic-block-recovery.md](./docs/05-automatic-block-recovery.md)。

---

## 开跑前检查清单（建议打印）

- [ ] `--exFile` 指向 UTF-8 `.md`，文首有合法 `---` YAML  
- [ ] 至少一种任务 adapter 可解析出 `⬜` / `- [ ]`  
- [ ] `verify_default` 或每行 `verify` 在 `--workdir` 下可执行  
- [ ] `read_first` 列表文件均存在  
- [ ] hard-stop / 禁止事项已写进索引或 `--config`  
- [ ] `node bin/gbx.js --exFile … --workdir … --dry-run` 为 0  
- [ ] 未把本流程误做成「依赖 @batch-execute」

---

## 与 `@batch-execute` 的关系（并列、无依赖）

| | `general-batch-exe`（本目录） | `batch-execute`（其它 skill） |
|--|------------------------------|------------------------------|
| 形态 | 独立 Node CLI + 外置 FSM | IDE 对话内 Skill 流程 |
| 触发 | `gbx --exFile …` / `@general-batch-exe` | `@batch-execute …` |
| 状态 | `STATE.json` + 执行索引 + review JSON | 主要写回任务表勾选 |
| 审查修复 | 设计为独立角色与轮次 | 通常同一对话内做完一轮 |
| 代码依赖 | **无** | **无** |

二者 **互不 import、互不调用、互不要求对方存在**。

- 对话里分轮勾清单 → `batch-execute`  
- CLI / 跨进程 / 脚本控状态 → **本工具**  
- 不是「本工具封装了 batch-execute」  

拷到没有 `batch-execute` 的项目，Node ≥ 18 仍应能跑 `gbx`。

---

## 独立环境

本 skill **自带** `package.json`，不使用宿主仓库的 `node_modules`。

```bash
cd .cursor/skills/general-batch-exe
node bin/gbx.js --help
```

可选：`npm link` 后全局使用 `gbx`。`engines.node`: `>=18`。**纯 JS（CommonJS）**，无 TS 构建。

---

## CLI

| 参数 | 说明 |
|------|------|
| `--exFile <path>` | **正式跑必填**。执行索引（格式见上文） |
| `--config <path>` | 可选。项目默认 hard-stop / verify / agent |
| `--workdir <path>` | 目标仓库根；默认 `cwd`；verify / `read_first` 相对此目录 |
| `--dry-run` | 解析并打印计划；校验 read_first / verify |
| `--mock-agent` | 不调用 cursor-agent，用内置 mock 驱动 FSM |
| `--quiet` | 不直播 Agent／verify（旧行为：只捕获到 STATE／log） |
| `--verbose` | 直播控制台（**默认**；用于覆盖 `GBX_QUIET=1`） |
| `--checkpoint` | **可选开启** git checkpoint（默认关；启动前脏树 BLOCKED；通过批次才提交） |
| `--no-checkpoint` | 强制关闭 checkpoint（与默认相同） |
| `--reset-state` | 删除 `{workflow_dir}/STATE.json` 后开跑 |
| `--continue-on-executor-fail` | executor 非 0 时仍进 REVIEW（默认则 BLOCKED） |
| `--agent-cmd <cmd>` | 覆盖默认 `cursor-agent`（或环境变量 `GBX_AGENT_CMD`） |
| `--no-agent-force` | 不传 `cursor-agent --force`（删文件/跑 shell 需交互批准） |
| `--no-agent-trust` | 不传 `cursor-agent --trust` |
| `--max-iterations <n>` | 覆盖索引 `max_rounds` |
| `--quiet` | 不直播；仅捕获输出 |
| `--verbose` | 直播（默认；覆盖 `GBX_QUIET`） |
| `--clear-blocked` | 从 `BLOCKED` 恢复；归档 stale `latest.json`；默认有 ⬜ → `EXECUTE_BATCH`，无待办 → `FULL_REVIEW` |
| `--after-manual` | 须配合 `--clear-blocked`：人类已 verify/勾选 → `VERIFY_BATCH` 或 `FIX_BATCH` |
| `--no-heartbeat` | 直播 agent 输出，但不打周期性 still-running 行 |
| `--help` / `-h` | 帮助 |

退出码：

| Code | 含义 |
|------|------|
| 0 | 成功 / help / dry-run 通过 / `READY_FOR_MANUAL_QA` |
| 1 | 参数、文件、解析或 dry-run 校验失败 |
| 3 | `BLOCKED` |
| 4 | 未知状态 |
| 5 | 超过最大迭代 |

环境变量：

| 变量 | 说明 |
|------|------|
| `GBX_AGENT_CMD` | 默认 agent 可执行文件 |
| `GBX_AGENT_FORCE` | 设为 `0`／`false` 等同 `--no-agent-force` |
| `GBX_AGENT_TRUST` | 设为 `0`／`false` 等同 `--no-agent-trust` |
| `GBX_AGENT_APPROVE_MCPS` | 设为 `1` 时传 `--approve-mcps` |
| `GBX_TUI` | `1` 强制 TUI；`0` 强制 plain |
| `GBX_QUIET` | 设为 `1`／`true` 时默认安静（等同 `--quiet`，可被 `--verbose` 覆盖） |
| `GBX_MOCK_SCENARIO` | `happy`（默认）或 `fail-then-pass` |
| `GBX_MOCK_REAL_VERIFY` | 设为 `1` 时 mock 也跑真实 verify 命令 |

### 跑起来之后你怎么盯（v0.7+）

**默认（TTY + 非 `--quiet`）** 启用 **neo-blessed 仪表盘**（`--plain` / `GBX_TUI=0` 回退 v0.6 行输出）：

- **启动 Splash**：先显示 `image/ascii-art.txt` 中的 GBX Logo；自动裁掉空白并适配终端尺寸，约 1.6 秒后切入仪表盘，期间 Agent 可继续启动
- **终态退出**：`READY_FOR_MANUAL_QA` / `BLOCKED` 时显示完成或阻断提示，按任意键后再退出 TUI
- **顶栏**：索引文件名、FSM `Status`、batch/tasks、recovery
- **中间 log 区**：orchestrator 消息 + agent `· 活动` / 静默心跳 + verify 输出
- **底栏**：当前 agent / 耗时 / 最近活动 + 快捷键提示
- 渲染器运行在独立进程；启动握手确认首帧完成后才进入 FSM。Agent/verify
  同步等待或长时间静默时，界面仍会每秒刷新耗时并响应快捷键。
- 默认不捕获鼠标，以保留终端原生文字选择；日志使用方向键、PgUp/PgDn、g/G 滚动。

| 键 | 作用 |
|----|------|
| `q` | 退出 TUI 视图 |
| `?` | 帮助 overlay |
| `↑` / `↓`、`PgUp` / `PgDn` | 逐行／翻页滚动日志 |
| `g` / `G` | 日志顶/底 |
| `l` | 打印 agent log 路径 |
| `o` | 打印 verify / block-repair 报告路径 |

仍保留（plain 或 TUI 内 log）：

- `[gbx] Iteration=… Status=…` 阶段切换
- **角色色 banner**（executor / fixer / block-analyzer / block-resolver 等）含 batch、tasks、trigger、批准路径
- **活动行** `· 读取/编辑/运行 …`（来自 `cursor-agent --output-format stream-json`，默认开启）
- 静默期 **心跳** `… role (90s) | 最近: 编辑 path/…`（不再只有纯计时）
- 阻断恢复专用摘要：`⛔ 启动自动分析` → `✓ 分析完成` → `✓ 修复报告` → `✓ 恢复 VERIFY_BATCH`
- Agent 最终结论仍打在 stdout；原始 NDJSON 写入 `agent-*.log`

| CLI / 配置 | 说明 |
|------------|------|
| `--no-color` / `NO_COLOR` | 纯文本，无 ANSI |
| `--no-heartbeat` | 关闭心跳行（活动行仍保留） |
| `--tui` | 强制 neo-blessed 仪表盘（需 TTY；默认 `auto` 在 TTY 下开启） |
| `--plain` | 强制 v0.6 行输出，关闭 TUI |
| `console_ui.mode: plain` | 索引/frontmatter 关闭 TUI |
| `console_theme.show_role_banner: false` | 不打印 spawn 前 banner |
| `agent.output_format: text` | 回退旧行为（无中间 tool 活动） |
| `agent.force: false` / `--no-agent-force` | 关闭自动批准 shell/删文件 |
| `agent.trust: false` / `--no-agent-trust` | 关闭 workspace 信任 |
| `agent.approve_mcps: true` | 传 `--approve-mcps` |
| `agent.sandbox: disabled` | 传 `--sandbox disabled` |

默认 agent 参数：`cursor-agent --force --trust -p --output-format stream-json`（可在 exFile frontmatter 或 `--config` 覆盖；`--no-agent-force` 为逃生口）。

| 产物 | 谁写 | 用途 |
|------|------|------|
| 执行索引勾选 `⬜`→`✅` | Executor / Fixer | 任务进度 |
| `{workflow_dir}/STATE.json` | **仅 gbx 脚本** | FSM 阶段 |
| `{workflow_dir}/reviews/latest.json` | Reviewer / Final Reviewer | 必须携带当前 prompt 的 `reviewRunId`；脚本校验身份后切阶段 |
| `{workflow_dir}/logs/loop.log` | gbx | 排障 |
| `{workflow_dir}/prompts/agent-*.log` | tee | Agent 全文回放（与控制台同源） |
| `{workflow_dir}/reports/latest-verify.json` | gbx verify | **Fixer 机器门禁真源**；BLOCKED 时打印 errorLocations |
| `{workflow_dir}/reports/latest-block-analysis.json` | Block Analyzer | 阻断分类、范围证据和完整批准候选路径 |
| `{workflow_dir}/reports/latest-block-repair.json` | Block Resolver | 自动恢复修复结果 |

审查 JSON 契约：[docs/02-review-json.md](./docs/02-review-json.md)。  
Verify↔Fix：[docs/03-verify-fix.md](./docs/03-verify-fix.md)。

单批「完成」须同时满足：勾选完成 + verify 全绿 + 本轮 review 无 blocker/critical（再 checkpoint 并进入下一批或 FULL_REVIEW）。同一 `workflow_dir` 只能恢复其 `STATE.json` 记录的执行索引；切换索引须 `--reset-state` 或使用不同目录。


---

## 文档

| 文档 | 内容 |
|------|------|
| [docs/00-core-design.md](./docs/00-core-design.md) | 核心设计：FSM、角色、方案 B、停条件、分期 |
| [docs/01-exfile-contract.md](./docs/01-exfile-contract.md) | `--exFile` / `--config` 契约（权威细节） |
| [docs/02-review-json.md](./docs/02-review-json.md) | `reviews/latest.json` 与 STATE 切换 |
| [docs/03-verify-fix.md](./docs/03-verify-fix.md) | verify 失败 → Fixer 真源与熔断 |
| [docs/04-hard-stop-and-resume.md](./docs/04-hard-stop-and-resume.md) | hard-stop 与人工恢复 |
| [docs/05-automatic-block-recovery.md](./docs/05-automatic-block-recovery.md) | 阻断分析、策略门、受限修复与断点续跑 |
| [examples/minimal-execution-index.md](./examples/minimal-execution-index.md) | 可复制最小索引 |
| [examples/mock-happy-index.md](./examples/mock-happy-index.md) | `--mock-agent` 联调用索引 |
| [SKILL.md](./SKILL.md) | Cursor Agent 触发说明 |

---

## 目录结构

```text
general-batch-exe/
├── README.md
├── SKILL.md
├── package.json
├── bin/gbx.js
├── examples/
│   ├── minimal-execution-index.md
│   └── mock-happy-index.md
├── docs/
│   ├── 00-core-design.md
│   ├── 01-exfile-contract.md
│   ├── 02-review-json.md
│   ├── 03-verify-fix.md
│   ├── 04-hard-stop-and-resume.md
│   └── 05-automatic-block-recovery.md
├── lib/                      ← FSM 实现
└── tests/
```

---

## 实现状态

| 阶段 | 状态 |
|------|------|
| 0 文档 + CLI 骨架 + 独立 package | **done** |
| 1 单批 EXECUTE→REVIEW→FIX→VERIFY | **done** |
| 2 批次自动推进 + hard-stop + checkpoint | **done** |
| 3 FULL_REVIEW / FULL_FIX / FULL_VERIFY → READY | **done** |
| 4 自动阻断分析 / 策略门 / 受限恢复 / 断点续跑 | **done** |
| worktree 并行 | **非目标** |

贡献实现时：保持 **纯 JS、无宿主依赖、不引用 batch-execute**；解析与验收以本文「执行索引格式」为准。

```bash
npm test   # 在本 skill 目录内
```  
