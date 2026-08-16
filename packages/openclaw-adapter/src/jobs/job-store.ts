/**
 * Adapter job 内存登记表。
 *
 * 职责：按 jobId 保存 AdapterJobRecord，支持幂等查询与更新。
 * 不拥有：OpenClaw run 生命周期、权限、affair 关闭。
 * 副作用：仅修改传入的 Map 或内部 Map。
 */

import type { AdapterJobRecord } from "./job-types.js";

/**
 * Job 登记存储。
 */
export interface AdapterJobStore {
  /**
   * 读取登记；不存在返回 undefined。
   *
   * @param jobId job id
   * @returns 记录或 undefined
   */
  get(jobId: string): AdapterJobRecord | undefined;

  /**
   * 写入或覆盖登记。
   *
   * @param record 完整记录
   */
  set(record: AdapterJobRecord): void;

  /**
   * 是否已存在。
   *
   * @param jobId job id
   * @returns 是否存在
   */
  has(jobId: string): boolean;
}

/** Adapter job 持久化 port；文件/内存实现都遵守同一契约。 */
export type AdapterJobPersistence = AdapterJobStore;

/**
 * 创建内存 job store。
 *
 * @returns AdapterJobStore
 */
export function createMemoryAdapterJobStore(): AdapterJobStore {
  const map = new Map<string, AdapterJobRecord>();
  return {
    get(jobId) {
      const found = map.get(jobId);
      return found ? { ...found, allowedPermissions: [...found.allowedPermissions] } : undefined;
    },
    set(record) {
      map.set(record.jobId, {
        ...record,
        allowedPermissions: [...record.allowedPermissions],
      });
    },
    has(jobId) {
      return map.has(jobId);
    },
  };
}
