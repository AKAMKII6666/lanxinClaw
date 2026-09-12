/**
 * permission gate 授予落盘。
 *
 * 职责：把 pending 请求与 durable 授予写入本机 JSON；revoke pairing 时可清空。
 * 不拥有：UI、OpenClaw。
 * 副作用：读写 JSON。
 */

import { JsonFilePersistence } from "../../persistence/json-file.js";
import type { GatePermissionRequest, PermissionGrantRecord, PermissionQueueStatus } from "./types.js";

/** 落盘快照 */
export interface PermissionGateDump {
  /** schema */
  schemaVersion: 1;
  /** 请求 */
  requests: GatePermissionRequest[];
  /** 队列态 */
  queueStatus: Array<[string, PermissionQueueStatus]>;
  /** 授予 */
  grants: PermissionGrantRecord[];
  /** grant 序号 */
  grantSeq: number;
}

/**
 * @param filePath JSON 路径
 * @returns dump 读写
 */
export function createFilePermissionGateStore(filePath: string): {
  load(): PermissionGateDump;
  save(dump: PermissionGateDump): void;
} {
  const persistence = new JsonFilePersistence<PermissionGateDump>(filePath, {
    schemaVersion: 1,
    requests: [],
    queueStatus: [],
    grants: [],
    grantSeq: 0,
  });
  return {
    load: () => persistence.load(),
    save: (dump) => persistence.save(dump),
  };
}
