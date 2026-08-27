/**
 * 运行时就绪探针：连自托管 gateway 跑一次最小 run。
 */

import {
  createGatewayRuntimeClient,
  OpenClawAdapter,
} from "@lanxin-claw/openclaw-adapter";
import type { ProbeResult } from "../types.js";

/** 探针选项 */
export interface RuntimeReadyProbeOptions {
  /** gateway WebSocket URL */
  gatewayUrl: string;
  /** 本地 token */
  token: string;
  /** agent id；默认 main */
  agentId?: string;
  /** 单次 wait 超时毫秒；默认 15000 */
  getRunTimeoutMs?: number;
}

/**
 * 构造运行时就绪探针。
 *
 * @param options 选项
 * @returns 探针
 */
export function createGatewayRuntimeReadyProbe(
  options: RuntimeReadyProbeOptions,
): () => Promise<ProbeResult> {
  const agentId = options.agentId ?? "main";
  return async () => {
    const runtime = createGatewayRuntimeClient({
      gatewayUrl: options.gatewayUrl,
      agentId,
      defaultScopes: ["workspace.read"],
      authProvider: () => options.token,
      timeoutMs: options.getRunTimeoutMs ?? 20_000,
    });
    const adapter = new OpenClawAdapter({ runtime });
    const probeJobId = `onboarding-probe-${Date.now()}`;
    const created = await adapter.createJob({
      jobId: probeJobId,
      affairId: "onboarding-probe",
      goal: "lanxin-onboarding-probe: reply ok",
      allowedPermissions: ["workspace.read"],
    });
    if (!created.ok) {
      return { ok: false, code: created.code, message: created.message };
    }
    const read = await adapter.readJob(probeJobId, { refresh: true });
    if (!read.ok) {
      return { ok: false, code: read.code, message: read.message };
    }
    if (read.job.status === "failed" || read.job.status === "canceled") {
      return {
        ok: false,
        code: "runtime_probe_failed",
        message: read.job.blockedReason ?? "探针 run 未成功（检查模型 key/额度/网络）",
      };
    }
    return { ok: true };
  };
}
