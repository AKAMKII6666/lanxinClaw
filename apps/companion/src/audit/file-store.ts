/**
 * 审计文件 store。
 *
 * 职责：持久化脱敏 audit 记录，供重启后诊断与权限页查看。
 * 不拥有：权限裁决、协议路由、凭据存储。
 * 副作用：读写本机 JSON 文件。
 */

import type { AuditRecord } from "./types.js";
import { createMemoryAuditStore, type AppendAuditInput } from "./memory-store.js";
import { JsonFilePersistence } from "../persistence/json-file.js";

/**
 * Audit 文件根。
 */
interface AuditFileRoot {
  /** schema 版本 */
  schemaVersion: 1;
  /** records */
  records: AuditRecord[];
}

/**
 * Audit 持久化 port。
 */
export interface AuditPersistence {
  /** 追加审计 */
  append: (record: AppendAuditInput) => { ok: true; record: AuditRecord } | { ok: false; code: string; message: string };
  /** 最近记录 */
  listRecent: (limit?: number) => AuditRecord[];
}

/** 文件 audit store 对外接口 */
export type FileAuditStore = AuditPersistence;

/**
 * 创建文件 audit store。
 *
 * @param filePath 文件路径
 * @returns audit store
 */
export function createFileAuditStore(filePath: string): FileAuditStore {
  const persistence = new JsonFilePersistence<AuditFileRoot>(filePath, {
    schemaVersion: 1,
    records: [],
  });
  const memory = createMemoryAuditStore();
  for (const record of persistence.load().records) {
    memory.append({
      kind: record.kind,
      summary: record.summary,
      at: record.at,
      affairId: record.affairId,
      jobId: record.jobId,
      permissionRequestId: record.permissionRequestId,
      outcome: record.outcome,
      risk: record.risk,
    });
  }
  return {
    append(record) {
      const result = memory.append(record);
      persistence.save({ schemaVersion: 1, records: memory.listRecent() });
      return result;
    },
    listRecent(limit) {
      return memory.listRecent(limit);
    },
  };
}
