/**
 * 已知 runtime message type 目录。
 *
 * 职责：枚举 phone↔companion envelope 的 type 字符串，供 helpers / validators 使用。
 * 不拥有：discovery 广告、控制面板 UI 快照（非 envelope）。
 * 纯函数：仅常量和类型守卫。
 */

/** 与 docs/共同维护/技术设计/协议/消息目录.md 对齐的 type 列表 */
export const MESSAGE_TYPES = [
  "pairing.request",
  "pairing.challenge",
  "pairing.confirmed",
  "pairing.desktop_approved",
  "pairing.completed",
  "pairing.revoked",
  "session.open",
  "session.accepted",
  "session.heartbeat",
  "session.closed",
  "session.reauth_required",
  "affair.create",
  "affair.update",
  "affair.resume",
  "affair.close",
  "job.create",
  "job.accepted",
  "job.progress",
  "job.needs_permission",
  "job.blocked",
  "job.completed",
  "job.failed",
  "job.cancel",
  "chat.message",
  "chat.context_attach",
  "chat.read_receipt",
  "permission.request",
  "permission.decision",
] as const;

/** 已知协议 message type */
export type MessageType = (typeof MESSAGE_TYPES)[number];

/**
 * 判断字符串是否为已知 MessageType。
 *
 * @param value 待检测 type
 * @returns 是否在 MESSAGE_TYPES 中
 */
export function isMessageType(value: string): value is MessageType {
  return (MESSAGE_TYPES as readonly string[]).includes(value);
}
