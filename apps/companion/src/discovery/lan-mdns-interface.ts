/**
 * LAN mDNS 网卡选择。
 *
 * 职责：从本机网卡中选择 phone 可达的 IPv4，用于约束 Bonjour 组播出口。
 * 不拥有：mDNS 广告内容、配对信任或协议监听 host。
 */

import os from "node:os";

export interface LanMdnsInterfaceCandidate {
  name: string;
  address: string;
}

export type LanMdnsInterfaceSelection =
  | { ok: true; candidate: LanMdnsInterfaceCandidate }
  | { ok: false; code: "mdns_interface_unavailable" };

export interface SelectLanMdnsInterfaceOptions {
  explicitAddress?: string;
}

function isIPv4Family(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.trim().split(".");
  if (parts.length !== 4) {
    return null;
  }
  const nums = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  return nums.every((num) => Number.isInteger(num) && num >= 0 && num <= 255) ? nums : null;
}

function isRejectedAddress(parts: number[]): boolean {
  const first = parts[0] ?? 0;
  const second = parts[1] ?? 0;
  return (
    first === 0 ||
    first === 127 ||
    first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function isVirtualInterfaceName(name: string): boolean {
  return /loopback|vethernet|hyper-v|default switch|wsl|clash|tunnel|\btap\b|\btun\b|docker|vmware|virtualbox|bluetooth/i.test(
    name,
  );
}

function scoreCandidate(candidate: LanMdnsInterfaceCandidate): number {
  const parts = parseIpv4(candidate.address);
  if (!parts || isRejectedAddress(parts) || isVirtualInterfaceName(candidate.name)) {
    return -1;
  }

  let score = 100;
  if (parts[0] === 192 && parts[1] === 168) {
    score += 80;
  } else if (parts[0] === 10) {
    score += 60;
  } else if (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) {
    score += 40;
  }
  if (/ethernet|以太网/i.test(candidate.name)) {
    score += 20;
  }
  if (/wi-?fi|wlan|wireless|无线/i.test(candidate.name)) {
    score += 15;
  }
  return score;
}

export function listLanMdnsInterfaceCandidates(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): LanMdnsInterfaceCandidate[] {
  const candidates: LanMdnsInterfaceCandidate[] = [];
  for (const [name, items] of Object.entries(interfaces)) {
    for (const item of items ?? []) {
      if (!item.internal && isIPv4Family(item.family)) {
        candidates.push({ name, address: item.address });
      }
    }
  }
  return candidates;
}

export function selectLanMdnsInterface(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
  options: SelectLanMdnsInterfaceOptions = {},
): LanMdnsInterfaceSelection {
  const explicitAddress = options.explicitAddress?.trim();
  const candidates = listLanMdnsInterfaceCandidates(interfaces);
  if (explicitAddress) {
    const selected = candidates.find(
      (candidate) => candidate.address === explicitAddress && scoreCandidate(candidate) >= 0,
    );
    return selected
      ? { ok: true, candidate: selected }
      : { ok: false, code: "mdns_interface_unavailable" };
  }

  let selected: LanMdnsInterfaceCandidate | null = null;
  let selectedScore = -1;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate);
    if (score > selectedScore) {
      selected = candidate;
      selectedScore = score;
    }
  }
  if (!selected || selectedScore < 0) {
    return { ok: false, code: "mdns_interface_unavailable" };
  }
  return { ok: true, candidate: selected };
}
