/**
 * 张老板页真实 snapshot 投影。
 *
 * 职责：把控制面板 snapshot 转为张老板页状态栏和当前事务视图。
 * 不拥有：聊天传输、上下文投递、权限裁决。
 * 纯函数：无 I/O；无 demo 数据。
 */

import type { ControlPanelSnapshotView } from "../bridge/contract.js";
import type { ZhangBossPanelView, ZhangBossPresenceStatus } from "./views.js";

/**
 * 从 snapshot 投影张老板页面板。
 *
 * @param snapshot 控制面板 snapshot
 * @param previous 可选旧面板，用于保留本地输入后的线程记录
 * @returns 面板视图
 */
export function projectZhangBossPanelFromSnapshot(
  snapshot: ControlPanelSnapshotView,
  previous?: ZhangBossPanelView,
): ZhangBossPanelView {
  return {
    presence: toPresence(snapshot.zhangBoss.status),
    summary: snapshot.zhangBoss.summary,
    activeCallId: snapshot.zhangBoss.activeCallId,
    currentAffair: snapshot.currentAffair
      ? {
          affairId: snapshot.currentAffair.affairId,
          title: snapshot.currentAffair.title,
          status: snapshot.currentAffair.status,
          progressSummary: snapshot.currentAffair.progressSummary,
        }
      : null,
    messages: previous?.messages ?? [],
    attachHistory: previous?.attachHistory ?? [],
  };
}

/**
 * 归一张老板在线态。
 */
function toPresence(value: string): ZhangBossPresenceStatus {
  if (
    value === "offline" ||
    value === "online" ||
    value === "in_call" ||
    value === "supervising" ||
    value === "waiting_user"
  ) {
    return value;
  }
  return "offline";
}
