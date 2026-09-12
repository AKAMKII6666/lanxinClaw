/** 分离职责的协议校验；纯函数，无 I/O 或状态提交。 */
import {
expectEnum,
expectNonEmptyString,
expectObject
} from "../primitives.js";
import type { ValidateResult } from "../result.js";


/**
 * 校验五段状态卡的 status 枚举与关键字段。
 *
 * @param obj snapshot 对象
 * @returns 通过或失败
 */
export function validateStatusCards(obj: Record<string, unknown>): ValidateResult<undefined> {
  for (const section of ["companion", "clawCore", "credential", "device", "zhangBoss"] as const) {
    const sectionObj = expectObject(obj[section], section);
    if (!sectionObj.ok) {
      return sectionObj;
    }
  }
  const companionStatus = expectEnum(
    (obj.companion as Record<string, unknown>).status,
    "companion.status",
    ["stopped", "starting", "running", "degraded", "error"] as const,
  );
  if (!companionStatus.ok) {
    return companionStatus;
  }
  const claw = obj.clawCore as Record<string, unknown>;
  const clawStatus = expectEnum(claw.status, "clawCore.status", [
    "not_installed",
    "stopped",
    "starting",
    "running",
    "error",
  ] as const);
  if (!clawStatus.ok) {
    return clawStatus;
  }
  if (typeof claw.adapterReady !== "boolean") {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "clawCore.adapterReady 必须是布尔值",
        retryable: false,
      },
    };
  }
  const credential = obj.credential as Record<string, unknown>;
  const credentialStatus = expectEnum(credential.status, "credential.status", [
    "missing",
    "synced",
    "expired",
    "needs_reauth",
  ] as const);
  if (!credentialStatus.ok) {
    return credentialStatus;
  }
  const provider = expectNonEmptyString(credential.provider, "credential.provider");
  if (!provider.ok) {
    return provider;
  }
  const deviceStatus = expectEnum(
    (obj.device as Record<string, unknown>).status,
    "device.status",
    ["undiscovered", "discovered", "pairing", "connected", "disconnected"] as const,
  );
  if (!deviceStatus.ok) {
    return deviceStatus;
  }
  const zhangStatus = expectEnum(
    (obj.zhangBoss as Record<string, unknown>).status,
    "zhangBoss.status",
    ["offline", "online", "in_call", "supervising", "waiting_user"] as const,
  );
  if (!zhangStatus.ok) {
    return zhangStatus;
  }
  return { ok: true, value: undefined };
}
