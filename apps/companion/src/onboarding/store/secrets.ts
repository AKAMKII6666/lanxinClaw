/**
 * 密钥加密端口（Electron safeStorage 适配；测试可注入替身）。
 */

/** 加密端口 */
export interface SecretsPort {
  /** 加密；不可用时返回 null */
  encrypt(plain: string): string | null;
  /** 解密；失败返回 null */
  decrypt(encrypted: string): string | null;
  /** 是否可用 */
  isAvailable(): boolean;
}

/**
 * 不可用实现：拒绝加密，禁止把 secret 当明文落盘。
 * 生产路径在 safeStorage 不可用时使用本实现。
 *
 * @returns 端口
 */
export function createUnavailableSecrets(): SecretsPort {
  return {
    encrypt: () => null,
    decrypt: () => null,
    isAvailable: () => false,
  };
}

/**
 * 测试用明文往返；`isAvailable()` 为 true，仅单测注入，不得用于 Electron 生产落盘。
 *
 * @returns 端口
 */
export function createMemorySecrets(): SecretsPort {
  return {
    encrypt: (plain) => plain,
    decrypt: (encrypted) => encrypted,
    isAvailable: () => true,
  };
}

/**
 * @deprecated 使用 {@link createUnavailableSecrets} 或 {@link createMemorySecrets}
 * @returns 与 unavailable 相同（拒绝明文落盘）
 */
export function createNoopSecrets(): SecretsPort {
  return createUnavailableSecrets();
}
