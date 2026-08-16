/**
 * 任务页真实 snapshot 投影。
 *
 * 职责：把 ControlPanelSnapshotView 转为任务页列表/详情视图。
 * 不拥有：backend store、OpenClaw 执行、权限裁决。
 * 纯函数：无 I/O；无 demo 数据。
 */

import type { ControlPanelSnapshotView, CurrentAffairSummaryView } from "../../../bridge/contract.js";
import type { AffairDetailView, AffairListItemView, TaskWorkspaceView } from "./tasks-models.js";

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
  const affair = snapshot.currentAffair;
  const affairs = affair ? [toListItem(affair)] : [];
  const nextSelected =
    affair && selectedAffairId === affair.affairId
      ? selectedAffairId
      : affair?.affairId ?? null;
  return {
    affairs,
    selectedAffairId: nextSelected,
    selectedDetail: affair && nextSelected === affair.affairId ? toDetail(affair) : null,
  };
}

/**
 * 转列表项。
 */
function toListItem(affair: CurrentAffairSummaryView): AffairListItemView {
  return {
    affairId: affair.affairId,
    title: affair.title,
    status: affair.status,
    progressSummary: affair.progressSummary,
    blockedReason: affair.blockedReason,
    updatedAt: affair.updatedAt,
  };
}

/**
 * 转详情。
 */
function toDetail(affair: CurrentAffairSummaryView): AffairDetailView {
  const timelineKind = affair.blockedReason ? "blocked" : affair.status;
  return {
    affairId: affair.affairId,
    title: affair.title,
    status: affair.status,
    ownerLabel: "张老板",
    acceptanceCriteria: ["等待电话侧或用户给出的验收标准"],
    context: [affair.progressSummary],
    timeline: [
      {
        entryId: `tl_${affair.affairId}_${affair.updatedAt}`,
        at: affair.updatedAt,
        kind: timelineKind,
        summary: affair.progressSummary,
      },
    ],
    blockerSummary: affair.blockedReason,
    resumeCondition: affair.resumeCondition,
    acceptanceResult: affair.status === "waiting_acceptance" ? "待用户确认；尚未 closed" : null,
    currentJob: affair.currentJobId
      ? {
          jobId: affair.currentJobId,
          status: affair.status === "waiting_acceptance" ? "completed" : affair.status,
          executor: affair.executor ?? "OpenClaw",
          goal: affair.title,
          progressSummary: affair.progressSummary,
          attemptedSteps: [affair.progressSummary],
          blockedReason: affair.blockedReason,
          resumeCondition: affair.resumeCondition,
        }
      : null,
    updatedAt: affair.updatedAt,
  };
}
