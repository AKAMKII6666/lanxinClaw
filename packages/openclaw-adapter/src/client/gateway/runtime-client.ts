/**
 * OpenClaw Gateway runtime client。
 *
 * 职责：把现有 OpenClawRuntimeClient 窄接口转接到 Gateway transport。
 * 不拥有：权限裁决、Gateway 凭据明文、affair 关闭、mock 降级。
 * 副作用：经 transport 产生 Gateway 网络 I/O。
 */

import type {
  CreateOpenClawRunParams,
  OpenClawRunSnapshot,
  OpenClawRuntimeClient,
} from "../runtime-client.js";
import type { GatewayTransport } from "./transport.js";
import { createUnavailableGatewayTransport } from "./transport.js";
import { createRawWebSocketGatewayTransport } from "./raw-ws/transport.js";

/**
 * Gateway 鉴权提供者；返回 token 或头信息由具体 transport 使用。
 */
export type GatewayAuthProvider = () => Promise<string | null> | string | null;

/**
 * Gateway runtime client 选项。
 */
export interface GatewayRuntimeClientOptions {
  /** Gateway 地址；缺失时必须 fail-closed */
  gatewayUrl?: string | null;
  /** 鉴权提供者；不得把 token 写入日志或 snapshot */
  authProvider?: GatewayAuthProvider;
  /** OpenClaw agent id */
  agentId: string;
  /** 默认 scope；由 companion 已授权能力映射而来 */
  defaultScopes?: readonly string[];
  /** transport 注入；测试用 fake，生产可接官方 Gateway client */
  transport?: GatewayTransport;
  /** 单次 run 超时毫秒 */
  timeoutMs?: number;
}

/**
 * 创建 Gateway runtime client。
 *
 * @param options 配置
 * @returns runtime client
 */
export function createGatewayRuntimeClient(
  options: GatewayRuntimeClientOptions,
): OpenClawRuntimeClient {
  const gatewayUrl = options.gatewayUrl?.trim() ?? "";
  const agentId = options.agentId.trim();
  const scopes = [...(options.defaultScopes ?? [])];
  const transport =
    options.transport ??
    (gatewayUrl && options.authProvider
      ? createRawWebSocketGatewayTransport({
          gatewayUrl,
          authProvider: options.authProvider,
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        })
      : createUnavailableGatewayTransport(
          "未注入 OpenClaw Gateway transport；请配置官方 gateway client 或 raw WS transport",
        ));

  return {
    async createRun(params) {
      validateGatewayOptions(gatewayUrl, agentId, scopes);
      await assertAuthAvailable(options.authProvider);
      const sessionKey = params.sessionKey?.trim() || "lanxing-job:unknown";
      return sanitizeSnapshot(
        await transport.createRun({
          agentId,
          input: params.input,
          sessionKey,
          workspaceHint: params.workspaceHint ?? null,
          scopes,
          timeoutMs: options.timeoutMs ?? null,
        }),
      );
    },

    async getRun(runId) {
      validateGatewayOptions(gatewayUrl, agentId, scopes);
      await assertAuthAvailable(options.authProvider);
      return sanitizeSnapshot(await transport.getRun(runId));
    },

    async cancelRun(runId) {
      validateGatewayOptions(gatewayUrl, agentId, scopes);
      await assertAuthAvailable(options.authProvider);
      return sanitizeSnapshot(await transport.cancelRun(runId));
    },
  };
}

/**
 * 校验 Gateway 配置；缺失时 fail-closed。
 *
 * @param gatewayUrl Gateway 地址
 * @param agentId agent id
 * @param scopes 默认 scope
 */
function validateGatewayOptions(gatewayUrl: string, agentId: string, scopes: readonly string[]): void {
  if (!gatewayUrl) {
    throw new Error("gateway_url_missing");
  }
  if (!agentId) {
    throw new Error("gateway_agent_missing");
  }
  if (scopes.length === 0) {
    throw new Error("gateway_scope_missing");
  }
}

/**
 * 确认鉴权信息可用；不记录 token。
 *
 * @param authProvider 鉴权提供者
 */
async function assertAuthAvailable(authProvider: GatewayAuthProvider | undefined): Promise<void> {
  if (!authProvider) {
    throw new Error("gateway_auth_missing");
  }
  const token = await authProvider();
  if (!token || !token.trim()) {
    throw new Error("gateway_auth_missing");
  }
}

/**
 * 清理 Gateway 快照，避免 undefined optional 与空摘要。
 *
 * @param snapshot transport 快照
 * @returns runtime 快照
 */
function sanitizeSnapshot(snapshot: OpenClawRunSnapshot): OpenClawRunSnapshot {
  return {
    runId: snapshot.runId,
    status: snapshot.status,
    ...(snapshot.summary !== undefined ? { summary: snapshot.summary } : {}),
    ...(snapshot.blockedReason !== undefined ? { blockedReason: snapshot.blockedReason } : {}),
    ...(snapshot.resumeCondition !== undefined ? { resumeCondition: snapshot.resumeCondition } : {}),
  };
}
