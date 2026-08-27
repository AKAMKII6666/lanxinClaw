/**
 * 入站 WS 认证门闩（per-socket + message type）。
 *
 * 职责：session 业务消息、session.heartbeat/closed 须已认证 socket。
 * 不拥有：session.open 身份校验（在 router handler）。
 * 纯函数：无 I/O。
 */

import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { CompanionConnectionState } from "../../../state/types.js";

/** 需要已认证 session 的业务前缀 */
const REQUIRES_SESSION_PREFIXES = ["affair.", "job.", "chat.", "permission."] as const;

/** 入站认证校验结果 */
export type InboundAuthResult =
  | { ok: true }
  | { ok: false; code: string; message: string; retryable: false };

/**
 * 业务 type 是否要求已认证 session。
 *
 * @param type message type
 * @returns 是否要求 session
 */
export function isRequiresSessionType(type: string): boolean {
  return REQUIRES_SESSION_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * 校验入站消息是否允许在当前 socket 认证态下处理。
 *
 * @param type message type
 * @param socketAuthenticated 该 socket 是否已通过 session.accepted
 * @returns 通过或拒绝
 */
export function validateInboundAuth(type: string, socketAuthenticated: boolean): InboundAuthResult {
  if (type === "session.open") {
    return { ok: true };
  }
  if (type.startsWith("pairing.")) {
    return { ok: true };
  }
  if (type.startsWith("session.")) {
    if (!socketAuthenticated) {
      return {
        ok: false,
        code: "session_required",
        message: "session.* 须先完成 session.open 认证",
        retryable: false,
      };
    }
    return { ok: true };
  }
  if (isRequiresSessionType(type) && !socketAuthenticated) {
    return {
      ok: false,
      code: "session_required",
      message: "业务消息须先完成配对与 session.open",
      retryable: false,
    };
  }
  return { ok: true };
}

/**
 * 校验入站 envelope 的 source/target 与会话 connection 一致。
 *
 * @param envelope 已校验 envelope
 * @param connection 当前连接快照
 * @param desktopDeviceId 桌面设备 id
 * @returns 通过或拒绝
 */
export function validateInboundIdentity(
  envelope: ProtocolEnvelope,
  connection: CompanionConnectionState,
  desktopDeviceId: string,
): InboundAuthResult {
  if (!connection.phoneDeviceId) {
    return {
      ok: false,
      code: "inbound_identity_mismatch",
      message: "无已配对电话，拒绝业务入站",
      retryable: false,
    };
  }
  if (envelope.source.deviceId !== connection.phoneDeviceId) {
    return {
      ok: false,
      code: "inbound_identity_mismatch",
      message: "source.deviceId 与当前会话 phoneDeviceId 不一致",
      retryable: false,
    };
  }
  if (envelope.target.deviceId !== desktopDeviceId) {
    return {
      ok: false,
      code: "inbound_identity_mismatch",
      message: "target.deviceId 与 companion desktopDeviceId 不一致",
      retryable: false,
    };
  }
  return { ok: true };
}
