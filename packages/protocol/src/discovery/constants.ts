/**
 * LAN discovery 常量。
 *
 * 职责：声明 DNS-SD 服务类型与广告字段名，供 companion advertise / browse 对齐。
 * 不拥有：mDNS 传输、配对信任、凭据或项目列表。
 * 纯函数：仅常量，无 I/O。
 */

/** DNS-SD 服务类型短名；完整形式为 `_lanxing-claw._tcp.local` */
export const LANXING_CLAW_DNS_SD_TYPE = "lanxing-claw" as const;

/** DNS-SD 协议（TCP） */
export const LANXING_CLAW_DNS_SD_PROTOCOL = "tcp" as const;

/** TXT 记录允许的键；禁止扩展为凭据或路径字段 */
export const DISCOVERY_TXT_KEYS = [
  "deviceName",
  "deviceIdHint",
  "serviceVersion",
  "protocolVersion",
  "pairingAvailable",
  "pairedPhoneIds",
  "capabilities",
] as const;

/** Discovery TXT 键名 */
export type DiscoveryTxtKey = (typeof DISCOVERY_TXT_KEYS)[number];
