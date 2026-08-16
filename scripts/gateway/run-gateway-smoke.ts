/**
 * Gateway smoke 脚本。
 *
 * 职责：验证 Gateway runtime client 的配置门闩；真实 transport 未接入时明确失败。
 * 不拥有：phone 主仓、真实 OpenClaw core patch、凭据明文。
 * 副作用：可选连接真实 Gateway；默认只跑 fail-closed 检查。
 */

import {
  OpenClawAdapter,
  createGatewayRuntimeClient,
} from "@lanxin-claw/openclaw-adapter";

const gatewayUrl = process.env.LANXIN_OPENCLAW_GATEWAY_URL ?? "";
const gatewayToken = process.env.LANXIN_OPENCLAW_GATEWAY_TOKEN ?? "";
const agentId = process.env.LANXIN_OPENCLAW_AGENT_ID ?? "main";

const runtime = createGatewayRuntimeClient({
  gatewayUrl,
  agentId,
  defaultScopes: ["workspace.read"],
  authProvider: () => gatewayToken || null,
});

const adapter = new OpenClawAdapter({ runtime });
const result = await adapter.createJob({
  jobId: "job_gateway_smoke_001",
  affairId: "affair_gateway_smoke_001",
  goal: "Read-only Gateway smoke from Lanxing Claw",
  allowedPermissions: ["workspace.read"],
});

if (!result.ok) {
  process.stdout.write(`[gateway-smoke] expected-gated-or-failed code=${result.code} message=${result.message}\n`);
  process.exit(result.code === "runtime_create_failed" ? 0 : 1);
}

process.stdout.write(`[gateway-smoke] created job=${result.job.jobId} status=${result.job.status}\n`);
