# lib/

FSM 与解析器实现目录。入口：`../bin/gbx.js` → `orchestrator.js`。

| 文件 | 职责 |
|------|------|
| `orchestrator.js` | 主循环 |
| `loadExFile.js` / `mergeConfig.js` | 执行索引与配置 |
| `adapters/*` | table / checkbox / batch-block |
| `fsm.js` / `stateStore.js` / `reviewDecision.js` | 状态机与方案 B |
| `verify.js` / `hardStop.js` / `gitCheckpoint.js` | 验收、硬停、checkpoint |
| `blockRecovery.js` | 阻断分析报告校验、路径策略门与修复越界检测 |
| `prompts.js` | 角色 prompt |
| `agent/runner.js` | cursor-agent |
| `agent/mockRunner.js` | `--mock-agent` |
