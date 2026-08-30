/**
 * Device identity 本地存储：保存、重连校验、revoke。
 *
 * 职责：在 companion 侧持久化已配对 identity，并据此认证 session.open。
 * 不拥有：pairing 状态机、WebSocket 传输、权限/OpenClaw、桌面 UI。
 * 副作用：经注入的 Persistence 读写；不得把 pairingSecret 打到日志。
 */

import type { SessionOpenPayload } from "@lanxin-claw/protocol";
import { createPairingSecret, verifySessionAuthProof } from "./auth-proof.js";
import type { DeviceIdentityRecord } from "./device-identity.js";

/**
 * Identity 持久化后端；测试用内存，桌面可用用户目录文件。
 */
export interface IdentityPersistence {
  /**
   * 读取全部记录。
   *
   * @returns 当前快照副本语义由实现保证
   */
  loadAll(): Promise<DeviceIdentityRecord[]>;
  /**
   * 覆写全部记录。
   *
   * @param records 完整列表
   */
  saveAll(records: DeviceIdentityRecord[]): Promise<void>;
}

/**
 * 从配对完成上下文构造并保存 identity 时的入参。
 */
export interface SavePairedIdentityInput {
  /** 配对流程 id */
  pairingId: string;
  /** 电话设备 id */
  phoneDeviceId: string;
  /** 电话展示名 */
  phoneDisplayName: string;
  /** 桌面设备 id */
  desktopDeviceId: string;
  /** 桌面展示名 */
  desktopDisplayName: string;
  /** 已交付给 phone 的配对共享秘密；缺省时由 store 生成 */
  pairingSecret?: string;
  /** 配对完成时间 ISO-8601 */
  pairedAt: string;
}

/**
 * 重连认证成功。
 */
export interface ReconnectAuthOk {
  /** 成功 */
  ok: true;
  /** 命中的 active identity（不含向日志导出 pairingSecret） */
  identity: DeviceIdentityRecord;
}

/**
 * 重连认证失败；映射 session.reauth_required。
 */
export interface ReconnectAuthErr {
  /** 失败 */
  ok: false;
  /** reopen=证明错；repair=无身份或已 revoke */
  requiredAction: "reopen" | "repair";
  /** 人类可读原因；不得含配对秘密 */
  reason: string;
}

/** 重连认证结果 */
export type ReconnectAuthResult = ReconnectAuthOk | ReconnectAuthErr;

/**
 * Device identity store 对外 API（方法写成属性，便于字段级契约注释）。
 */
export type DeviceIdentityStore = {
  /** 配对完成后保存 identity；同设备再配对会替换并轮换 pairingSecret */
  savePairedIdentity: (input: SavePairedIdentityInput) => Promise<DeviceIdentityRecord>;
  /** 按 phone+desktop 查找记录（含 revoked）；未找到为 null */
  findIdentity: (phoneDeviceId: string, desktopDeviceId: string) => Promise<DeviceIdentityRecord | null>;
  /** 列出 active 设备；pairingSecret 仍在对象内，UI 不得展示 */
  listActiveIdentities: () => Promise<DeviceIdentityRecord[]>;
  /** 撤销已配对身份；幂等；不存在返回 null */
  revokeIdentity: (phoneDeviceId: string, desktopDeviceId: string, reason: string, revokedAt: string) => Promise<DeviceIdentityRecord | null>;
  /** 用 session.open 做重连认证；不得因端口存在而接受 */
  authenticateReconnect: (payload: SessionOpenPayload) => Promise<ReconnectAuthResult>;
};

/**
 * 设备对主键。
 *
 * @param phoneDeviceId 电话 id
 * @param desktopDeviceId 桌面 id
 * @returns 稳定键
 */
function devicePairKey(phoneDeviceId: string, desktopDeviceId: string): string {
  return `${phoneDeviceId}\0${desktopDeviceId}`;
}

/**
 * 创建基于 Persistence 的 identity store。
 *
 * @param persistence 读写后端
 * @returns store
 */
export function createDeviceIdentityStore(persistence: IdentityPersistence): DeviceIdentityStore {
  return {
    async savePairedIdentity(input) {
      const records = await persistence.loadAll();
      const key = devicePairKey(input.phoneDeviceId, input.desktopDeviceId);
      const next: DeviceIdentityRecord = {
        pairingId: input.pairingId,
        phoneDeviceId: input.phoneDeviceId,
        phoneDisplayName: input.phoneDisplayName,
        desktopDeviceId: input.desktopDeviceId,
        desktopDisplayName: input.desktopDisplayName,
        pairingSecret: input.pairingSecret ?? createPairingSecret(),
        lifecycle: "active",
        pairedAt: input.pairedAt,
        revokedAt: null,
        revokeReason: null,
      };
      const kept = records.filter(
        (r) => devicePairKey(r.phoneDeviceId, r.desktopDeviceId) !== key,
      );
      kept.push(next);
      await persistence.saveAll(kept);
      return next;
    },

    async findIdentity(phoneDeviceId, desktopDeviceId) {
      const records = await persistence.loadAll();
      const key = devicePairKey(phoneDeviceId, desktopDeviceId);
      return (
        records.find((r) => devicePairKey(r.phoneDeviceId, r.desktopDeviceId) === key) ?? null
      );
    },

    async listActiveIdentities() {
      const records = await persistence.loadAll();
      return records.filter((r) => r.lifecycle === "active");
    },

    async revokeIdentity(phoneDeviceId, desktopDeviceId, reason, revokedAt) {
      const records = await persistence.loadAll();
      const key = devicePairKey(phoneDeviceId, desktopDeviceId);
      let updated: DeviceIdentityRecord | null = null;
      const next = records.map((r) => {
        if (devicePairKey(r.phoneDeviceId, r.desktopDeviceId) !== key) {
          return r;
        }
        if (r.lifecycle === "revoked") {
          updated = r;
          return r;
        }
        updated = {
          ...r,
          lifecycle: "revoked",
          pairingSecret: null,
          revokedAt,
          revokeReason: reason,
        };
        return updated;
      });
      if (updated !== null) {
        await persistence.saveAll(next);
      }
      return updated;
    },

    async authenticateReconnect(payload) {
      const identity = await this.findIdentity(payload.phoneDeviceId, payload.desktopDeviceId);
      if (!identity) {
        return {
          ok: false,
          requiredAction: "repair",
          reason: "未找到已配对 identity，须重新 pairing",
        };
      }
      if (identity.lifecycle === "revoked" || !identity.pairingSecret) {
        return {
          ok: false,
          requiredAction: "repair",
          reason: "identity 已撤销，须重新 pairing",
        };
      }
      if (
        !verifySessionAuthProof(identity.pairingSecret, payload.sessionId, payload.authProof)
      ) {
        return {
          ok: false,
          requiredAction: "reopen",
          reason: "authProof 无效，不得以发现端口代替认证",
        };
      }
      return { ok: true, identity };
    },
  };
}

/**
 * 内存 Persistence；单测与无磁盘环境使用。
 */
export class MemoryIdentityPersistence implements IdentityPersistence {
  private records: DeviceIdentityRecord[] = [];

  /**
   * @returns 当前记录浅拷贝列表
   */
  async loadAll(): Promise<DeviceIdentityRecord[]> {
    return this.records.map((r) => ({ ...r }));
  }

  /**
   * @param records 完整列表
   */
  async saveAll(records: DeviceIdentityRecord[]): Promise<void> {
    this.records = records.map((r) => ({ ...r }));
  }
}
