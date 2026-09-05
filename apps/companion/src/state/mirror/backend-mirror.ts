/**
 * backend in-flight 镜像落盘：affair/job/chat/pending。
 *
 * 职责：companion 重启后保留协议对象 id，session 仍须重新 open。
 * 不拥有：pairingSecret、API key、OpenClaw run。
 * 副作用：读写本机 JSON。
 */

import type {
  AffairPayload,
  ChatContextAttachPayload,
  ChatMessagePayload,
  JobPayload,
} from "@lanxin-claw/protocol";
import type { PendingContextItem } from "../../chat/channel/pending-context.js";
import { JsonFilePersistence } from "../../persistence/json-file.js";
import type { BridgeActionDelivery } from "../../bridge/contract.js";
import type { CompanionBackendState } from "../types.js";

/** 落盘根 */
interface BackendMirrorRoot {
  /** schema */
  schemaVersion: 1;
  /** affairs */
  affairs: AffairPayload[];
  /** jobs */
  jobs: JobPayload[];
  /** chat */
  chatMessages: ChatMessagePayload[];
  /** context_attach */
  contextAttachments: ChatContextAttachPayload[];
  /** pending 精确文本 */
  pendingContext: PendingContextItem[];
  /** 最近 UI action 投递回执 */
  bridgeActionDeliveries?: BridgeActionDelivery[];
}

/**
 * 镜像持久化。
 */
export interface BackendMirrorStore {
  /** 读盘 */
  load(): BackendMirrorRoot;
  /** 写盘 */
  save(root: BackendMirrorRoot): void;
}

/**
 * @param filePath JSON 路径
 * @returns store
 */
export function createFileBackendMirrorStore(filePath: string): BackendMirrorStore {
  const persistence = new JsonFilePersistence<BackendMirrorRoot>(filePath, {
    schemaVersion: 1,
    affairs: [],
    jobs: [],
    chatMessages: [],
    contextAttachments: [],
    pendingContext: [],
    bridgeActionDeliveries: [],
  });
  return {
    load: () => persistence.load(),
    save: (root) => persistence.save(root),
  };
}

/**
 * 从内存 state 抽出可落盘镜像（不含 session 认证态）。
 *
 * @param state backend state
 * @param pendingContext pending 队列
 * @returns 镜像
 */
export function snapshotBackendMirror(
  state: CompanionBackendState,
  pendingContext: readonly PendingContextItem[],
): BackendMirrorRoot {
  return {
    schemaVersion: 1,
    affairs: [...state.affairs.values()],
    jobs: [...state.jobs.values()],
    chatMessages: [...state.chatMessages],
    contextAttachments: [...state.contextAttachments],
    pendingContext: pendingContext.map((item) => ({ ...item })),
    bridgeActionDeliveries: state.bridgeActionDeliveries.map((item) => ({ ...item })),
  };
}

/**
 * 把镜像灌回空 state。
 *
 * @param state 目标 state
 * @param root 镜像
 */
export function hydrateBackendMirror(state: CompanionBackendState, root: BackendMirrorRoot): void {
  state.affairs.clear();
  for (const affair of root.affairs ?? []) {
    state.affairs.set(affair.affairId, affair);
  }
  state.jobs.clear();
  for (const job of root.jobs ?? []) {
    state.jobs.set(job.jobId, job);
  }
  state.chatMessages.splice(0, state.chatMessages.length, ...(root.chatMessages ?? []));
  state.contextAttachments.splice(
    0,
    state.contextAttachments.length,
    ...(root.contextAttachments ?? []),
  );
  state.bridgeActionDeliveries.splice(
    0,
    state.bridgeActionDeliveries.length,
    ...(root.bridgeActionDeliveries ?? []),
  );
}
