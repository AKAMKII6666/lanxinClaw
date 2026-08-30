/**
 * 后台监督 loop 单次 tick。
 *
 * 职责：根据 affair/job 快照产出监督动作（盯进度、标 blocked、通知、进验收）。
 * 不拥有：网络轮询实现、OpenClaw、权限、发送 chat/call、关闭事务权威。
 * 纯函数：不改入参 memory 以外由调用方决定是否写入；本函数返回建议动作列表。
 */

import {
  buildBlockedNotifyCopy,
  blockedNotifyFingerprint,
  shouldNotifyBlocked,
} from "./policy/blocked-copy.js";
import { affairStatusAfterJobTerminal } from "./policy/acceptance.js";
import type {
  SupervisionAction,
  SupervisionNotifyMemory,
  SupervisionSnapshot,
} from "./types.js";

const TERMINAL_AFFAIR = new Set(["closed", "canceled"]);

/**
 * 静止态：终态 / 待验收 / 暂停。
 *
 * @param snapshot 观测
 * @returns 动作或 null
 */
function idleActions(snapshot: SupervisionSnapshot): SupervisionAction[] | null {
  if (TERMINAL_AFFAIR.has(snapshot.affairStatus)) {
    return [
      {
        kind: "stop_watch",
        affairId: snapshot.affairId,
        reason: `affair 已终态 ${snapshot.affairStatus}`,
      },
    ];
  }
  if (snapshot.affairStatus === "waiting_acceptance") {
    return [
      {
        kind: "continue_watch",
        affairId: snapshot.affairId,
        note: "等待用户验收；不得自动 closed",
      },
    ];
  }
  if (snapshot.affairStatus === "paused") {
    return [
      {
        kind: "continue_watch",
        affairId: snapshot.affairId,
        note: "事务已暂停；resume 前不打扰",
      },
    ];
  }
  return null;
}

/**
 * worker 完成后进入验收。
 *
 * @param snapshot 观测
 * @returns 动作或 null
 */
function waitingAcceptanceActions(
  snapshot: SupervisionSnapshot,
): SupervisionAction[] | null {
  if (!snapshot.jobId || snapshot.jobStatus !== "completed") {
    return null;
  }
  if (snapshot.jobPurpose === "exploration") {
    return [
      {
        kind: "continue_watch",
        affairId: snapshot.affairId,
        note: "探索 job 已完成；仅作为澄清上下文，不进入事务验收",
      },
    ];
  }
  if (affairStatusAfterJobTerminal("completed") !== "waiting_acceptance") {
    return null;
  }
  if (snapshot.affairStatus === "waiting_acceptance") {
    return null;
  }
  return [
    {
      kind: "mark_waiting_acceptance",
      affairId: snapshot.affairId,
      jobId: snapshot.jobId,
      reason: "worker completed；进入验收，禁止自动 closed",
    },
  ];
}

/**
 * blocked 标记与低打扰通知。
 *
 * @param snapshot 观测
 * @param memory 通知记忆
 * @returns 动作或 null
 */
function blockedActions(
  snapshot: SupervisionSnapshot,
  memory: SupervisionNotifyMemory,
): SupervisionAction[] | null {
  const blocked =
    snapshot.jobStatus === "blocked" ||
    snapshot.affairStatus === "blocked" ||
    Boolean(snapshot.blockedReason);
  if (!blocked || !snapshot.jobId) {
    return null;
  }
  const reason = snapshot.blockedReason?.trim() || "执行受阻（原因未详述）";
  const resume =
    snapshot.resumeCondition?.trim() || "用户解除阻塞后由张老板/控制面板 resume";
  const actions: SupervisionAction[] = [
    {
      kind: "mark_blocked",
      affairId: snapshot.affairId,
      jobId: snapshot.jobId,
      blockedReason: reason,
      resumeCondition: resume,
    },
  ];
  const fingerprint = blockedNotifyFingerprint(snapshot.affairId, reason, resume);
  if (shouldNotifyBlocked(memory, snapshot.affairId, fingerprint)) {
    const copy = buildBlockedNotifyCopy(
      snapshot.affairTitle,
      reason,
      snapshot.attemptedSteps,
      resume,
    );
    actions.push({
      kind: "notify_blocked",
      affairId: snapshot.affairId,
      title: copy.title,
      body: copy.body,
      fingerprint,
    });
  }
  return actions;
}

/**
 * 执行一次监督 tick。
 *
 * @param snapshot 当前观测
 * @param memory 阻塞通知记忆（只读；调用方按动作更新）
 * @returns 建议动作（按优先级排列）
 */
export function runSupervisionTick(
  snapshot: SupervisionSnapshot,
  memory: SupervisionNotifyMemory,
): SupervisionAction[] {
  return (
    idleActions(snapshot) ??
    waitingAcceptanceActions(snapshot) ??
    blockedActions(snapshot, memory) ?? [
      {
        kind: "continue_watch",
        affairId: snapshot.affairId,
        note: snapshot.progressSummary || "继续轮询/订阅进度",
      },
    ]
  );
}

/**
 * 将 notify_blocked 指纹写入记忆（调用方在真正发出通知后调用）。
 *
 * @param memory 可变记忆
 * @param affairId 事务 id
 * @param fingerprint 指纹
 */
export function rememberBlockedNotify(
  memory: SupervisionNotifyMemory,
  affairId: string,
  fingerprint: string,
): void {
  memory.lastBlockedFingerprintByAffair.set(affairId, fingerprint);
}

/**
 * 创建空的通知记忆。
 *
 * @returns 新记忆
 */
export function createSupervisionNotifyMemory(): SupervisionNotifyMemory {
  return { lastBlockedFingerprintByAffair: new Map() };
}
