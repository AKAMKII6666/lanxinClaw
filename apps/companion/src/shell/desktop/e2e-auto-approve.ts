/**
 * E2E 自治：自动 bootstrap 运行时、批准配对、允许权限。
 *
 * 职责：仅当 LANXIN_E2E_AUTO_APPROVE=1 时轮询并提交 bridge 动作。
 * 不拥有：协议状态机、OpenClaw、renderer。
 * 副作用：定时 applyBridgeAction / bootstrapRuntime。
 */

import type { BridgeActionResult, BridgeUiAction, ControlPanelSnapshotView } from "../../bridge/contract.js";
import type { PendingPermissionCardView } from "../../permissions/views.js";
import { pendingPairingFromSnapshot } from "../../ui/app/shell-pairing.js";

type E2eLogger = { info: (obj: object, msg: string) => void };

/** 是否启用 E2E 自动批准 */
export function isE2eAutoApproveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LANXIN_E2E_AUTO_APPROVE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * @param getPendingPairingId 协议层 pending
 * @param getSnapshot 控制面板快照
 * @returns pending pairingId
 */
function resolvePendingPairingId(
  getPendingPairingId: (() => string | null) | undefined,
  getSnapshot: () => ControlPanelSnapshotView,
): string | null {
  return getPendingPairingId?.() ?? pendingPairingFromSnapshot(getSnapshot())?.pairingId ?? null;
}

/**
 * @param bootstrapRuntime 冷启动运行时
 * @param logger 日志
 * @param onFailed 失败回调（允许下一轮重试）
 */
function triggerBootstrapOnce(
  bootstrapRuntime: (() => Promise<unknown>) | undefined,
  logger: E2eLogger | undefined,
  onFailed: () => void,
): void {
  if (!bootstrapRuntime) {
    return;
  }
  void Promise.resolve(bootstrapRuntime())
    .then(() => {
      logger?.info({ event: "e2e.bootstrap_runtime" }, "E2E 已触发 bootstrapRuntime");
    })
    .catch((err: unknown) => {
      onFailed();
      logger?.info(
        { event: "e2e.bootstrap_runtime_failed", err: String(err) },
        "E2E bootstrapRuntime 失败，将重试",
      );
    });
}

/**
 * @param pairingId 待批准配对 id
 * @param inFlight 进行中集合
 * @param applyBridgeAction bridge 动作
 * @param logger 日志
 */
function approvePairingIfIdle(
  pairingId: string | null,
  inFlight: Set<string>,
  applyBridgeAction: (action: BridgeUiAction) => Promise<BridgeActionResult>,
  logger: E2eLogger | undefined,
): void {
  if (!pairingId || inFlight.has(pairingId)) {
    return;
  }
  inFlight.add(pairingId);
  void applyBridgeAction({ type: "pairing.approve", pairingId })
    .then((result) => {
      logger?.info({ event: "e2e.pairing_approve", ok: result.ok, pairingId }, "E2E 自动批准配对");
    })
    .finally(() => {
      inFlight.delete(pairingId);
    });
}

/**
 * @param cards 待决权限卡
 * @param inFlight 进行中集合
 * @param applyBridgeAction bridge 动作
 * @param logger 日志
 */
function allowPendingPermissions(
  cards: PendingPermissionCardView[],
  inFlight: Set<string>,
  applyBridgeAction: (action: BridgeUiAction) => Promise<BridgeActionResult>,
  logger: E2eLogger | undefined,
): void {
  for (const card of cards) {
    if (inFlight.has(card.permissionRequestId)) {
      continue;
    }
    inFlight.add(card.permissionRequestId);
    void applyBridgeAction({
      type: "permission.decide",
      permissionRequestId: card.permissionRequestId,
      decision: "allow_for_job",
    })
      .then((result) => {
        logger?.info(
          {
            event: "e2e.permission_allow",
            ok: result.ok,
            permissionRequestId: card.permissionRequestId,
            jobId: card.jobId,
          },
          "E2E 自动 allow_for_job",
        );
      })
      .finally(() => {
        inFlight.delete(card.permissionRequestId);
      });
  }
}

/**
 * 启动 E2E 自动批准循环。
 *
 * @param input 依赖
 * @returns 停止函数
 */
export function startE2eAutoApprove(input: {
  getSnapshot: () => ControlPanelSnapshotView;
  /** 协议层 pending pairingId（优先于 snapshot 投影） */
  getPendingPairingId?: () => string | null;
  listPendingPermissionCards: () => PendingPermissionCardView[];
  applyBridgeAction: (action: BridgeUiAction) => Promise<BridgeActionResult>;
  bootstrapRuntime?: () => Promise<unknown>;
  logger?: E2eLogger;
  intervalMs?: number;
}): () => void {
  const intervalMs = input.intervalMs ?? 800;
  let stopped = false;
  let bootstrapped = false;
  const approvingPairing = new Set<string>();
  const decidingPermission = new Set<string>();

  const tick = (): void => {
    if (stopped) {
      return;
    }
    if (!bootstrapped) {
      bootstrapped = true;
      triggerBootstrapOnce(input.bootstrapRuntime, input.logger, () => {
        bootstrapped = false;
      });
    }
    approvePairingIfIdle(
      resolvePendingPairingId(input.getPendingPairingId, input.getSnapshot),
      approvingPairing,
      input.applyBridgeAction,
      input.logger,
    );
    allowPendingPermissions(
      input.listPendingPermissionCards(),
      decidingPermission,
      input.applyBridgeAction,
      input.logger,
    );
  };

  const timer = setInterval(tick, intervalMs);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
