/** 配对状态推进。职责：校验可达状态并构造转移；不拥有身份凭据和网络。副作用：更新传入的配对状态。 */
import {
canTransitionPairingStatus,
createProtocolError,
type PairingStatus
} from "@lanxin-claw/protocol";
import { type PairingSession } from "../session.js";
import type { PairingHandleResult } from "./types.js";


/**
 * 尝试迁移会话状态；非法迁移返回错误。
 *
 * @param session 会话
 * @param to 目标状态
 * @returns 结果
 */
export function transition(session: PairingSession, to: PairingStatus): PairingHandleResult {
  if (!canTransitionPairingStatus(session.status, to)) {
    return {
      ok: false,
      error: createProtocolError(
        "pairing_illegal_transition",
        `pairing 状态不可从 ${session.status} 迁到 ${to}`,
        false,
        { from: session.status, to },
      ),
    };
  }
  session.status = to;
  return { ok: true };
}

/**
 * 构造可选 correlationId 入参，避免传入 null（exactOptionalPropertyTypes）。
 *
 * @param correlationId 可选关联
 * @returns 仅含定义时的字段
 */
export function optionalCorrelation(correlationId?: string): { correlationId?: string } {
  if (correlationId === undefined) {
    return {};
  }
  return { correlationId };
}
