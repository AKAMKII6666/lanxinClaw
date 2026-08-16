/**
 * 内存中的进行中 / 已完成配对会话。
 *
 * 职责：保存单次 pairing 流程的状态与 challenge 上下文。
 * 不拥有：OS 安全存储、跨进程持久化、执行权限授予。
 * 副作用：仅持有调用方传入的可变会话对象引用。
 */

import type { PairingStatus } from "@lanxin-claw/protocol";

/**
 * Companion 侧 pairing 会话（内存；完成后由 credentials identity store 持久化）。
 */
export interface PairingSession {
  /** 配对流程 id */
  pairingId: string;
  /** 当前生命周期状态 */
  status: PairingStatus;
  /** 电话设备 id */
  phoneDeviceId: string;
  /** 电话展示名 */
  phoneDisplayName: string;
  /** 桌面设备 id */
  desktopDeviceId: string;
  /** 桌面展示名 */
  desktopDisplayName: string;
  /** 当前 challenge；未发出或已清时为 null */
  challenge: string | null;
  /** challenge 过期时间 ISO-8601 */
  expiresAt: string | null;
  /** 电话确认时间 */
  phoneConfirmedAt: string | null;
  /** 桌面批准时间 */
  desktopApprovedAt: string | null;
  /** 配对完成时间 */
  pairedAt: string | null;
  /** 电话侧能力声明摘要 */
  capabilities: string[];
}

/**
 * 创建处于 unpaired 的空会话骨架（request 受理前不使用）。
 *
 * @param input 身份字段
 * @returns 初始会话
 */
export function createEmptyPairingSession(input: {
  pairingId: string;
  phoneDeviceId: string;
  phoneDisplayName: string;
  desktopDeviceId: string;
  desktopDisplayName: string;
  capabilities: string[];
}): PairingSession {
  return {
    pairingId: input.pairingId,
    status: "unpaired",
    phoneDeviceId: input.phoneDeviceId,
    phoneDisplayName: input.phoneDisplayName,
    desktopDeviceId: input.desktopDeviceId,
    desktopDisplayName: input.desktopDisplayName,
    challenge: null,
    expiresAt: null,
    phoneConfirmedAt: null,
    desktopApprovedAt: null,
    pairedAt: null,
    capabilities: [...input.capabilities],
  };
}
