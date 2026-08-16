# 澜星 Claw

澜星 Claw 是澜星电话与基于 OpenClaw 的电脑端本地 agent runtime 之间的桌面 companion 与协议层。

本仓库先作为协议与协作真源存在：在正式实现前，先定义电话端、张老板、电脑端 companion 与 OpenClaw 之间如何通信、如何配对、如何授权、如何交接事务。

## 当前范围

- 定义电话端 <-> 电脑端 companion 协议。
- 定义 pairing、identity、permissions、jobs、affairs、chat 的边界。
- 定义后续 companion 与 OpenClaw adapter 的工程规则。
- 保持 OpenClaw core 作为执行引擎，优先用 adapter 与 shell 集成，避免侵入式修改。

## 必读

1. [AGENTS.md](AGENTS.md)
2. [docs/智能体维护/项目地图.md](docs/智能体维护/项目地图.md)
3. [docs/共同维护/需求/00-产品简述.md](docs/共同维护/需求/00-产品简述.md)
4. [docs/共同维护/技术设计/说明.md](docs/共同维护/技术设计/说明.md)
5. [docs/共同维护/技术设计/协议/说明.md](docs/共同维护/技术设计/协议/说明.md)
6. [.cursor/rules/codingRole.mdc](.cursor/rules/codingRole.mdc)

## 质量门禁

```bash
npm run quality
```
