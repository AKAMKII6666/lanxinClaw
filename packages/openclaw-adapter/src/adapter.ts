/**
 * OpenClawAdapter：create / read / cancel job 门面。
 *
 * 职责：持有 job store 与 runtime client，对外提供最小 job API。
 * 不拥有：配对、凭据、permission gate、affair 用户验收关闭。
 * 副作用：委托 create/read/cancel 对 store 与 runtime 的副作用。
 */

import type { OpenClawRuntimeClient } from "./client/runtime-client.js";
import { cancelAdapterJob } from "./jobs/cancel-job.js";
import { createAdapterJob } from "./jobs/create-job.js";
import { createMemoryAdapterJobStore, type AdapterJobStore } from "./jobs/job-store.js";
import { readAdapterJob } from "./jobs/read-job.js";
import type { AdapterJobResult, CreateAdapterJobInput } from "./jobs/job-types.js";

/**
 * Adapter 构造选项。
 */
export interface OpenClawAdapterOptions {
  /** OpenClaw runtime 客户端（真实 SDK 或 mock） */
  runtime: OpenClawRuntimeClient;
  /** 可选外部 store；默认内存 */
  store?: AdapterJobStore;
}

/**
 * OpenClaw adapter 实例。
 */
export class OpenClawAdapter {
  private readonly runtime: OpenClawRuntimeClient;
  private readonly store: AdapterJobStore;

  /**
   * @param options runtime 与可选 store
   */
  constructor(options: OpenClawAdapterOptions) {
    this.runtime = options.runtime;
    this.store = options.store ?? createMemoryAdapterJobStore();
  }

  /**
   * 创建 job 并映射到 OpenClaw run。
   *
   * @param input 含显式 allowedPermissions 的入参
   * @returns 登记结果
   */
  createJob(input: CreateAdapterJobInput): Promise<AdapterJobResult> {
    return createAdapterJob(this.store, this.runtime, input);
  }

  /**
   * 读取 job 状态（默认刷新 runtime）。
   *
   * @param jobId job id
   * @param options.refresh 是否刷新；默认 true
   * @returns 登记结果
   */
  readJob(jobId: string, options?: { refresh?: boolean }): Promise<AdapterJobResult> {
    return readAdapterJob(this.store, this.runtime, jobId, options);
  }

  /**
   * 取消 job；终态幂等。
   *
   * @param jobId job id
   * @returns 登记结果
   */
  cancelJob(jobId: string): Promise<AdapterJobResult> {
    return cancelAdapterJob(this.store, this.runtime, jobId);
  }
}
