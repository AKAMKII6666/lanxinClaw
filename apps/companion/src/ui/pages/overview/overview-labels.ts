/**
 * 总览状态枚举的中文标签。
 *
 * 职责：把契约 status 映射为控制面板可见文案。
 * 不拥有：bridge、权限、真实状态源。
 * 纯函数：仅映射表。
 */

/** Claw / worker 状态文案 */
export const CLAW_CORE_STATUS_LABEL: Record<string, string> = {
  not_installed: "未安装",
  stopped: "未启动",
  starting: "启动中",
  running: "已运行",
  error: "异常",
};

/** 凭据配置态文案 */
export const CREDENTIAL_STATUS_LABEL: Record<string, string> = {
  missing: "未配置",
  synced: "已同步",
  expired: "已过期",
  needs_reauth: "需重新授权",
};

/** 澜星电话连接文案 */
export const DEVICE_STATUS_LABEL: Record<string, string> = {
  undiscovered: "未发现",
  discovered: "已发现",
  pairing: "配对中",
  connected: "已连接",
  disconnected: "断开",
};

/** 张老板状态文案 */
export const ZHANG_BOSS_STATUS_LABEL: Record<string, string> = {
  offline: "离线",
  online: "在线",
  in_call: "通话中",
  supervising: "正在盯事务",
  waiting_user: "等待用户",
};

/** 当前任务卡状态文案 */
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
