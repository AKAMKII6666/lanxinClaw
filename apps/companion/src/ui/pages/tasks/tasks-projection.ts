/**
 * 任务页真实 snapshot 投影。
 *
 * 职责：把 ControlPanelSnapshotView 转为任务页列表/详情视图。
 * 不拥有：backend store、OpenClaw 执行、权限裁决。
 * 纯函数：无 I/O；无 demo 数据。
 */

import type { ControlPanelSnapshotView, CurrentAffairSummaryView } from "../../../bridge/contract.js";
import type { AffairDetailView, AffairListItemView, TaskWorkspaceView } from "./tasks-models.js";

const LOW_SIGNAL_SUMMARY_RE = /^(ok|done|completed|complete|success|succeeded|stop|stopped|end|ended)$/i;

/**
 * 从控制面板 snapshot 投影任务工作区。
 *
 * @param snapshot 控制面板 snapshot
 * @param selectedAffairId 当前选择
 * @returns 任务页视图
 */
export function projectTaskWorkspaceFromSnapshot(
  snapshot: ControlPanelSnapshotView,
  selectedAffairId: string | null,
): TaskWorkspaceView {
  const summaries = snapshot.affairs ?? (snapshot.currentAffair ? [snapshot.currentAffair] : []);
  const affairs = summaries.map(toListItem);
  const selected = selectedAffairId
    ? summaries.find((item) => item.affairId === selectedAffairId) ?? null
    : summaries[0] ?? null;
  const nextSelected = selected?.affairId ?? null;
  return {
    affairs,
    selectedAffairId: nextSelected,
    selectedDetail: selected && nextSelected === selected.affairId ? toDetail(selected) : null,
  };
}

/**
 * 转列表项。
 */
function toListItem(affair: CurrentAffairSummaryView): AffairListItemView {
  return {
    affairId: affair.affairId,
    groupLabel: isTerminalAffair(affair.status) ? "已结束" : "处理中",
    title: affair.title,
    status: affair.status,
    progressSummary: publicProgressSummary(affair),
    blockedReason: affair.blockedReason,
    updatedAt: affair.updatedAt,
  };
}

/**
 * 转详情。
 */
function toDetail(affair: CurrentAffairSummaryView): AffairDetailView {
  const timelineKind = affair.blockedReason ? "blocked" : affair.status;
  const progressSummary = publicProgressSummary(affair);
  const jobProgress = publicJobProgressSummary(affair, progressSummary);
  const attemptedSteps = visibleList([affair.currentJobProgressSummary]);
  return {
    affairId: affair.affairId,
    title: affair.title,
    status: affair.status,
    ownerLabel: "张老板",
    acceptanceCriteria: visibleList(affair.acceptanceCriteria),
    context: visibleList(affair.context),
    timeline: [
      {
        entryId: `tl_${affair.affairId}_${affair.updatedAt}`,
        at: affair.updatedAt,
        kind: timelineKind,
        summary: progressSummary,
      },
    ],
    blockerSummary: affair.currentJobBlockedReason ?? affair.blockedReason,
    resumeCondition: affair.currentJobResumeCondition ?? affair.resumeCondition,
    acceptanceResult: acceptanceResultForAffair(affair),
    currentJob: affair.currentJobId
      ? {
          jobId: affair.currentJobId,
          status: affair.currentJobStatus ?? (affair.status === "waiting_acceptance" ? "completed" : affair.status),
          executor: affair.executor ?? "OpenClaw",
          goal: cleanText(affair.currentJobGoal) ?? affair.title,
          progressSummary: jobProgress,
          attemptedSteps,
          blockedReason: affair.currentJobBlockedReason ?? affair.blockedReason,
          resumeCondition: affair.currentJobResumeCondition ?? affair.resumeCondition,
        }
      : null,
    updatedAt: affair.updatedAt,
  };
}

function publicProgressSummary(affair: CurrentAffairSummaryView): string {
  const conflict = terminalConflictSummary(affair);
  if (conflict) {
    return conflict;
  }
  const blocked = cleanText(affair.currentJobBlockedReason) ?? cleanText(affair.blockedReason);
  if (blocked) {
    return blocked;
  }
  const progress = cleanText(affair.progressSummary);
  if (progress && !isLowSignalSummary(progress)) {
    return progress;
  }
  if (affair.status === "waiting_acceptance") {
    return "电脑端执行已结束，等待你确认结果";
  }
  if (affair.currentJobStatus === "needs_permission") {
    return "等待桌面授权后开始执行";
  }
  if (affair.status === "delegated") {
    return "任务已交给电脑端，等待执行状态更新";
  }
  if (affair.status === "running") {
    return "电脑端正在执行";
  }
  if (affair.status === "blocked") {
    return "执行遇到阻塞，等待处理";
  }
  if (affair.status === "canceled") {
    return "事务已取消";
  }
  if (affair.status === "closed") {
    return "事务已关闭";
  }
  return "等待执行进展";
}

function publicJobProgressSummary(
  affair: CurrentAffairSummaryView,
  fallback: string,
): string {
  const progress = cleanText(affair.currentJobProgressSummary);
  return progress && !isLowSignalSummary(progress) ? progress : fallback;
}

function acceptanceResultForAffair(affair: CurrentAffairSummaryView): string | null {
  if (affair.status !== "waiting_acceptance") {
    return null;
  }
  return "执行结果待确认；你接受后事务才会关闭";
}

function visibleList(items: readonly (string | null | undefined)[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items ?? []) {
    const text = cleanText(item);
    if (!text || isLowSignalSummary(text) || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function cleanText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

function isLowSignalSummary(value: string): boolean {
  return LOW_SIGNAL_SUMMARY_RE.test(value.trim());
}

function isTerminalAffair(status: string): boolean {
  return status === "closed" || status === "canceled";
}

function terminalConflictSummary(affair: CurrentAffairSummaryView): string | null {
  if (affair.status === "canceled" && affair.currentJobStatus && affair.currentJobStatus !== "canceled") {
    return `历史状态冲突：事务已取消，但当前 job 后续回到 ${affair.currentJobStatus}`;
  }
  if (affair.status === "closed" && affair.currentJobStatus && affair.currentJobStatus !== "completed") {
    return `历史状态冲突：事务已关闭，但当前 job 状态为 ${affair.currentJobStatus}`;
  }
  return null;
}
