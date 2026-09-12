/**
 * pairingSecret 加密持久化包装。
 *
 * 职责：落盘前加密 pairingSecret；不可用时拒绝写入。
 * 不拥有：配对状态机、session HMAC。
 * 副作用：委托内层 Persistence；不得把明文 secret 写日志。
 */

import type { SecretsPort } from "../../onboarding/store/secrets.js";
import type { DeviceIdentityRecord } from "../device-identity.js";
import type { IdentityPersistence } from "../identity-store.js";

/**
 * 加密包装。
 */
export class EncryptedIdentityPersistence implements IdentityPersistence {
  /**
   * @param inner 明文 JSON 后端
   * @param secrets 加密端口
   */
  constructor(
    private readonly inner: IdentityPersistence,
    private readonly secrets: SecretsPort,
  ) {}

  /**
   * @returns 解密后的记录
   */
  async loadAll(): Promise<DeviceIdentityRecord[]> {
    const records = await this.inner.loadAll();
    return records.map((record) => this.decryptRecord(record));
  }

  /**
   * @param records 含明文 pairingSecret 的记录
   */
  async saveAll(records: DeviceIdentityRecord[]): Promise<void> {
    if (!this.secrets.isAvailable()) {
      throw new Error("identity_secrets_unavailable");
    }
    const encrypted = records.map((record) => this.encryptRecord(record));
    await this.inner.saveAll(encrypted);
  }

  /**
   * @param record 明文记录
   * @returns 密文字段记录
   */
  private encryptRecord(record: DeviceIdentityRecord): DeviceIdentityRecord {
    if (!record.pairingSecret) {
      return { ...record };
    }
    const encrypted = this.secrets.encrypt(record.pairingSecret);
    if (encrypted === null) {
      throw new Error("identity_secrets_unavailable");
    }
    return { ...record, pairingSecret: encrypted };
  }

  /**
   * @param record 可能已加密的记录
   * @returns 明文 secret
   */
  private decryptRecord(record: DeviceIdentityRecord): DeviceIdentityRecord {
    if (!record.pairingSecret) {
      return { ...record };
    }
    const plain = this.secrets.decrypt(record.pairingSecret);
    if (plain === null) {
      return { ...record, pairingSecret: null };
    }
    return { ...record, pairingSecret: plain };
  }
}
