/**
 * 将 identity 记录映射为权限页设备视图。
 *
 * 职责：剥离 pairingSecret，只输出可展示字段。
 * 不拥有：持久化、revoke 副作用、UI 渲染。
 * 纯函数：无 I/O。
 */

import type { DeviceIdentityRecord } from "../credentials/device-identity.js";
import type { PairedDeviceView } from "./views.js";

/**
 * identity → 配对设备视图；永远丢弃 pairingSecret。
 *
 * @param record 本地 identity
 * @param connectionLabel 连接态文案键或已翻译短标签
 * @param fingerprintHint 截断指纹；可空
 * @returns 不含秘密的视图
 */
export function toPairedDeviceView(
  record: DeviceIdentityRecord,
  connectionLabel: string,
  fingerprintHint: string | null,
): PairedDeviceView {
  return {
    pairingId: record.pairingId,
    phoneDeviceId: record.phoneDeviceId,
    phoneDisplayName: record.phoneDisplayName,
    desktopDeviceId: record.desktopDeviceId,
    connectionLabel,
    fingerprintHint,
    canRevoke: record.lifecycle === "active",
  };
}

/**
 * 断言视图未携带秘密字段名（供单测与门禁辅助）。
 *
 * @param view 设备视图
 * @returns 是否安全
 */
export function pairedDeviceViewLooksSafe(view: PairedDeviceView): boolean {
  const serialized = JSON.stringify(view);
  return !serialized.includes("pairingSecret") && !serialized.includes("apiKey");
}
