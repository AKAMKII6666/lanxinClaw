/**
 * 任务页演示数据（backend jobs 未接入前的安全占位）。
 *
 * 职责：提供含 running / blocked / waiting_acceptance 的样例工作区。
 * 不拥有：真实 affair store、OpenClaw、验收关闭。
 * 纯函数：返回静态结构；不含凭据明文。
 */

import type { AffairDetailView, TaskWorkspaceView } from "./tasks-models.js";

const DETAIL_BY_ID: Record<string, AffairDetailView> = {
  affair_fix_code_001: {
    affairId: "affair_fix_code_001",
    title: "修好 xxx 项目代码问题",
    status: "running",
    ownerLabel: "张老板",
    acceptanceCriteria: ["相关测试通过", "用户确认问题解决"],
    context: ["用户说代码好像坏了。", "项目在 F:/workspace/xxx。"],
    timeline: [
      {
        entryId: "tl_fix_1",
        at: "2026-07-23T00:50:00.000Z",
        kind: "create",
        summary: "事务创建，目标：修好 xxx 项目代码问题",
      },
      {
        entryId: "tl_fix_2",
        at: "2026-07-23T00:55:00.000Z",
        kind: "progress",
        summary: "已进入项目目录并识别 Node 项目",
      },
      {
        entryId: "tl_fix_3",
        at: "2026-07-23T00:59:00.000Z",
        kind: "progress",
        summary: "已定位失败用例，正在尝试修复",
      },
    ],
    blockerSummary: null,
    resumeCondition: null,
    acceptanceResult: null,
    currentJob: {
      jobId: "job_fix_code_001",
      status: "running",
      executor: "OpenClaw",
      goal: "Inspect and fix the selected project until tests pass.",
      progressSummary: "已定位失败用例，正在尝试修复",
      attemptedSteps: ["已进入项目目录", "已识别 Node 项目", "正在修复失败测试"],
      blockedReason: null,
      resumeCondition: null,
    },
    updatedAt: "2026-07-23T00:59:00.000Z",
  },
  affair_python_env_001: {
    affairId: "affair_python_env_001",
    title: "配置 Python 环境",
    status: "blocked",
    ownerLabel: "张老板",
    acceptanceCriteria: ["venv 可用", "依赖安装成功"],
    context: ["需要本机 Python 3.11。"],
    timeline: [
      {
        entryId: "tl_py_1",
        at: "2026-07-23T00:30:00.000Z",
        kind: "create",
        summary: "事务创建：配置 Python 环境",
      },
      {
        entryId: "tl_py_2",
        at: "2026-07-23T00:35:00.000Z",
        kind: "progress",
        summary: "检测到 Python，已创建 venv",
      },
      {
        entryId: "tl_py_3",
        at: "2026-07-23T00:40:00.000Z",
        kind: "blocked",
        summary: "pip install 失败：网络不可用",
      },
    ],
    blockerSummary: "网络不可用；需要用户处理",
    resumeCondition: "恢复外网或配置可用镜像后再 resume",
    acceptanceResult: null,
    currentJob: {
      jobId: "job_python_env_001",
      status: "blocked",
      executor: "OpenClaw",
      goal: "Create venv and install project dependencies.",
      progressSummary: "网络不可用，无法拉取依赖",
      attemptedSteps: ["检测到 Python", "创建 venv", "pip install 失败"],
      blockedReason: "网络不可用",
      resumeCondition: "恢复外网或配置可用镜像后再 resume",
    },
    updatedAt: "2026-07-23T00:40:00.000Z",
  },
  affair_docs_review_001: {
    affairId: "affair_docs_review_001",
    title: "整理 README 验收稿",
    status: "waiting_acceptance",
    ownerLabel: "张老板",
    acceptanceCriteria: ["README 可读", "用户接受结果"],
    context: [
      "worker 已报告 job.completed；等待用户验收。",
      "不得因 worker completed 自动 closed。",
    ],
    timeline: [
      {
        entryId: "tl_docs_1",
        at: "2026-07-23T00:10:00.000Z",
        kind: "create",
        summary: "事务创建：整理 README 验收稿",
      },
      {
        entryId: "tl_docs_2",
        at: "2026-07-23T00:18:00.000Z",
        kind: "progress",
        summary: "收集现有说明并生成验收稿",
      },
      {
        entryId: "tl_docs_3",
        at: "2026-07-23T00:21:00.000Z",
        kind: "waiting_acceptance",
        summary: "worker completed；进入等待验收（非已关闭）",
      },
    ],
    blockerSummary: null,
    resumeCondition: null,
    acceptanceResult: "待用户确认；尚未 closed",
    currentJob: {
      jobId: "job_docs_review_001",
      status: "completed",
      executor: "OpenClaw",
      goal: "Draft README acceptance notes.",
      progressSummary: "文档草稿已写好，等待用户验收",
      attemptedSteps: ["收集现有说明", "生成验收稿"],
      blockedReason: null,
      resumeCondition: null,
    },
    updatedAt: "2026-07-23T00:21:00.000Z",
  },
};

/**
 * 构造任务页演示工作区。
 *
 * @returns 含三种关键状态的工作区
 */
export function createDemoTaskWorkspace(): TaskWorkspaceView {
  const selectedAffairId = "affair_fix_code_001";
  return {
    affairs: [
      {
        affairId: "affair_fix_code_001",
        title: "修好 xxx 项目代码问题",
        status: "running",
        progressSummary: "已定位失败用例，正在尝试修复",
        blockedReason: null,
        updatedAt: "2026-07-23T00:59:00.000Z",
      },
      {
        affairId: "affair_python_env_001",
        title: "配置 Python 环境",
        status: "blocked",
        progressSummary: "网络不可用",
        blockedReason: "网络不可用",
        updatedAt: "2026-07-23T00:40:00.000Z",
      },
      {
        affairId: "affair_docs_review_001",
        title: "整理 README 验收稿",
        status: "waiting_acceptance",
        progressSummary: "等待用户验收；非已关闭",
        blockedReason: null,
        updatedAt: "2026-07-23T00:21:00.000Z",
      },
    ],
    selectedAffairId,
    selectedDetail: DETAIL_BY_ID[selectedAffairId] ?? null,
  };
}

/**
 * 按 id 取详情；未知 id 返回 null。
 *
 * @param affairId 事务 id
 * @returns 详情或 null
 */
export function getDemoAffairDetail(affairId: string): AffairDetailView | null {
  return DETAIL_BY_ID[affairId] ?? null;
}
