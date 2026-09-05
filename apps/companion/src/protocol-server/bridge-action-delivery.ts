import { randomUUID } from "node:crypto";
import type { AffairPayload } from "@lanxin-claw/protocol";
import type { BridgeActionDelivery, BridgeUiAction } from "../bridge/contract.js";

/** bridge action 出站结果；delivery 是 UI 可见回执，不等于业务状态。 */
export interface BridgeProtocolActionDispatchResult {
  /** 错误文本；成功为 null */
  error: string | null;
  /** 投递回执；无协议动作时为 null */
  delivery: BridgeActionDelivery | null;
}

export interface BridgeActionDeliveryDeps {
  /** 读 affair，用于把回执绑定到当前 job */
  getAffair: (affairId: string) => AffairPayload | undefined;
}

export function createBridgeActionReceiptId(): string {
  return `bridge_receipt_${randomUUID().replace(/-/g, "")}`;
}

export function deliveryFor(
  action: BridgeUiAction,
  deps: BridgeActionDeliveryDeps,
  status: BridgeActionDelivery["status"],
  message: string,
  reasonCode: string | null,
): BridgeActionDelivery {
  const affairId = "affairId" in action ? action.affairId ?? null : null;
  const affair = affairId ? deps.getAffair(affairId) : undefined;
  return {
    actionReceiptId: createBridgeActionReceiptId(),
    status,
    affairId,
    jobId: affair?.currentJobId ?? null,
    deliveredAt: status === "sent_to_phone" ? new Date().toISOString() : null,
    reasonCode,
    message,
  };
}

export function ok(delivery: BridgeActionDelivery | null): BridgeProtocolActionDispatchResult {
  return { error: null, delivery };
}

export function rejected(
  action: BridgeUiAction,
  deps: BridgeActionDeliveryDeps,
  message: string,
  reasonCode: string,
): BridgeProtocolActionDispatchResult {
  return {
    error: message,
    delivery: deliveryFor(action, deps, "rejected", message, reasonCode),
  };
}
