/**
 * 授权后委派前置校验。
 *
 * 职责：确认 permission grant 仍指向可执行的父事务和 current job。
 * 不拥有：gate 裁决、adapter 创建、状态广播。
 * 纯函数：只读 delegator 依赖。
 */

import type { JobDelegatorDeps } from "./delegator-types.js";

/**
 * 校验已授权 permission 是否仍能启动对应 job。
 *
 * @param deps delegator 只读依赖
 * @param affairId 父事务 id
 * @param jobId permission 关联 job id
 * @returns 可执行为 true；父事务缺失、终态或 current job 不匹配时为 false
 */
export function canExecutePermissionGrantedJob(
  deps: JobDelegatorDeps,
  affairId: string,
  jobId: string,
): boolean {
  if (!affairId || !deps.getAffair) {
    return true;
  }
  const affair = deps.getAffair(affairId);
  if (!affair) {
    deps.logger?.warn({ affairId, jobId }, "权限已授予但找不到父事务，拒绝委派");
    return false;
  }
  if (affair.status === "closed" || affair.status === "canceled") {
    deps.logger?.warn({ affairId, jobId, status: affair.status }, "父事务已终态，拒绝委派");
    return false;
  }
  if (affair.currentJobId !== jobId) {
    deps.logger?.warn(
      { affairId, jobId, currentJobId: affair.currentJobId },
      "权限请求不属于当前 job，拒绝委派",
    );
    return false;
  }
  return true;
}
