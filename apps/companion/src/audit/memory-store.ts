/**
 * 内存审计存储。
 *
 * 职责：追加/查询审计记录；写入前剥离敏感字段名。
 * 不拥有：磁盘持久化、权限裁决、OpenClaw。
 * 副作用：仅改本实例数组。
 */

import type { AuditEventKind, AuditRecord, AuditRecordView } from "./types.js";

const KIND_LABEL: Record<AuditEventKind, string> = {
  pairing: "配对",
  permission: "权限",
  job: "Job",
  high_risk_action: "高风险动作",
  acceptance: "验收",
};

const FORBIDDEN_SUBSTRINGS = [
  "apiKey",
  "API key",
  "pairingSecret",
  "privateKey",
  "私钥",
  "Bearer ",
];

/**
 * 追加审计条目的输入；禁止凭据。
 */
export interface AppendAuditInput {
  /** 类别 */
  kind: AuditEventKind;
  /** 摘要 */
  summary: string;
  /** 时间；缺省用 now */
  at?: string;
  /** 事务 id */
  affairId?: string | null;
  /** job id */
  jobId?: string | null;
  /** 权限请求 id */
  permissionRequestId?: string | null;
  /** 结果 */
  outcome?: string | null;
  /** 风险 */
  risk?: "low" | "medium" | "high" | null;
}

/**
 * 内存审计 store。
 */
export class MemoryAuditStore {
  #records: AuditRecord[] = [];
  #seq = 0;

  /**
   * 追加一条；摘要含敏感子串则拒绝。
   *
   * @param input 条目
   * @returns 成功记录或错误
   */
  append(
    input: AppendAuditInput,
  ): { ok: true; record: AuditRecord } | { ok: false; code: string; message: string } {
    const summary = input.summary.trim();
    if (!summary) {
      return { ok: false, code: "audit_empty", message: "审计摘要不能为空" };
    }
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      if (summary.includes(bad)) {
        return {
          ok: false,
          code: "audit_secret_forbidden",
          message: "审计不得记录凭据或密钥相关明文",
        };
      }
    }
    this.#seq += 1;
    const record: AuditRecord = {
      auditId: `audit_${String(this.#seq).padStart(4, "0")}`,
      kind: input.kind,
      at: input.at ?? new Date().toISOString(),
      summary,
      affairId: input.affairId ?? null,
      jobId: input.jobId ?? null,
      permissionRequestId: input.permissionRequestId ?? null,
      outcome: input.outcome ?? null,
      risk: input.risk ?? null,
    };
    this.#records.push(record);
    return { ok: true, record };
  }

  /**
   * 按时间倒序列出。
   *
   * @param limit 最多条数
   * @returns 记录
   */
  listRecent(limit = 50): AuditRecord[] {
    return this.#records.slice(-limit).reverse();
  }

  /**
   * 转为权限页视图。
   *
   * @param limit 最多条数
   * @returns 视图行
   */
  toViews(limit = 50): AuditRecordView[] {
    return this.listRecent(limit).map((r) => ({
      auditId: r.auditId,
      kindLabel: KIND_LABEL[r.kind],
      at: r.at,
      summary: r.summary,
      outcome: r.outcome,
    }));
  }
}

/**
 * 创建空审计 store。
 *
 * @returns 新 store
 */
export function createMemoryAuditStore(): MemoryAuditStore {
  return new MemoryAuditStore();
}
