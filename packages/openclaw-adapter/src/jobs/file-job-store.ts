/**
 * Adapter job 文件持久化 store。
 *
 * 职责：保存 jobId 到 OpenClaw runId 的映射，支持 companion 重启恢复。
 * 不拥有：runtime 生命周期、权限裁决、affair 关闭。
 * 副作用：读写本机 JSON 文件；写入内容不得含凭据。
 */

import fs from "node:fs";
import path from "node:path";
import type { AdapterJobRecord } from "./job-types.js";
import type { AdapterJobStore } from "./job-store.js";

/**
 * 文件 store 根对象。
 */
interface AdapterJobFileRoot {
  /** schema 版本 */
  schemaVersion: 1;
  /** job 记录 */
  jobs: AdapterJobRecord[];
}

/**
 * 创建文件 job store。
 *
 * @param filePath JSON 文件路径
 * @returns AdapterJobStore
 */
export function createFileAdapterJobStore(filePath: string): AdapterJobStore {
  const absolute = path.resolve(filePath);
  const map = new Map<string, AdapterJobRecord>();
  loadIntoMap(absolute, map);
  return {
    get(jobId) {
      const found = map.get(jobId);
      return found ? cloneJob(found) : undefined;
    },
    set(record) {
      map.set(record.jobId, cloneJob(record));
      persist(absolute, [...map.values()]);
    },
    has(jobId) {
      return map.has(jobId);
    },
  };
}

/**
 * 从文件加载记录。
 *
 * @param filePath 文件路径
 * @param map 目标 map
 */
function loadIntoMap(filePath: string, map: Map<string, AdapterJobRecord>): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as AdapterJobFileRoot;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.jobs)) {
    throw new Error("adapter_job_store_invalid");
  }
  for (const job of parsed.jobs) {
    map.set(job.jobId, cloneJob(job));
  }
}

/**
 * 原子写入文件。
 *
 * @param filePath 文件路径
 * @param jobs job 列表
 */
function persist(filePath: string, jobs: AdapterJobRecord[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const root: AdapterJobFileRoot = {
    schemaVersion: 1,
    jobs: jobs.map(cloneJob),
  };
  const tmp = `${filePath}.partial`;
  fs.writeFileSync(tmp, `${JSON.stringify(root, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * @param job 记录
 * @returns 记录副本
 */
function cloneJob(job: AdapterJobRecord): AdapterJobRecord {
  return {
    ...job,
    allowedPermissions: [...job.allowedPermissions],
  };
}

