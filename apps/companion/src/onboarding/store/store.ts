/**
 * onboarding 配置持久化：JSON 文件 + 加密 apiKey。
 */

import fs from "node:fs";
import path from "node:path";
import { JsonFilePersistence } from "../../persistence/json-file.js";
import type { SecretsPort } from "./secrets.js";
import type { OnboardingConfig, OnboardingProvider } from "../types.js";

/** 磁盘文件根 */
interface OnboardingFileRoot {
  schemaVersion: 1;
  provider: OnboardingProvider;
  apiKeyEncrypted: string;
  endpoint: string | null;
  modelRef: string;
  updatedAt: string;
}

/** 配置存储 */
export interface OnboardingStore {
  /** 读取配置；无配置返回 null */
  load(): OnboardingConfig | null;
  /** 保存配置（apiKey 加密后落盘） */
  save(config: OnboardingConfig): void;
  /** 清除配置 */
  clear(): void;
}

/**
 * 文件版配置存储。
 *
 * @param filePath 文件路径
 * @param secrets 加密端口
 * @returns store
 */
export function createFileOnboardingStore(
  filePath: string,
  secrets: SecretsPort,
): OnboardingStore {
  const persistence = new JsonFilePersistence<OnboardingFileRoot | null>(filePath, null);
  return {
    load() {
      const root = persistence.load();
      if (!root || !root.apiKeyEncrypted) {
        return null;
      }
      const apiKey = secrets.decrypt(root.apiKeyEncrypted);
      if (apiKey === null || apiKey === "") {
        return null;
      }
      return {
        provider: root.provider,
        apiKey,
        endpoint: root.endpoint,
        modelRef: root.modelRef ?? "openai/gpt-5.5",
      };
    },
    save(config) {
      const encrypted = secrets.encrypt(config.apiKey);
      if (encrypted === null) {
        throw new Error("onboarding_secrets_unavailable");
      }
      persistence.save({
        schemaVersion: 1,
        provider: config.provider,
        apiKeyEncrypted: encrypted,
        endpoint: config.endpoint,
        modelRef: config.modelRef,
        updatedAt: new Date().toISOString(),
      });
    },
    clear() {
      fs.rmSync(path.resolve(filePath), { force: true });
    },
  };
}

/**
 * 内存版配置存储（测试）。
 *
 * @param secrets 加密端口
 * @returns store
 */
export function createMemoryOnboardingStore(secrets: SecretsPort): OnboardingStore {
  let config: OnboardingConfig | null = null;
  return {
    load: () => (config ? { ...config } : null),
    save: (next) => {
      config = { ...next };
    },
    clear: () => {
      config = null;
    },
  };
}
