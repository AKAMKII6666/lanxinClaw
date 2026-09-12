/** 模型探针必须收取指定终态结果；仅 accepted/running 不能证明凭据或模型可用。 */
import type { AdapterJobRecord } from "@lanxin-claw/openclaw-adapter";
import type { ProbeResult } from "../types.js";

export const RUNTIME_PROBE_MARKER = "LANXIN_MODEL_PROBE_OK";
type ProbeRead = { ok: false; code: string; message: string } |
  { ok: true; job: Pick<AdapterJobRecord, "status" | "resultDigest" | "blockedReason"> };

/** @param read 真实 adapter 读取口 @param timeoutMs 总等待边界 @param intervalMs 轮询间隔 @returns 终态模型证明或明确未就绪 */
export async function waitForRuntimeProbeResult(read: () => Promise<ProbeRead>, timeoutMs = 60_000, intervalMs = 250): Promise<ProbeResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    if (result.job.status === "completed") {
      return result.job.resultDigest?.includes(RUNTIME_PROBE_MARKER)
        ? { ok: true }
        : { ok: false, code: "runtime_probe_result_missing", message: "模型未返回预期探针结果" };
    }
    if (["failed", "canceled", "blocked"].includes(result.job.status)) {
      return { ok: false, code: "runtime_probe_failed",
        message: result.job.blockedReason || "模型探针失败，请检查凭据、额度与网络" };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
  return { ok: false, code: "runtime_probe_unconfirmed", message: "模型尚未返回探针结果，运行时仍未就绪" };
}
