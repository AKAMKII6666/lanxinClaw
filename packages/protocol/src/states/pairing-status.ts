/**
 * Pairing 生命周期状态与合法迁移。
 *
 * 职责：声明 pairing status 集合，并判断状态迁移是否允许。
 * 不拥有：device identity 持久化、桌面 UI 确认、session 建立。
 * 纯函数：无 I/O；配对成功不授予执行权限。
 */

/** pairing 生命周期状态，与协议「配对.md」对齐 */
export const PAIRING_STATUSES = [
  "unpaired",
  "pairing_requested",
  "phone_confirmed",
  "desktop_confirmed",
  "paired",
  "pairing_rejected",
  "revoked",
] as const;

/** Pairing 生命周期状态 */
export type PairingStatus = (typeof PAIRING_STATUSES)[number];

const PAIRING_TRANSITIONS: Record<PairingStatus, readonly PairingStatus[]> = {
  unpaired: ["pairing_requested", "pairing_rejected"],
  pairing_requested: ["phone_confirmed", "pairing_rejected", "revoked"],
  phone_confirmed: ["desktop_confirmed", "pairing_rejected", "revoked"],
  desktop_confirmed: ["paired", "pairing_rejected", "revoked"],
  paired: ["revoked"],
  pairing_rejected: [],
  revoked: [],
};

/**
 * 判断值是否为合法 PairingStatus。
 *
 * @param value 待检测值
 * @returns 是否属于 PAIRING_STATUSES
 */
export function isPairingStatus(value: unknown): value is PairingStatus {
  return typeof value === "string" && (PAIRING_STATUSES as readonly string[]).includes(value);
}

/**
 * 判断 pairing 状态迁移是否允许。
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns 是否在允许表中；终态 pairing_rejected/revoked 无出边
 */
export function canTransitionPairingStatus(from: PairingStatus, to: PairingStatus): boolean {
  if (from === to) {
    return true;
  }
  return PAIRING_TRANSITIONS[from].includes(to);
}
