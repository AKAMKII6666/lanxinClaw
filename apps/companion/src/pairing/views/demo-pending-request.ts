/**
 * 首次 Pairing 弹窗演示请求（真实 discovery 接手前的安全占位）。
 *
 * 职责：提供设备指纹提示与双确认文案样例。
 * 不拥有：mDNS、challenge、identity store。
 * 纯函数：返回静态结构；不含 pairingSecret。
 */

import { formatFingerprintHint } from "./format-fingerprint-hint.js";
import type { PendingPairingRequestView } from "./pending-request-view.js";

/**
 * 构造待确认配对演示视图。
 *
 * @returns 可渲染且无秘密的配对请求视图
 */
export function createDemoPendingPairingRequest(): PendingPairingRequestView {
  return {
    pairingId: "pair_pending_001",
    phoneDeviceId: "phone_lanxing_001",
    phoneDisplayName: "澜星电话 LxPhone-01",
    fingerprintHint: formatFingerprintHint("8F2A9C01DEADBEEF"),
    discoveryMethodLabel: "LAN mDNS",
    statusLabel: "pairing 中",
    summary:
      "发现一台澜星电话请求与本机 Claw Companion 配对。确认后双方建立可信会话；未确认前不会传输凭据或项目信息。",
    dualConfirmHint:
      "建议同时在电话端确认。配对身份用于后续会话认证，不以 IP 或设备名代替。",
  };
}
