/**
 * 将监督 tick 动作落地为协议 envelope 与桌面提醒。
 *
 * 职责：执行 mark_waiting_acceptance / mark_blocked / notify；不得把 affair 写成 closed。
 * 不拥有：tick 决策、OpenClaw、权限。
 * 副作用：经 broadcast 更新 backend 并出站。
 */

import { canTransitionAffairStatus, type AffairPayload } from "@lanxin-claw/protocol";
import type { SupervisionAction } from "./types.js";
import {
  buildAffairUpdateEnvelope,
  type OutboundParty,
} from "../protocol-server/outbound-envelopes.js";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";

/**
 * 落地依赖。
 */
export interface ApplySupervisionDeps {
  /** 读 affair */
  getAffair: (affairId: string) => AffairPayload | undefined;
  /** 广播（apply + 可选 send） */
  broadcast: (envelope: ProtocolEnvelope) => void;
  /** 仅 apply backend（无 phone 时用） */
  applyOnly?: (envelope: ProtocolEnvelope) => void;
  /** 出站寻址；无电话时只 apply 本地 */
  party: OutboundParty | null;
  /** 桌面提醒 */
  onDesktopNotify?: (title: string, body: string) => void;
}

/**
 * 执行监督动作列表。
 *
 * @param actions tick 产出
 * @param deps 落地依赖
 */
export function applySupervisionActions(
  actions: readonly SupervisionAction[],
  deps: ApplySupervisionDeps,
): void {
  for (const action of actions) {
    if (action.kind === "mark_waiting_acceptance") {
      patchAffair(deps, action.affairId, (affair) => {
        if (!canTransitionAffairStatus(affair.status, "waiting_acceptance")) {
          return affair;
        }
        return { ...affair, status: "waiting_acceptance", currentJobId: action.jobId };
      });
      deps.onDesktopNotify?.("事务待验收", action.reason);
      continue;
    }
    if (action.kind === "mark_blocked") {
      patchAffair(deps, action.affairId, (affair) => {
        if (!canTransitionAffairStatus(affair.status, "blocked")) {
          return affair;
        }
        return {
          ...affair,
          status: "blocked",
          currentJobId: action.jobId,
          blockedReason: action.blockedReason,
          resumeCondition: action.resumeCondition,
        };
      });
      continue;
    }
    if (action.kind === "notify_blocked") {
      deps.onDesktopNotify?.(action.title, action.body);
    }
  }
}

/**
 * @param deps 依赖
 * @param affairId 事务
 * @param mutate 变换
 */
function patchAffair(
  deps: ApplySupervisionDeps,
  affairId: string,
  mutate: (affair: AffairPayload) => AffairPayload,
): void {
  const affair = deps.getAffair(affairId);
  if (!affair) {
    return;
  }
  const next = mutate(affair);
  if (next.status === "closed" || next.status === affair.status && next.blockedReason === affair.blockedReason && next.resumeCondition === affair.resumeCondition && next.currentJobId === affair.currentJobId) {
    return;
  }
  const envelope = buildAffairUpdateEnvelope(
    deps.party ?? { desktopDeviceId: "lanxin-desktop", phoneDeviceId: "unused" },
    next,
  );
  if (!deps.party) {
    deps.applyOnly?.(envelope);
    return;
  }
  deps.broadcast(buildAffairUpdateEnvelope(deps.party, next));
}
