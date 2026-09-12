/**
 * Companion bridge 主机（无 Electron 依赖）。
 *
 * 职责：持有校验后的 snapshot、推送订阅、路由安全 UI 操作、收集客户端错误；
 * 持有 PermissionGate 作为桌面授权权威，处理 permission.decide。
 * 不拥有：Electron ipcMain、OpenClaw、真实凭据读写、affair 关闭。
 * 副作用：更新内存状态并通知订阅者；不触碰磁盘/网络/命令。
 */

import { PROTOCOL_VERSION, validateControlPanelSnapshot, type PermissionId } from "@lanxin-claw/protocol";
import { permissionDecisionInfoText } from "../permissions/gate/decision-info.js";
import { createDemoPermissionGate } from "../permissions/gate/demo/create-demo-gate.js";
import { PermissionGate } from "../permissions/gate/permission-gate.js";
import type { PendingPermissionCardView } from "../permissions/views.js";
import { isAllowedBridgeAction } from "./guards/action-guard.js";
import type {
  BridgeActionResult,
  BridgeCallResult,
  BridgeClientErrorReport,
  BridgeError,
  BridgeNavPage,
  BridgeUiAction,
  ControlPanelSnapshotView,
} from "./contract.js";

export type { ControlPanelSnapshotView } from "./contract.js";

/** snapshot 订阅回调 */
export type SnapshotListener = (snapshot: ControlPanelSnapshotView) => void;

/**
 * 构造 MVP 默认 snapshot（无真实服务时的安全占位；不含凭据明文）。
 *
 * @returns 可通过协议校验的 snapshot
 */
export function createDefaultControlPanelSnapshot(): ControlPanelSnapshotView {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROTOCOL_VERSION,
    snapshotId: "ui_snap_companion_default",
    generatedAt: now,
    companion: {
      status: "running",
      version: "0.1.0-dev",
      uptimeMs: 0,
      message: "桌面壳已启动；worker 尚未委派真实任务",
    },
    clawCore: {
      status: "stopped",
      version: null,
      adapterReady: false,
      message: "OpenClaw 尚未接入；仅展示状态卡",
    },
    credential: {
      status: "missing",
      provider: "openclaw-api",
      lastSyncedAt: null,
      expiresAt: null,
      message: "仅显示配置态；界面不接触明文",
    },
    device: {
      status: "undiscovered",
      phoneDeviceId: null,
      phoneDisplayName: null,
      pairingId: null,
      sessionId: null,
      fingerprintHint: null,
      lastSeenAt: null,
      message: "等待局域网发现与双确认配对",
    },
    zhangBoss: {
      status: "offline",
      activeAffairId: null,
      activeCallId: null,
      summary: null,
    },
    currentAffair: null,
    affairs: [],
  };
}

/**
 * 将未知值校验为 snapshot；失败返回 BridgeError。
 *
 * @param value 待校验值
 * @returns 成功视图或错误
 */
function parseSnapshot(
  value: unknown,
): { ok: true; value: ControlPanelSnapshotView } | { ok: false; error: BridgeError } {
  const result = validateControlPanelSnapshot(value);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        retryable: result.error.retryable,
      },
    };
  }
  return { ok: true, value: result.value as unknown as ControlPanelSnapshotView };
}

/**
 * Bridge 主机：renderer 只能经此面交互；权限授予权威在此。
 */
export class CompanionBridgeHost {
  #snapshot: ControlPanelSnapshotView;
  #listeners = new Set<SnapshotListener>();
  #acceptedActions: BridgeUiAction["type"][] = [];
  #clientErrors: BridgeClientErrorReport[] = [];
  #requestedPage: BridgeNavPage = "overview";
  #permissionGate: PermissionGate;

  /**
   * @param initial 可选初始 snapshot；未通过校验则回退默认
   * @param permissionGate 可选注入；默认带演示待确认项的 gate
   */
  constructor(initial?: unknown, permissionGate: PermissionGate = createDemoPermissionGate()) {
    this.#permissionGate = permissionGate;
    if (initial === undefined) {
      this.#snapshot = createDefaultControlPanelSnapshot();
      return;
    }
    const parsed = parseSnapshot(initial);
    this.#snapshot = parsed.ok ? parsed.value : createDefaultControlPanelSnapshot();
  }

  /**
   * 读取当前 snapshot。
   *
   * @returns 不含凭据明文的总览快照
   */
  getSnapshot(): ControlPanelSnapshotView {
    return this.#snapshot;
  }

  /**
   * 替换 snapshot；须通过协议校验。
   *
   * @param next 下一帧快照
   * @returns 是否接受
   */
  setSnapshot(next: unknown): BridgeCallResult {
    const parsed = parseSnapshot(next);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    this.#snapshot = parsed.value;
    for (const listener of this.#listeners) {
      listener(this.#snapshot);
    }
    return { ok: true };
  }

  /**
   * 订阅 snapshot 推送。
   *
   * @param listener 回调
   * @returns 取消订阅函数
   */
  subscribeSnapshot(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * 列出仍待确认的权限卡片（只读视图；授予不在 renderer）。
   *
   * @returns 待确认卡片副本
   */
  listPendingPermissionCards(): PendingPermissionCardView[] {
    return this.#permissionGate.listPendingCards();
  }

  /**
   * 检查 job 是否已持有某权限授予（权威在 host gate）。
   * allow_once 在首次成功检查后消耗。
   *
   * @param jobId job id
   * @param permissionId 权限
   * @returns 是否允许执行
   */
  isPermissionGranted(jobId: string, permissionId: PermissionId): boolean {
    return this.#permissionGate.isGranted(jobId, permissionId);
  }

  /**
   * 提交用户操作；拒绝未知/危险形状。
   * permission.decide 由本机 gate 裁决并写入授予。
   *
   * @param action 操作意图
   * @returns 接受或错误
   */
  submitAction(action: unknown): BridgeActionResult {
    if (!isAllowedBridgeAction(action)) {
      return {
        ok: false,
        error: {
          code: "bridge_action_rejected",
          message: "不支持的操作；renderer 不能请求任意副作用",
          retryable: false,
        },
      };
    }
    if (action.type === "navigate") {
      this.#requestedPage = action.page;
    }
    if (action.type === "permission.decide") {
      return this.#applyPermissionDecide(action);
    }
    this.#acceptedActions.push(action.type);
    return { ok: true, acceptedAction: action.type };
  }

  /**
   * 在 host gate 上应用用户权限决策。
   *
   * @param action 已通过白名单的 permission.decide
   * @returns 裁决后的 bridge 结果
   */
  #applyPermissionDecide(
    action: Extract<BridgeUiAction, { type: "permission.decide" }>,
  ): BridgeActionResult {
    const result = this.#permissionGate.decide(action.permissionRequestId, action.decision);
    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: result.code ?? "permission_decide_failed",
          message: result.message ?? "权限裁决失败",
          retryable: false,
        },
      };
    }
    this.#acceptedActions.push(action.type);
    return {
      ok: true,
      acceptedAction: action.type,
      info: permissionDecisionInfoText(result, action.decision),
      pendingPermissionCards: this.#permissionGate.listPendingCards(),
    };
  }

  /**
   * 记录 renderer 错误；不执行恢复副作用。
   *
   * @param report 客户端错误
   * @returns 接受或校验失败
   */
  reportError(report: unknown): BridgeCallResult {
    if (!report || typeof report !== "object") {
      return {
        ok: false,
        error: {
          code: "bridge_error_invalid",
          message: "错误报告格式无效",
          retryable: false,
        },
      };
    }
    const source = (report as { source?: unknown }).source;
    const message = (report as { message?: unknown }).message;
    if (typeof source !== "string" || typeof message !== "string") {
      return {
        ok: false,
        error: {
          code: "bridge_error_invalid",
          message: "错误报告缺少 source/message",
          retryable: false,
        },
      };
    }
    const entry: BridgeClientErrorReport = { source, message };
    const affairId = (report as { affairId?: unknown }).affairId;
    if (typeof affairId === "string") {
      entry.affairId = affairId;
    }
    this.#clientErrors.push(entry);
    return { ok: true };
  }

  /**
   * 最近接受的操作类型（供单测与诊断）。
   *
   * @returns 操作类型列表副本
   */
  listAcceptedActions(): BridgeUiAction["type"][] {
    return [...this.#acceptedActions];
  }

  /**
   * 最近客户端错误（供单测与诊断）。
   *
   * @returns 错误列表副本
   */
  listClientErrors(): BridgeClientErrorReport[] {
    return [...this.#clientErrors];
  }

  /**
   * 当前导航意图。
   *
   * @returns 页面 id
   */
  getRequestedPage(): BridgeNavPage {
    return this.#requestedPage;
  }
}
