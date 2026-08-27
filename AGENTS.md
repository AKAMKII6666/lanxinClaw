# 澜星 Claw — Agent 协作入口

> **导航真源**：本文件 + [docs/共同维护/](docs/共同维护/) + [docs/智能体维护/](docs/智能体维护/)。
> **约束层**：`.cursor/rules/`（编码边界与门禁，不写阶段进度表）。

## 项目是什么

澜星 Claw 是 **澜星电话 ↔ 电脑端 OpenClaw runtime** 的协议、桌面壳与适配层。

核心产品目标不是再造一个 Agent，而是让澜星电话里的“张老板”成为 **虚拟责任人**：

- 张老板负责接事、确认标准、推进事务、识别阻塞、向用户回报。
- 电脑端 Lanxing Claw companion 负责配对、权限、状态同步和 OpenClaw 适配。
- OpenClaw 负责具体执行能力，如读写文件、跑命令、调工具、操作工作区。

## 当前仓库阶段

当前 v1.0–v1.3 已推进到协议、mock companion、companion 桌面壳、OpenClaw adapter 与事务监督原型均有代码和测试的收口阶段：

- 已定义协议、状态机、安全边界和文档结构。
- 已落地 companion shell / bridge / OpenClaw adapter 的 MVP 壳与契约验证。
- 联调前置收口已落地：pino 模块化日志、session 门闩、授权后自动委派（JobDelegator）、自托管 OpenClaw 运行时（隔离环境变量 + 协议 v4 校准）、首次启动 onboarding 配置门；协议出站（permission/chat/resume）、监督 loop、控制面板 live snapshot 与托盘常驻已接线。日常入口 `npm run start:companion`。真机 phone 联调验收见 `docs/共同维护/计划/phone联调验收矩阵.md`。
- 如需 patch `openclaw/openclaw`，必须保持最小、可解释、可回滚。

## 必读文档

1. [docs/共同维护/需求/00-产品简述.md](docs/共同维护/需求/00-产品简述.md) — 产品需求与虚拟责任人边界
2. [docs/共同维护/技术设计/说明.md](docs/共同维护/技术设计/说明.md) — 工程设计索引
3. [docs/共同维护/技术设计/目录落点.md](docs/共同维护/技术设计/目录落点.md) — 目录落点规则
4. [docs/共同维护/技术设计/质量门禁.md](docs/共同维护/技术设计/质量门禁.md) — 质量门禁
5. [docs/共同维护/技术设计/协议/说明.md](docs/共同维护/技术设计/协议/说明.md) — 协议总览
6. [docs/共同维护/技术设计/安全模型.md](docs/共同维护/技术设计/安全模型.md) — 配对、授权与权限模型
7. [docs/共同维护/技术设计/携证状态转移原则.md](docs/共同维护/技术设计/携证状态转移原则.md) — 状态机与异步消息的事务安全原则
8. [docs/共同维护/技术设计/执行引擎集成.md](docs/共同维护/技术设计/执行引擎集成.md) — OpenClaw 集成边界
9. [docs/智能体维护/项目地图.md](docs/智能体维护/项目地图.md) — 当前仓库事实与实施入口

## 主要模块规划

| 模块 | 路径 | 说明 |
|------|------|------|
| 协议文档 | `docs/共同维护/技术设计/协议/` | 电话与电脑 companion 的消息、状态机、能力声明 |
| JSON Schema | `schemas/` | 协议消息的机器可校验结构 |
| Companion | `apps/companion/` | 未来桌面壳、bridge、pairing、权限 UI |
| OpenClaw adapter | `packages/openclaw-adapter/` | 未来将事务 job 转为 OpenClaw run |
| 协议 SDK | `packages/protocol/` | 未来共享 types / validators / client |

## 核心边界

```text
Lanxing Phone / Zhang Boss
  -> Affair protocol
  -> Lanxing Claw Companion
  -> OpenClaw Adapter
  -> OpenClaw Runtime
```

必须保持：

- 电话端不直接执行电脑文件、终端、网络或 git 副作用。
- 张老板不等于 OpenClaw；张老板负责事务连续性，OpenClaw 负责执行。
- Companion 是安全边界：配对、身份认证、权限确认、审计都在这里落地。
- OpenClaw core 默认只读、只适配；不得把张老板人格、事务簿、电话协议塞进 OpenClaw 核心。

## 工作模式

| 模式 | 行为 |
|------|------|
| 讨论 | 只读分析，不改文件 |
| 计划 | 输出文件级计划与风险，不改代码 |
| 执行 | 小步改动，每步可验证 |
| 审查 | 只找 bug、协议漏洞、架构违规、测试缺口 |
| 冻结 | 只改指定层，不跨边界重构 |

## 修改前确认

1. **任务类型**：讨论 / 计划 / 执行 / 审查 / 冻结。
2. **可改范围**：协议、companion、adapter、OpenClaw fork、docs、rules。
3. **验证方式**：文档 lint / schema validate / unit test / integration test / 手工配对测试。

## 不要写的目录

- `node_modules/`
- 构建产物目录，如 `dist/`、`build/`、`.next/`、`out/`
- 本机真实 API Key、token、设备私钥
- 未经明确要求，不要直接改 vendored OpenClaw core

## 文档可信度

- 真实写代码：先信当前代码与测试，再信 [docs/智能体维护/](docs/智能体维护/) 当前事实，再信 [docs/共同维护/技术设计/](docs/共同维护/技术设计/) 与 [docs/共同维护/需求/](docs/共同维护/需求/)。
- 协议变更：必须同步协议文档与 schema。
- 安全/权限冲突：以 [docs/共同维护/技术设计/安全模型.md](docs/共同维护/技术设计/安全模型.md) 和 `.cursor/rules/security-and-permissions.mdc` 为准。

## 协作约束

- 没有明确要求，不做大规模重构。
- 不要自动 commit，除非用户明确要求。
- 新增协议字段必须说明 owner、方向、认证要求、兼容策略。
- 所有“能控制电脑”的能力必须经过 companion 权限层。
