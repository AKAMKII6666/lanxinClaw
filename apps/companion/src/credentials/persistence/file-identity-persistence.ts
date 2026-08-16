/**
 * Device identity 文件持久化。
 *
 * 职责：用本机 JSON 文件保存已配对 identity，供重启后重连认证。
 * 不拥有：OS secure storage、pairing 状态机、权限裁决。
 * 副作用：读写本机 JSON 文件；不得写日志泄露 pairingSecret。
 */

import type { DeviceIdentityRecord } from "../device-identity.js";
import type { IdentityPersistence } from "../identity-store.js";
import { JsonFilePersistence } from "../../persistence/json-file.js";

/**
 * 文件根对象。
 */
interface IdentityFileRoot {
  /** schema 版本 */
  schemaVersion: 1;
  /** identity 记录 */
  records: DeviceIdentityRecord[];
}

/**
 * Identity 文件 persistence。
 */
export class FileIdentityPersistence implements IdentityPersistence {
  private readonly persistence: JsonFilePersistence<IdentityFileRoot>;

  /**
   * @param filePath 文件路径
   */
  constructor(filePath: string) {
    this.persistence = new JsonFilePersistence(filePath, { schemaVersion: 1, records: [] });
  }

  /**
   * @returns 全部 identity
   */
  async loadAll(): Promise<DeviceIdentityRecord[]> {
    const root = this.persistence.load();
    return root.records.map((item) => ({ ...item }));
  }

  /**
   * @param records 完整记录
   */
  async saveAll(records: DeviceIdentityRecord[]): Promise<void> {
    this.persistence.save({
      schemaVersion: 1,
      records: records.map((item) => ({ ...item })),
    });
  }
}
