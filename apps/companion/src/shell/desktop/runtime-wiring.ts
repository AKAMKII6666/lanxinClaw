/**
 * Electron 壳层运行时接线：撤销配对与 JobDelegator 工厂。
 *
 * 职责：从 electron-main 抽离可复用的 revoke / delegator 装配。
 * 不拥有：窗口、IPC、gateway 生命周期。
 * 副作用：revoke 回调会写 identity、广播 pairing.revoked。
 */

import type { OpenClawAdapter } from "@lanxin-claw/openclaw-adapter";
import type { AffairActionPorts } from "../../affairs/actions/types.js";
import { createEnvelope } from "@lanxin-claw/protocol";
import type { CompanionBackendRuntime } from "../../backend/runtime.js";
import type { DeviceIdentityStore } from "../../credentials/identity-store.js";
import { reconcileDelegatorOnStartup } from "../../jobs/delegation/delegator-reconcile.js";
import { JobDelegator } from "../../jobs/delegation/delegator.js";
import type { LoggerRegistry } from "../../logging/logger.js";
import type { CompanionProtocolServerHandle } from "../../protocol-server/server.js";

/**
 * 恢复 shell 启动时的 in-flight job 轮询与 reconcile。
 *
 * @param delegator 任务委派器
 * @param backend 后端 runtime
 * @param adapter OpenClaw adapter
 */
export async function restoreShellInFlightJobs(
  delegator: JobDelegator,
  backend: CompanionBackendRuntime,
  adapter: OpenClawAdapter,
  ports: AffairActionPorts,
): Promise<void> {
  await backend.getAffairActions().recoverPending(ports);
  await reconcileDelegatorOnStartup(delegator, backend, adapter);
}

/** @param input 当前装配端口；延后到真实 adapter 就绪再读取 @returns 恢复关闭意图与既有任务的入口 */
export function createShellJobRecovery(input: {
  getDelegator: () => JobDelegator | null;
  getBackend: () => CompanionBackendRuntime;
  getProtocolHandle: () => CompanionProtocolServerHandle | null;
  desktopDeviceId: string;
}): (adapter: OpenClawAdapter) => Promise<void> {
  return async (adapter) => {
    const delegator = input.getDelegator();
    if (!delegator) return;
    await restoreShellInFlightJobs(delegator, input.getBackend(), adapter, {
      desktopDeviceId: input.desktopDeviceId, cancelJob: (job) => delegator.cancelJob(job),
      sendEnvelope: (envelope) => input.getProtocolHandle()?.sendEnvelope(envelope),
    });
  };
}

/**
 * 创建设备撤销配对回调。
 *
 * @param deps identity、协议广播与 pairingId 读取
 * @returns backend.onDeviceRevokePairing 处理器
 */
export function createDeviceRevokePairingHandler(deps: {
  identityStore: DeviceIdentityStore;
  getProtocolHandle: () => CompanionProtocolServerHandle | null;
  getPairingId: () => string | null;
  getDelegator?: () => JobDelegator | null;
  getJobAffairId?: (jobId: string) => string;
  onPairingChanged?: () => Promise<void> | void;
}): (input: { phoneDeviceId: string; desktopDeviceId: string }) => Promise<void> {
  return async ({ phoneDeviceId, desktopDeviceId: deskId }) => {
    const delegator = deps.getDelegator?.();
    if (delegator) {
      const activeIds = delegator.listActiveJobIds();
      delegator.stop();
      for (const jobId of activeIds) {
        try {
          await delegator.cancelJob({
            jobId,
            affairId: deps.getJobAffairId?.(jobId) ?? "",
          });
        } catch {
          // best-effort cancel
        }
      }
    }
    await deps.identityStore.revokeIdentity(
      phoneDeviceId,
      deskId,
      "user_revoke_from_desktop",
      new Date().toISOString(),
    );
    await deps.onPairingChanged?.();
    const protocolHandle = deps.getProtocolHandle();
    protocolHandle?.clearAuthenticatedSockets();
    protocolHandle?.broadcast(
      createEnvelope({
        source: { kind: "companion", deviceId: deskId },
        target: { kind: "phone", deviceId: phoneDeviceId },
        type: "pairing.revoked",
        payload: {
          pairingId: deps.getPairingId() ?? "",
          phoneDeviceId,
          desktopDeviceId: deskId,
          reason: "user_revoke_from_desktop",
          revokedAt: new Date().toISOString(),
        },
      }),
    );
  };
}

/**
 * 创建 shell 用 JobDelegator。
 *
 * @param deps 依赖
 * @returns JobDelegator 实例
 */
export function createShellJobDelegator(deps: {
  adapter: OpenClawAdapter;
  backend: CompanionBackendRuntime;
  desktopDeviceId: string;
  workspace: string;
  applyProtocolEnvelope: CompanionBackendRuntime["applyProtocolEnvelope"];
  sendEnvelope: (envelope: Parameters<CompanionProtocolServerHandle["sendEnvelope"]>[0]) => void;
  pollIntervalMs: number;
  logRegistry: LoggerRegistry;
}): JobDelegator {
  return new JobDelegator({
    adapter: deps.adapter,
    gate: deps.backend.getPermissionGate(),
    getJob: (id) => deps.backend.getState().jobs.get(id),
    isAffairClosing: (id) => deps.backend.getAffairActions().isClosing(id),
    runAffairOperation: (id, operation) => deps.backend.getAffairActions().operations.run(id, operation),
    getJobStatus: (jobId) => deps.backend.getState().jobs.get(jobId)?.status,
    getWorkspaceHint: (jobId) => deps.backend.getState().jobs.get(jobId)?.workspaceHint ?? null,
    getJobPurpose: (jobId) => deps.backend.getState().jobs.get(jobId)?.purpose,
    authorizedDesktopRoot: deps.workspace,
    getAffair: (affairId) => deps.backend.getState().affairs.get(affairId),
    getPhoneDeviceId: () => deps.backend.getState().connection.phoneDeviceId ?? null,
    desktopDeviceId: deps.desktopDeviceId,
    applyProtocolEnvelope: deps.applyProtocolEnvelope,
    sendEnvelope: deps.sendEnvelope,
    pollIntervalMs: deps.pollIntervalMs,
    logger: deps.logRegistry.getLogger("adapter"),
  });
}

export { startShellLanDiscovery } from "./discovery/runtime.js";
export type { ShellLanDiscoveryDeps, ShellLanDiscoveryHandle } from "./discovery/runtime.js";
