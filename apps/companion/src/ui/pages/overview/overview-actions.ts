/**
 * 总览状态卡操作规划。
 *
 * 职责：把五卡点击映射为导航 / 打开配对 / 用户反馈，并附带 bridge 意图。
 * 不拥有：React 状态、权限裁决、真实配对发现。
 * 纯函数：无 I/O。
 */

import type { BridgeNavPage, BridgeUiAction, ControlPanelSnapshotView } from "../../../bridge/contract.js";

/** 总览卡可触发的壳侧效果 */
export interface OverviewActionPlan {
  /** 切换主壳页面；无可切页时为 null */
  navigateTo: BridgeNavPage | null;
  /** 是否请求打开首次配对 Dialog（须已有 pending） */
  openPairing: boolean;
  /** 给用户的即时说明；无可反馈时为 null */
  feedback: string | null;
  /** 提交给 companion backend 的意图 */
  bridgeAction: BridgeUiAction;
}

/**
 * 规划「查看诊断」。
 *
 * @returns 切到诊断页
 */
export function planOpenDiagnostics(): OverviewActionPlan {
  return {
    navigateTo: "diagnostics",
    openPairing: false,
    feedback: null,
    bridgeAction: { type: "clawCore.openDiagnostics" },
  };
}

/**
 * 规划「凭据同步」；本阶段无远端同步，仅反馈当前落盘事实。
 *
 * @param credentialStatus snapshot 凭据状态
 * @returns 反馈文案 + bridge 意图
 */
export function planCredentialSync(credentialStatus: string): OverviewActionPlan {
  const feedback =
    credentialStatus === "synced"
      ? "凭据已加密存储，当前无需再次同步"
      : credentialStatus === "missing"
        ? "尚未完成配置门，请先提交模型与 API Key"
        : "已记录同步请求；请在诊断页查看凭据与安全存储探针";
  return {
    navigateTo: null,
    openPairing: false,
    feedback,
    bridgeAction: { type: "credential.requestSync" },
  };
}

/**
 * 规划「重新配对」。
 *
 * @param hasPendingPairing 是否已有待确认 pairing
 * @returns 打开 Dialog 或提示等待电话发现
 */
export function planRequestPairing(hasPendingPairing: boolean): OverviewActionPlan {
  if (hasPendingPairing) {
    return {
      navigateTo: null,
      openPairing: true,
      feedback: null,
      bridgeAction: { type: "device.requestPairing" },
    };
  }
  return {
    navigateTo: null,
    openPairing: false,
    feedback: "尚未发现待配对电话；请在电话端发起配对后再试",
    bridgeAction: { type: "device.requestPairing" },
  };
}

/**
 * 规划「打开聊天」。
 *
 * @returns 切到张老板页
 */
export function planOpenChat(): OverviewActionPlan {
  return {
    navigateTo: "zhang-boss",
    openPairing: false,
    feedback: null,
    bridgeAction: { type: "zhangBoss.openChat" },
  };
}

/**
 * 规划「查看任务」。
 *
 * @returns 切到任务页
 */
export function planViewTasks(): OverviewActionPlan {
  return {
    navigateTo: "tasks",
    openPairing: false,
    feedback: null,
    bridgeAction: { type: "navigate", page: "tasks" },
  };
}

/**
 * 规划「查看事务详情」。
 *
 * @param affairId 事务 id
 * @returns 切到任务页并携带 viewDetail 意图
 */
export function planViewAffairDetail(affairId: string): OverviewActionPlan {
  return {
    navigateTo: "tasks",
    openPairing: false,
    feedback: null,
    bridgeAction: { type: "affair.viewDetail", affairId },
  };
}

/**
 * 从 snapshot 判断是否存在待确认配对（与壳侧 pendingPairingFromSnapshot 同条件）。
 *
 * @param snapshot 控制面板快照
 * @returns 是否可打开配对 Dialog
 */
export function snapshotHasPendingPairing(snapshot: ControlPanelSnapshotView): boolean {
  return Boolean(snapshot.device.pairingId && snapshot.device.phoneDeviceId && !snapshot.device.sessionId);
}
