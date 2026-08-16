/**
 * 本机低风险只读 runtime（无 OpenClaw Gateway 时的实跑路径）。
 *
 * 职责：对白名单任务执行固定 argv 的只读检查（列目录 / git status），并报告 run 状态。
 * 不拥有：配对、凭据、permission gate、affair 关闭、任意 shell。
 * 副作用：对本机工作区做只读 fs / 子进程（固定参数，shell:false）。
 */

import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type {
  CreateOpenClawRunParams,
  OpenClawRunSnapshot,
  OpenClawRuntimeClient,
} from "../runtime-client.js";
import {
  parseLowRiskTaskKind,
  type LowRiskTaskKind,
} from "./task-kinds.js";
import type { OpenClawRunStatus } from "../../status/openclaw-run-status.js";

const TERMINAL: readonly OpenClawRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
];

/**
 * local-safe runtime 选项。
 */
export interface LocalSafeRuntimeOptions {
  /** 默认工作区根（授权边界）；workspaceHint 必须落在其内；不得含凭据 */
  workspaceRoot?: string;
}

/**
 * 构造本机只读 runtime 客户端。
 *
 * @param options 工作区根等
 * @returns OpenClawRuntimeClient 实现
 */
export function createLocalSafeRuntimeClient(
  options: LocalSafeRuntimeOptions = {},
): OpenClawRuntimeClient {
  const runs = new Map<string, OpenClawRunSnapshot>();
  let seq = 0;
  const defaultRoot = options.workspaceRoot ?? process.cwd();

  return {
    async createRun(params: CreateOpenClawRunParams): Promise<OpenClawRunSnapshot> {
      seq += 1;
      const runId = `ocrun_local_${seq}`;
      const kind = parseLowRiskTaskKind(params.input);
      if (!kind) {
        const failed: OpenClawRunSnapshot = {
          runId,
          status: "failed",
          summary: "unsupported_goal:仅接受 [lanxin-safe:…] 白名单只读任务",
          blockedReason: null,
          resumeCondition: null,
        };
        runs.set(runId, failed);
        return { ...failed };
      }

      const accepted: OpenClawRunSnapshot = {
        runId,
        status: "accepted",
        summary: `accepted:${kind}`,
        blockedReason: null,
        resumeCondition: null,
      };
      runs.set(runId, accepted);

      const resolved = resolveWorkspaceRoot(defaultRoot, params.workspaceHint);
      if (!resolved.ok) {
        const failed: OpenClawRunSnapshot = {
          runId,
          status: "failed",
          summary: resolved.reason,
          blockedReason: null,
          resumeCondition: null,
        };
        runs.set(runId, failed);
        return { ...failed };
      }

      const executed = await executeLowRiskTask(kind, resolved.root);
      const next: OpenClawRunSnapshot = {
        runId,
        status: executed.ok ? "completed" : "failed",
        summary: executed.summary,
        blockedReason: null,
        resumeCondition: null,
      };
      runs.set(runId, next);
      return { ...next };
    },

    async getRun(runId: string): Promise<OpenClawRunSnapshot> {
      const found = runs.get(runId);
      if (!found) {
        throw new Error(`local_run_not_found:${runId}`);
      }
      return { ...found };
    },

    async cancelRun(runId: string): Promise<OpenClawRunSnapshot> {
      const found = runs.get(runId);
      if (!found) {
        throw new Error(`local_run_not_found:${runId}`);
      }
      if (TERMINAL.includes(found.status)) {
        return { ...found };
      }
      const next: OpenClawRunSnapshot = {
        ...found,
        status: "cancelled",
        summary: "cancelled_by_adapter",
      };
      runs.set(runId, next);
      return { ...next };
    },
  };
}

/**
 * 解析工作区根；hint 必须落在 defaultRoot（已授权工作区）之内，拒绝绝对越界与 `..` 逃逸。
 *
 * @param defaultRoot 默认/已授权根
 * @param hint 可选提示（绝对或相对 defaultRoot）
 * @returns 合法绝对路径，或越界失败原因
 */
function resolveWorkspaceRoot(
  defaultRoot: string,
  hint?: string | null,
): { ok: true; root: string } | { ok: false; reason: string } {
  const base = path.resolve(defaultRoot);
  if (!hint || !hint.trim()) {
    return { ok: true, root: base };
  }
  const trimmed = hint.trim();
  const candidate = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.resolve(base, trimmed);
  if (!isPathInsideOrEqual(base, candidate)) {
    return { ok: false, reason: `workspace_out_of_scope:${trimmed}` };
  }
  return { ok: true, root: candidate };
}

/**
 * 判断 candidate 是否等于 base，或为其子路径（跨盘符/前缀逃逸视为否）。
 *
 * @param base 授权根（已 resolve）
 * @param candidate 候选绝对路径
 * @returns 是否在授权范围内
 */
function isPathInsideOrEqual(base: string, candidate: string): boolean {
  const rel = path.relative(base, candidate);
  if (!rel) {
    return true;
  }
  if (path.isAbsolute(rel)) {
    return false;
  }
  const first = rel.split(/[/\\]/)[0];
  return first !== "..";
}

/**
 * 执行白名单只读任务。
 *
 * @param kind 任务种类
 * @param workspaceRoot 工作区绝对路径
 * @returns 成功摘要或失败
 */
async function executeLowRiskTask(
  kind: LowRiskTaskKind,
  workspaceRoot: string,
): Promise<{ ok: boolean; summary: string }> {
  try {
    if (kind === "workspace.list_root") {
      const entries = await readdir(workspaceRoot);
      const preview = entries.slice(0, 40).join(",");
      return {
        ok: true,
        summary: `list_root count=${entries.length} sample=${preview}`,
      };
    }
    if (kind === "git.status") {
      const result = spawnSync("git", ["status", "--porcelain", "-b"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        shell: false,
        timeout: 20_000,
        windowsHide: true,
      });
      if (result.error) {
        return { ok: false, summary: `git_status_error:${result.error.message}` };
      }
      if (result.status !== 0) {
        const err = (result.stderr || "").trim().slice(0, 200);
        return { ok: false, summary: `git_status_exit:${result.status}:${err}` };
      }
      const out = (result.stdout || "").trim().replace(/\s+/g, " ").slice(0, 400);
      return { ok: true, summary: `git_status:${out || "(clean)"}` };
    }
    const _exhaustive: never = kind;
    return { ok: false, summary: `unknown_kind:${String(_exhaustive)}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "execute_failed";
    return { ok: false, summary: message };
  }
}
