/**
 * Backend runtime 审计辅助。
 *
 * 职责：把协议应用失败、协议事件、bridge action 投影为审计记录。
 * 不拥有：backend state、bridge host、协议状态机。
 * 副作用：仅写入注入的 audit store / permission gate。
 */

import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { AppendAuditInput } from "../audit/memory-store.js";
import type { AuditEventKind, AuditRecord, AuditRecordView } from "../audit/types.js";
import type { BridgeActionResult, BridgeUiAction } from "../bridge/contract.js";
import type { PermissionGate } from "../permissions/gate/permission-gate.js";
import type { ApplyProtocolResult } from "../state/types.js";

type RuntimeAuditStore = {
  append: (record: AppendAuditInput) => { ok: true; record: AuditRecord } | { ok: false; code: string; message: string };
  listRecent: (limit?: number) => AuditRecord[];
};

const KIND_LABEL: Record<AuditEventKind, string> = {
  pairing: "配对",
  permission: "权限",
  job: "Job",
  high_risk_action: "高风险动作",
  acceptance: "验收",
};

export function auditRecordsToViews(records: readonly AuditRecord[]): AuditRecordView[] {
  return records.map((r) => ({
    auditId: r.auditId,
    kindLabel: KIND_LABEL[r.kind],
    at: r.at,
    summary: r.summary,
    outcome: r.outcome,
  }));
}

export function appendAuditForApplyFailure(
  auditStore: RuntimeAuditStore,
  envelope: ProtocolEnvelope,
  result: Exclude<ApplyProtocolResult, { ok: true }>,
): void {
  const payload = envelope.payload as { affairId?: string; jobId?: string; permissionRequestId?: string };
  const kind: AuditEventKind = envelope.type.startsWith("permission.")
    ? "permission"
    : envelope.type.startsWith("pairing.") || envelope.type.startsWith("session.")
      ? "pairing"
      : "job";
  auditStore.append({
    kind,
    summary: `协议事件 ${envelope.type} 被拒绝：${result.message}`,
    affairId: payload.affairId ?? null,
    jobId: payload.jobId ?? null,
    permissionRequestId: payload.permissionRequestId ?? null,
    outcome: result.code,
  });
}

export function expirePermissionsForTerminalAffair(
  gate: PermissionGate,
  auditStore: RuntimeAuditStore,
  envelope: ProtocolEnvelope,
): void {
  if (!envelope.type.startsWith("affair.")) {
    return;
  }
  const payload = envelope.payload as { affairId?: string; status?: string };
  if (!payload.affairId || (payload.status !== "closed" && payload.status !== "canceled")) {
    return;
  }
  const expired = gate.expirePendingForAffair(payload.affairId);
  for (const permissionRequestId of expired.expired) {
    auditStore.append({
      kind: "permission",
      summary: "事务已结束，权限请求失效",
      permissionRequestId,
      affairId: payload.affairId,
      outcome: "expired",
    });
  }
}

export function appendAuditForEnvelope(
  auditStore: RuntimeAuditStore,
  envelope: ProtocolEnvelope,
): void {
  const payload = envelope.payload as { affairId?: string; jobId?: string; permissionRequestId?: string; status?: string };
  if (envelope.type.startsWith("job.")) {
    auditStore.append({
      kind: "job",
      summary: `协议事件 ${envelope.type}`,
      affairId: payload.affairId ?? null,
      jobId: payload.jobId ?? null,
      permissionRequestId: payload.permissionRequestId ?? null,
      outcome: payload.status ?? envelope.type,
    });
    return;
  }
  if (envelope.type.startsWith("pairing.") || envelope.type.startsWith("session.")) {
    auditStore.append({
      kind: "pairing",
      summary: `协议事件 ${envelope.type}`,
      outcome: envelope.type,
    });
  }
}

export function appendAuditForBridgeAction(
  auditStore: RuntimeAuditStore,
  action: BridgeUiAction,
  result: BridgeActionResult,
): void {
  if (action.type === "permission.decide") {
    auditStore.append({
      kind: "permission",
      summary: "桌面用户完成权限裁决",
      permissionRequestId: action.permissionRequestId,
      outcome: action.decision,
    });
    return;
  }
  if (action.type === "pairing.approve" || action.type === "pairing.reject") {
    auditStore.append({
      kind: "pairing",
      summary: `桌面用户提交 ${action.type}`,
      outcome: result.ok ? result.acceptedAction : action.type,
    });
    return;
  }
  if (action.type.startsWith("affair.")) {
    auditStore.append({
      kind: action.type === "affair.accept" || action.type === "affair.requestAcceptance"
        ? "acceptance"
        : "job",
      summary: summaryForAffairBridgeAction(action.type),
      affairId: "affairId" in action ? action.affairId : null,
      outcome: result.ok ? result.delivery?.status ?? result.acceptedAction : action.type,
    });
  }
}

function summaryForAffairBridgeAction(type: BridgeUiAction["type"]): string {
  switch (type) {
    case "affair.accept":
      return "桌面用户接受事务结果";
    case "affair.requestRevision":
      return "桌面用户要求继续处理事务";
    case "affair.requestAcceptance":
      return "桌面用户请求张老板回报事务状态";
    case "affair.cancel":
      return "桌面用户取消事务";
    case "affair.pause":
      return "桌面用户暂停事务";
    case "affair.resume":
      return "桌面用户继续处理事务";
    default:
      return `桌面用户提交 ${type}`;
  }
}
