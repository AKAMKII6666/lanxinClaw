/** 已认证 phone 的事务动作；持久化与运行时停止由共同协调器负责。 */
import type { AffairClosePayload, ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { HandleProtocolSocketMessageInput } from "../router.js";
import { replyRequest } from "../request-reply.js";

/** 请求 ID 与设备构成幂等键；只返回已提交事实。 */
export async function handleAffairClose(input: HandleProtocolSocketMessageInput, envelope: ProtocolEnvelope): Promise<void> {
  const outcome = await input.options.backend.getAffairActions().execute({
    requestId: envelope.messageId, actorId: envelope.source.deviceId,
    command: envelope.payload as unknown as AffairClosePayload,
  }, {
    desktopDeviceId: input.options.pairing.desktopDeviceId,
    ...(input.options.onJobCancel ? { cancelJob: input.options.onJobCancel } : {}),
    sendEnvelope: input.sendEnvelope,
  });
  replyRequest({ ...input, request: envelope }, outcome.ok
    ? { ok: true, acceptedType: envelope.type, result: outcome.result, ...(outcome.duplicate ? { duplicate: true } : {}) }
    : outcome);
}
