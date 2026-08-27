/**
 * 从 Electron safeStorage 构造 SecretsPort。
 *
 * 职责：把 DPAPI/safeStorage 接到 onboarding/identity 加密口。
 * 不拥有：落盘路径、配对状态机。
 * 副作用：调用 OS 加密 API；不可用时返回 null，禁止明文落盘。
 */

import { createUnavailableSecrets, type SecretsPort } from "../../onboarding/store/secrets.js";
import type { ElectronRuntime } from "./electron-runtime.js";

/**
 * @param safeStorage Electron safeStorage；缺省则不可用
 * @returns 加密端口
 */
export function createSecretsFromSafeStorage(
  safeStorage: ElectronRuntime["safeStorage"] | undefined,
): SecretsPort {
  if (!safeStorage) {
    return createUnavailableSecrets();
  }
  return {
    encrypt: (plain) => {
      try {
        if (!safeStorage.isEncryptionAvailable()) {
          return null;
        }
        const encrypted = safeStorage.encryptString(plain);
        return Buffer.isBuffer(encrypted) ? encrypted.toString("base64") : encrypted;
      } catch {
        return null;
      }
    },
    decrypt: (encrypted) => {
      try {
        if (!safeStorage.isEncryptionAvailable()) {
          return null;
        }
        const buf = Buffer.from(encrypted, "base64");
        return safeStorage.decryptString(buf);
      } catch {
        return null;
      }
    },
    isAvailable: () => safeStorage.isEncryptionAvailable(),
  };
}
