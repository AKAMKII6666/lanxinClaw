/**
 * 顶层 schema 与 message type / UI 契约的对齐登记。
 *
 * 职责：把已知 type 与仓库根 `schemas/*.schema.json` 的 $id 文件名对齐，便于测试与文档对齐。
 * 不拥有：运行时加载 JSON Schema 文件、Ajv 编译缓存。
 * 纯函数：只读常量表。
 */

import type { MessageType } from "../messages/message-type.js";

/** 仓库根 schemas 目录中的 schema 文件名 */
export type SchemaFileName =
  | "envelope.schema.json"
  | "affair.schema.json"
  | "job.schema.json"
  | "job-cancel.schema.json"
  | "pairing.schema.json"
  | "session.schema.json"
  | "chat.schema.json"
  | "permission.schema.json"
  | "control-panel-snapshot.schema.json"
  | "control-panel-reports.schema.json";

/** message type → payload schema 文件 */
export const MESSAGE_PAYLOAD_SCHEMA: Record<MessageType, SchemaFileName> = {
  "pairing.request": "pairing.schema.json",
  "pairing.challenge": "pairing.schema.json",
  "pairing.confirmed": "pairing.schema.json",
  "pairing.desktop_approved": "pairing.schema.json",
  "pairing.completed": "pairing.schema.json",
  "pairing.revoked": "pairing.schema.json",
  "session.open": "session.schema.json",
  "session.accepted": "session.schema.json",
  "session.heartbeat": "session.schema.json",
  "session.closed": "session.schema.json",
  "session.reauth_required": "session.schema.json",
  "affair.create": "affair.schema.json",
  "affair.update": "affair.schema.json",
  "affair.resume": "affair.schema.json",
  "affair.close": "affair.schema.json",
  "job.create": "job.schema.json",
  "job.accepted": "job.schema.json",
  "job.progress": "job.schema.json",
  "job.needs_permission": "job.schema.json",
  "job.blocked": "job.schema.json",
  "job.completed": "job.schema.json",
  "job.failed": "job.schema.json",
  "job.cancel": "job-cancel.schema.json",
  "job.canceled": "job.schema.json",
  "chat.message": "chat.schema.json",
  "chat.context_attach": "chat.schema.json",
  "chat.read_receipt": "chat.schema.json",
  "permission.request": "permission.schema.json",
  "permission.decision": "permission.schema.json",
};

/** 控制面板 UI 契约（非 phone envelope）→ schema */
export const CONTROL_PANEL_SCHEMA = {
  snapshot: "control-panel-snapshot.schema.json",
  reports: "control-panel-reports.schema.json",
} as const;

/**
 * 查询 message type 对应的顶层 schema 文件名。
 *
 * @param type 已知 MessageType
 * @returns schemas/ 下的文件名
 */
export function schemaFileForMessageType(type: MessageType): SchemaFileName {
  return MESSAGE_PAYLOAD_SCHEMA[type];
}
