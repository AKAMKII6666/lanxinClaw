/**
 * Backend state → 控制面板 snapshot 投影。
 *
 * 职责：从 companion backend 唯一真源生成 renderer 可消费的安全摘要。
 * 不拥有：状态迁移、权限裁决、UI 渲染。
 * 纯函数：不产生 I/O。
 */

import { PROTOCOL_VERSION } from "@lanxin-claw/protocol";
import type { ControlPanelSnapshotView } from "../bridge/contract.js";
import type { CompanionBackendState } from "./types.js";

/**
 * 构建控制面板 snapshot。
 *
 * @param state backend state
 * @returns snapshot
 */
export function projectControlPanelSnapshot(
  state: CompanionBackendState,
): ControlPanelSnapshotView {
  const currentAffair = latestAffair(state);
  const generatedAt = state.updatedAt;
  return {
    schemaVersion: PROTOCOL_VERSION,
    snapshotId: `ui_snap_${Date.parse(generatedAt) || state.startedAtMs}`,
    generatedAt,
    companion: {
      status: "running",
      version: "0.1.0-dev",
      uptimeMs: Math.max(0, Date.parse(generatedAt) - state.startedAtMs),
      message: "Companion backend 已接入真实状态流",
    },
    clawCore: {
      status: "stopped",
      version: null,
      adapterReady: false,
      message: "OpenClaw Gateway 状态由诊断探针更新",
    },
    credential: {
      status: "missing",
      provider: "openclaw-gateway",
      lastSyncedAt: null,
      expiresAt: null,
      message: "未配置 Gateway 凭据或 secure reference",
    },
    device: {
      status: state.connection.sessionAuthenticated ? "connected" : state.connection.phoneDeviceId ? "pairing" : "undiscovered",
      phoneDeviceId: state.connection.phoneDeviceId,
      phoneDisplayName: state.connection.phoneDisplayName,
      pairingId: state.connection.pairingId,
      sessionId: state.connection.sessionId,
      fingerprintHint: null,
      lastSeenAt: state.connection.lastSeenAt,
      message: state.connection.sessionAuthenticated ? "电话会话已认证" : "等待配对或会话认证",
    },
    zhangBoss: {
      status: currentAffair ? "supervising" : "offline",
      activeAffairId: currentAffair?.affairId ?? null,
      activeCallId: null,
      summary: currentAffair ? `正在盯「${currentAffair.title}」` : null,
    },
    currentAffair: currentAffair
      ? {
          affairId: currentAffair.affairId,
          title: currentAffair.title,
          status: currentAffair.status,
          currentJobId: currentAffair.currentJobId ?? null,
          executor: currentAffair.currentJobId ? "openclaw" : null,
          progressSummary: progressForAffair(state, currentAffair.affairId),
          blockedReason: currentAffair.blockedReason ?? null,
          resumeCondition: currentAffair.resumeCondition ?? null,
          updatedAt: generatedAt,
        }
      : null,
  };
}

/**
 * @param state state
 * @returns 最近事务
 */
function latestAffair(state: CompanionBackendState) {
  return [...state.affairs.values()].at(-1) ?? null;
}

/**
 * @param state state
 * @param affairId 事务
 * @returns 进度摘要
 */
function progressForAffair(state: CompanionBackendState, affairId: string): string {
  const job = [...state.jobs.values()].reverse().find((item) => item.affairId === affairId);
  return job?.progressSummary || "等待执行进展";
}

