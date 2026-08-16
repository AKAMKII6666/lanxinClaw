/**
 * Discovery 广告载荷编解码与校验。
 *
 * 职责：定义 companion mDNS TXT 广告形状，并在编解码时拒绝凭据/路径等敏感键。
 * 不拥有：真实 mDNS 收发、配对状态机、session 认证。
 * 纯函数：无网络 I/O；Discovery ≠ trust。
 */

import { PROTOCOL_VERSION, type ProtocolVersion } from "../protocol-version.js";
import { DISCOVERY_TXT_KEYS, type DiscoveryTxtKey } from "./constants.js";
import type { ValidateResult } from "../validators/result.js";
import { validationFailed } from "../errors/protocol-error.js";

/** 禁止出现在 discovery TXT 中的敏感键片段（大小写不敏感） */
const FORBIDDEN_KEY_FRAGMENTS = [
  "credential",
  "secret",
  "apikey",
  "api_key",
  "token",
  "password",
  "private",
  "path",
  "filepath",
  "username",
  "project",
] as const;

/**
 * Companion 在 LAN 上广告的能力摘要；不得含凭据或项目细节。
 */
export interface DiscoveryAdvertisement {
  /** 桌面展示名 */
  deviceName: string;
  /** 设备指纹提示；非完整私钥 */
  deviceIdHint: string;
  /** companion 服务版本 */
  serviceVersion: string;
  /** 协议版本 */
  protocolVersion: ProtocolVersion;
  /** 是否接受新配对 */
  pairingAvailable: boolean;
  /** 已配对电话 id 摘要；可为空 */
  pairedPhoneIds: string[];
  /** 能力声明 */
  capabilities: string[];
}

/**
 * DNS-SD TXT 记录：值均为短字符串。
 */
export type DiscoveryTxtRecord = Record<DiscoveryTxtKey, string>;

/**
 * 判断键名是否触及禁止片段。
 *
 * @param key 原始键名
 * @returns 是否敏感
 */
function isForbiddenDiscoveryKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return FORBIDDEN_KEY_FRAGMENTS.some((frag) => normalized.includes(frag));
}

/**
 * 将广告对象编码为 DNS-SD TXT 字符串表。
 *
 * @param ad 广告载荷
 * @returns TXT 记录；列表字段用逗号拼接
 */
export function encodeDiscoveryTxt(ad: DiscoveryAdvertisement): DiscoveryTxtRecord {
  return {
    deviceName: ad.deviceName,
    deviceIdHint: ad.deviceIdHint,
    serviceVersion: ad.serviceVersion,
    protocolVersion: ad.protocolVersion,
    pairingAvailable: ad.pairingAvailable ? "true" : "false",
    pairedPhoneIds: ad.pairedPhoneIds.join(","),
    capabilities: ad.capabilities.join(","),
  };
}

/**
 * 将 TXT 字符串表解码为广告对象。
 *
 * @param txt 原始 TXT（可含多余键）
 * @returns 校验结果；含敏感键或缺字段时失败
 */
export function decodeDiscoveryTxt(txt: Record<string, unknown>): ValidateResult<DiscoveryAdvertisement> {
  for (const key of Object.keys(txt)) {
    if (isForbiddenDiscoveryKey(key)) {
      return { ok: false, error: validationFailed("discovery TXT 不得包含凭据或敏感键", { key }) };
    }
  }

  for (const required of DISCOVERY_TXT_KEYS) {
    if (!(required in txt)) {
      return { ok: false, error: validationFailed("discovery TXT 缺少必填键", { key: required }) };
    }
    if (typeof txt[required] !== "string") {
      return { ok: false, error: validationFailed("discovery TXT 值必须是字符串", { key: required }) };
    }
  }

  const deviceName = (txt.deviceName as string).trim();
  const deviceIdHint = (txt.deviceIdHint as string).trim();
  const serviceVersion = (txt.serviceVersion as string).trim();
  const protocolVersionRaw = (txt.protocolVersion as string).trim();
  const pairingAvailableRaw = (txt.pairingAvailable as string).trim().toLowerCase();
  const pairedPhoneIdsRaw = (txt.pairedPhoneIds as string).trim();
  const capabilitiesRaw = (txt.capabilities as string).trim();

  if (!deviceName || !deviceIdHint || !serviceVersion) {
    return { ok: false, error: validationFailed("discovery TXT 必填字段不得为空") };
  }
  if (protocolVersionRaw !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: validationFailed("discovery protocolVersion 不支持", { protocolVersion: protocolVersionRaw }),
    };
  }
  if (pairingAvailableRaw !== "true" && pairingAvailableRaw !== "false") {
    return { ok: false, error: validationFailed("pairingAvailable 必须是 true 或 false") };
  }

  const splitList = (raw: string): string[] =>
    raw.length === 0 ? [] : raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

  return {
    ok: true,
    value: {
      deviceName,
      deviceIdHint,
      serviceVersion,
      protocolVersion: protocolVersionRaw as ProtocolVersion,
      pairingAvailable: pairingAvailableRaw === "true",
      pairedPhoneIds: splitList(pairedPhoneIdsRaw),
      capabilities: splitList(capabilitiesRaw),
    },
  };
}

/**
 * 将列表或标量规范为逗号串。
 *
 * @param value 数组或其它
 * @returns TXT 列表字符串
 */
function listFieldToTxt(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(String).join(",");
  }
  return String(value ?? "");
}

/**
 * 将 pairingAvailable 规范为 TXT 布尔串。
 *
 * @param value 原始值
 * @returns "true" / "false" / 其它原串
 */
function pairingAvailableToTxt(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value ?? "");
}

/**
 * 校验对象键：拒绝敏感键与未知键。
 *
 * @param obj 广告对象
 * @returns 错误或 null
 */
function rejectBadAdvertisementKeys(obj: Record<string, unknown>): ValidateResult<never> | null {
  for (const key of Object.keys(obj)) {
    if (isForbiddenDiscoveryKey(key)) {
      return {
        ok: false,
        error: validationFailed("discovery advertisement 不得包含凭据或敏感键", { key }),
      };
    }
    if (!(DISCOVERY_TXT_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: validationFailed("discovery advertisement 含未知字段", { key }) };
    }
  }
  return null;
}

/**
 * 校验内存中的广告对象（编码前）。
 *
 * @param value 未知输入
 * @returns 合法 DiscoveryAdvertisement 或错误
 */
export function validateDiscoveryAdvertisement(value: unknown): ValidateResult<DiscoveryAdvertisement> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: validationFailed("discovery advertisement 必须是对象") };
  }
  const obj = value as Record<string, unknown>;
  const keyError = rejectBadAdvertisementKeys(obj);
  if (keyError) {
    return keyError;
  }
  return decodeDiscoveryTxt({
    deviceName: String(obj.deviceName ?? ""),
    deviceIdHint: String(obj.deviceIdHint ?? ""),
    serviceVersion: String(obj.serviceVersion ?? ""),
    protocolVersion: String(obj.protocolVersion ?? ""),
    pairingAvailable: pairingAvailableToTxt(obj.pairingAvailable),
    pairedPhoneIds: listFieldToTxt(obj.pairedPhoneIds),
    capabilities: listFieldToTxt(obj.capabilities),
  });
}
