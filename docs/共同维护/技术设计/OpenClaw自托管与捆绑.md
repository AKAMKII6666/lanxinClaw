# OpenClaw 自托管与捆绑设计

> 适用范围：companion 内置/自托管 OpenClaw 运行时，与 phone 联调前的执行引擎闭环。
> 基线：`openclaw@2026.7.1-2`（2026-08 分析，协议版本 4）。

## 1. 目标

- 不依赖用户机器已安装 OpenClaw；安装包自带运行时，首次启动配置模型 key 后即可用。
- 自托管实例与用户已有 OpenClaw 完全隔离，互不干扰。
- 保持 skills 能力可用；`job.completed` 不得自动关闭 affair。

## 2. 捆绑与运行时

- openclaw 为 MIT 协议 npm 包；生产依赖约 204MB（非旧版估算的 1.1GB），tarball 约 20MB。
- 需要 Node ≥ 24.15.0（engines 与 postinstall 要求）；安装包捆绑 Node 24.15.x，companion 用它 spawn 子进程。
- 启动命令：`node <openclaw>/openclaw.mjs gateway run`；冷启动约 4–6 秒。
- 运行时禁用渠道：`OPENCLAW_SKIP_CHANNELS=1`（agent/gateway/HTTP 均保留）。

## 3. 隔离（与用户已有 OpenClaw 零冲突）

子进程环境变量：

| 变量 | 值 |
|------|-----|
| `OPENCLAW_STATE_DIR` | `userData/openclaw-runtime` |
| `OPENCLAW_CONFIG_PATH` | `$STATE_DIR/openclaw.json` |
| `OPENCLAW_OAUTH_DIR` | `$STATE_DIR/credentials` |
| `OPENCLAW_GATEWAY_PORT` | 随机空闲端口 |
| `LANXIN_OPENCLAW_API_KEY` | 模型 key（仅注入子进程 env，不落盘） |

- gateway 锁按 configPath 哈希命名，换路径即不冲突；实测与用户默认安装并存。
- gateway 仅 `bind: loopback`，端口随机，token 随机生成。
- OpenClaw 自身日志通过 `logging.file` 指到 `$STATE_DIR/logs/openclaw-runtime.log`，作为 pino `runtime` 模块的补充。

## 4. 最小 openclaw.json（由 onboarding 生成）

```json
{
  "gateway": { "mode": "local", "bind": "loopback", "port": 0,
    "auth": { "mode": "token", "token": "<随机>" } },
  "agents": { "defaults": { "model": "openai/gpt-5.5",
    "workspace": "<用户工作区>" } },
  "models": { "providers": { "openai": {
    "apiKey": { "source": "env", "provider": "default", "id": "LANXIN_OPENCLAW_API_KEY" } } } },
  "logging": { "level": "warn", "file": "<stateDir>/logs/openclaw-runtime.log" }
}
```

apiKey 使用 env ref，明文只经子进程环境变量注入，不落配置文件。

## 5. Gateway 线协议（协议版本 4）与 adapter 校准

- 握手：WS 打开后服务端先发事件 `connect.challenge { nonce }`；客户端回 `req method="connect"`，params 含 `minProtocol/maxProtocol=4`、`role="operator"`、`scopes=["operator.read","operator.write"]`、`client { id: "gateway-client", mode: "backend", ... }`、`auth { token }`。client.id 有白名单，自定义 id 会被拒绝。缺 `operator.write` 时 `agent` RPC 返回 `missing scope: operator.write`。这些是 OpenClaw Gateway 控制面 scope，不是澜星 `workspace.read` 权限 id。修改 handshake 后必须**重启 Companion 进程**才会加载新 transport；只重跑配置门探针不够。
- 创建 run：`req method="agent"`，params `{ message, idempotencyKey（必填，作为 runId）, agentId?, sessionKey?, timeout? }`；重复 idempotencyKey 幂等返回 `in_flight`，不得因此创建第二个 Lanxin job。
- 读取：`req method="agent.wait" { runId, timeoutMs? }`，返回 `ok/error/timeout` 粗状态。`ok` 只证明 agent loop 正常结束，不等于业务成功；`timeout` 需区分 wait-only timeout 与 run terminal timeout。
- 取消：`req method="chat.abort" { sessionKey?, runId? }`。
- 进度：MVP 用短超时轮询 `agent.wait`；后续升级为长连接 observer，声明 `caps: ["tool-events"]`，并结合 event、audit、task、history 做状态 reconcile。
- `packages/openclaw-adapter` 的 raw-ws transport 已按上述协议校准；`createJob` 以 `lanxing-job:<jobId>` 作为 idempotencyKey。

状态细节以 [OpenClaw状态观测与探针.md](OpenClaw状态观测与探针.md) 和 [OpenClaw到Lanxin状态映射.md](OpenClaw到Lanxin状态映射.md) 为准。

## 6. 生命周期与 onboarding

- companion 主进程持 `GatewayRuntimeService`：写配置 → spawn → 端口就绪探测（默认超时 **90s**，失败会 stop 子进程）→ 返回 adapter。
- 首次启动：renderer 配置门（默认千问：地域/模型 preset 下拉，用户仅粘贴 DashScope API Key；其它 provider 仍可手填 endpoint/modelRef）→ 提交后全卡遮罩锁定表单，按阶段展示：
  1. `verifying_key`：验证 API Key；
  2. `starting_runtime`：启动 OpenClaw 运行时（首次可能约 1 分钟）。
  失败回表单可改；成功 Snackbar 后进入主界面。
- 千问 preset 真源：`apps/companion/src/onboarding/presets/qwen.ts`。
- 未配置/探针失败：停留在配置门，主界面不可达；key 用 Electron safeStorage 加密落盘。
- 重启恢复：已配置时 UI 先全屏等待 `bootstrapRuntime`（ensureStarted + 运行时探针）成功再进主界面；失败可重试，不静默进主壳。已就绪的 gateway 子进程异常退出后按指数退避重启（1s、2s、4s…上限 60s）；连续失败超过 8 次进入 degraded，停止自动拉起，错误写入诊断。首次启动失败（配置门探针）不后台重试。

## 7. 已知注意点

- gateway 同端口还提供 HTTP control UI（loopback 仅本机可达），联调文档需注明。
- 首启若配置声明缺失 provider 插件，gateway 可能自动从 npm 安装（一次网络操作）。
- 配置热加载：`config set` 后 gateway 自动 reload，无需重启。
