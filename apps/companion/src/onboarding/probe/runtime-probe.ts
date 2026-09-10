/**
 * 运行时就绪探针：连自托管 gateway 跑一次最小 run。
 */

import {
  createGatewayRuntimeClient,
  OpenClawAdapter,
} from "@lanxin-claw/openclaw-adapter";
import type { ProbeResult } from "../types.js";
import { RUNTIME_PROBE_MARKER, waitForRuntimeProbeResult } from "./runtime-result.js";

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
  /** 等待模型终态的总时限；默认 60000 */
  resultTimeoutMs?: number;
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
      goal: `模型连接验收探针：不要调用工具或读取文件，只回复 ${RUNTIME_PROBE_MARKER}`,
      allowedPermissions: ["workspace.read"],
    });
    if (!created.ok) {
      return { ok: false, code: created.code, message: created.message };
    }
    const result = await waitForRuntimeProbeResult(
      () => adapter.readJob(probeJobId, { refresh: true }), options.resultTimeoutMs,
    );
    if (!result.ok) await adapter.cancelJob(probeJobId).catch(() => undefined);
    return result;
  };
}
