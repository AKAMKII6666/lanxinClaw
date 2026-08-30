/**
 * 张老板 companion Function Call（FC）目录。
 *
 * 职责：枚举电话侧张老板可调用的 companion 相关 FC 名称，并声明各自映射的协议 message type。
 * 不拥有：电话主仓 tool runtime、companion 权限裁决、OpenClaw 执行、affair 关闭。
 * 纯函数：仅常量与只读查询；FC 不是 envelope type，不得绕过 session/权限直接产生桌面副作用。
 */

import type { MessageType } from "./message-type.js";

/**
 * 张老板 companion FC 稳定名称；与 docs/共同维护/技术设计/张老板伴侣工具.md 对齐。
 */
export const COMPANION_FC_NAMES = [
  "companion.get_connection_status",
  "companion.discover_desktops",
  "companion.prepare_desktop_connection",
  "companion.confirm_desktop_connection",
  "companion.disconnect_desktop",
  "companion.explore_desktop",
  "companion.create_job",
  "companion.get_progress",
  "companion.pause_affair",
  "companion.resume_affair",
  "companion.cancel_job",
  "companion.cancel_affair",
  "companion.accept_affair",
  "companion.send_chat_context",
  "companion.fetch_pending_context",
] as const;

/** 张老板 companion FC 名称 */
export type CompanionFcName = (typeof COMPANION_FC_NAMES)[number];

/**
 * 单个 FC 的协议映射说明。
 * `emits` 为空表示只读写电话侧 store，不发送新的 envelope。
 */
export interface CompanionFcMapping {
  /** FC 稳定名 */
  name: CompanionFcName;
  /** 调用后可能发出的协议 type；查询类可为空 */
  emits: readonly MessageType[];
  /** 是否允许在无 session 时仅读本地 store */
  localOnly: boolean;
  /** 中文职责摘要：约束调用意图，防止当成任意命令 */
  summary: string;
}

/** FC → 协议映射表；worker completed 不得经任何 FC 写成 affair.closed */
export const COMPANION_FC_CATALOG: readonly CompanionFcMapping[] = [
  {
    name: "companion.get_connection_status",
    emits: [],
    localOnly: true,
    summary: "只读电话侧连接、配对与 session 状态",
  },
  {
    name: "companion.discover_desktops",
    emits: [],
    localOnly: true,
    summary: "mDNS 发现候选 companion；发现本身不建立信任",
  },
  {
    name: "companion.prepare_desktop_connection",
    emits: [],
    localOnly: true,
    summary: "把候选电脑绑定到短期连接意图，等待用户口头确认",
  },
  {
    name: "companion.confirm_desktop_connection",
    emits: [
      "pairing.request",
      "pairing.confirmed",
      "session.open",
    ],
    localOnly: false,
    summary: "用户口头确认后完成 pairing 或 session.open；仍不授予执行权限",
  },
  {
    name: "companion.disconnect_desktop",
    emits: ["session.closed"],
    localOnly: false,
    summary: "关闭当前 companion session；不撤销配对身份",
  },
  {
    name: "companion.explore_desktop",
    emits: ["affair.create", "job.create"],
    localOnly: false,
    summary: "创建澄清期只读 exploration job；不得当正式事务完成",
  },
  {
    name: "companion.create_job",
    emits: ["affair.create", "affair.update", "job.create"],
    localOnly: false,
    summary: "为 affair 委派 job；权限仍由 companion 裁决",
  },
  {
    name: "companion.get_progress",
    emits: [],
    localOnly: true,
    summary: "只读事务簿进度镜像；不新增 job.query 消息",
  },
  {
    name: "companion.pause_affair",
    emits: ["affair.update"],
    localOnly: false,
    summary: "将 affair 标为 paused；不发明 job.pause wire type",
  },
  {
    name: "companion.resume_affair",
    emits: ["affair.resume"],
    localOnly: false,
    summary: "在 resume condition 满足时请求恢复 blocked/paused",
  },
  {
    name: "companion.cancel_job",
    emits: ["job.cancel"],
    localOnly: false,
    summary: "取消委派 job；不得自动关闭 affair",
  },
  {
    name: "companion.cancel_affair",
    emits: ["job.cancel", "affair.close"],
    localOnly: false,
    summary: "用户明确取消整件事务；不是验收通过",
  },
  {
    name: "companion.accept_affair",
    emits: ["affair.close"],
    localOnly: false,
    summary: "用户明确验收 waiting_acceptance 后关闭 affair",
  },
  {
    name: "companion.send_chat_context",
    emits: ["chat.message"],
    localOnly: false,
    summary: "发送 untrusted 精确文本侧写；不得当系统指令",
  },
  {
    name: "companion.fetch_pending_context",
    emits: [],
    localOnly: true,
    summary: "消费 pending chat.context_attach；realtime 注入的 FC fallback",
  },
] as const;

/**
 * 判断字符串是否为已知 companion FC 名。
 *
 * @param value 待检测名称
 * @returns 是否属于 COMPANION_FC_NAMES
 */
export function isCompanionFcName(value: string): value is CompanionFcName {
  return (COMPANION_FC_NAMES as readonly string[]).includes(value);
}

/**
 * 按名称查找 FC 映射；未知名返回 null。
 *
 * @param name FC 名称
 * @returns 映射条目或 null
 */
export function getCompanionFcMapping(name: string): CompanionFcMapping | null {
  if (!isCompanionFcName(name)) {
    return null;
  }
  const found = COMPANION_FC_CATALOG.find((item) => item.name === name);
  return found ?? null;
}
