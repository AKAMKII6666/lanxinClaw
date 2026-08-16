/**
 * 任务页状态与决策文案。
 *
 * 职责：affair / job 状态映射为控制面板可见中文。
 * 不拥有：状态机、bridge、OpenClaw。
 * 纯函数：仅映射表。
 */

/** 事务状态文案；waiting_acceptance 不得写成已关闭 */
export const AFFAIR_STATUS_LABEL: Record<string, string> = {
  clarifying: "澄清中",
  ready: "就绪",
  delegated: "已委派",
  running: "运行中",
  blocked: "blocked",
  paused: "已暂停",
  waiting_acceptance: "待验收",
  closed: "已关闭",
  canceled: "已取消",
};

/** job / worker 状态文案；completed ≠ affair closed */
export const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  blocked: "blocked",
  paused: "已暂停",
  completed: "worker 已完成",
  failed: "失败",
  canceled: "已取消",
};

/**
 * 查找标签；未知则回退原文。
 *
 * @param map 映射表
 * @param status 状态值
 * @returns 中文或原文
 */
export function labelOf(map: Record<string, string>, status: string): string {
  return map[status] ?? status;
}
