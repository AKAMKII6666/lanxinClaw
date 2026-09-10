/**
 * 业务证据同源分类。
 *
 * 职责：把 OpenClaw 文本/证据候选判成 missing|weak|present，供完成门闩与监督投影共用。
 * 不拥有：job 状态写入、规则优先级、runtime I/O。
 * 纯函数：不修改入参。
 */

import type { OpenClawExecutionEvidence } from "../../../evidence/openclaw-execution-evidence.js";
import { safeText } from "./safe-text.js";

/** 纯状态词 / 弱结果词（无实体载荷）。 */
const LOW_SIGNAL_EXACT_RE =
  /^(ok|done|completed|complete|success|succeeded|stop|stopped|end|ended|finish|finished|running|accepted|queued|pending|passed|listed|found|saved|read|wrote|updated|result|results|content)$/i;

/** 空壳完成套话；无实体载荷时不算可验收。 */
const COMPLETION_BOILERPLATE_RE =
  /(completed successfully|task completed successfully|successfully completed|i(?:'ve| have) finished(?: the)? task|all done|^已完成$|^执行完毕$|^处理完毕$|已完成任务|任务已完成|执行成功|运行成功|执行完毕|处理完毕)/i;

/** 业务文件扩展名（含桌面快捷方式常见后缀）。 */
const FILE_EXT_RE =
  /\.(?:txt|docx?|pdf|xlsx?|csv|json|md|png|jpe?g|gif|zip|log|js|ts|tsx|py|html?|lnk|exe|url|appref-ms)\b/i;

/** 明确路径（禁止裸 / \ 单独抬 present）。 */
const EXPLICIT_PATH_RE = /(?:[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]+|(?:^|[\s`"'(])\/(?:[\w.-]+\/)+[\w.-]+)/;

/** 数量/计数实体。 */
const COUNT_ENTITY_RE =
  /(?:\d+\s*(?:files?|items?|tests?|个|份|条)|count[=:]\s*\d+|一共|共有|列出了|列出来|listed\s+\d+|passed with\s+\d+)/i;

/** 价格/币价实体（查资料主路径验收）。 */
const PRICE_ENTITY_RE =
  /(?:\$\s?\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:USD|USDT|CNY|人民币)|(?:当前)?价格[:：]\s*\$?\s*\d|(?:current\s+)?price[:：]\s*\$?\s*\d)/i;

/** 查价/查资料目标语境。 */
const RESEARCH_GOAL_RE = /(?:价格|报价|查价|查资料|搜新闻|币价|price|bnb|btc|eth|usd)/i;

/** 桌面/图标清单标题与语义。 */
const DESKTOP_LIST_HEADER_RE =
  /(?:\*\*)?(?:文件夹|快捷方式(?:\s*\(\.lnk\))?|应用程序和工具|图标名|文件和快捷方式名称|桌面文件|desktop files?)(?:\*\*)?\s*[:：]/i;

/** 列举目标语境。 */
const LIST_GOAL_RE = /(?:列出|扫描|清单|list|enumerate|desktop|桌面|图标|快捷方式)/i;

/** 连续 markdown/破折号列表项（至少 3 项）。 */
const MULTI_BULLET_LIST_RE = /(?:^|\n)\s*[-*•]\s+\S+(?:\s*(?:\n)\s*[-*•]\s+\S+){2,}/m;

/** 结果实体短语。 */
const RESULT_ENTITY_PHRASE_RE =
  /(?:list_root|文件名|路径|查到.{1,40}|找到.{1,40}|结果[:：].{2,}|内容[:：].{2,}|wrote\s+\S+|updated\s+\S+|saved\s+\S+|read\s+\S+)/i;

/** 业务证据质量。 */
export type BusinessEvidenceQuality = "missing" | "weak" | "present";

/** 业务证据类别。 */
export type BusinessEvidenceKind =
  | "list_result"
  | "file_result"
  | "url_result"
  | "count_result"
  | "process_only"
  | "low_signal"
  | "usable_progress"
  | "none";

/** 同源业务证据分类结果；门闩与投影共用。 */
export interface BusinessEvidenceClassification {
  /** 脱敏后的业务文本；无可用文本时为 null。 */
  text: string | null;
  /** 证据质量。 */
  quality: BusinessEvidenceQuality;
  /** 证据类别。 */
  kind: BusinessEvidenceKind;
  /** 分类理由（调试/审计用，非用户文案）。 */
  reason: string;
}

/** classifyBusinessEvidence 可选上下文。 */
export interface ClassifyBusinessEvidenceOptions {
  /** job 目标；用于列举语境与列表结构联合判定。 */
  goal?: string | null;
  /** 兜底文本；低信号时忽略。 */
  fallback?: string | null;
}

/**
 * 判断文本是否为无业务信息的低信号状态词。
 *
 * @param value 待检查文本
 * @returns 空串或纯状态词时为 true
 */
export function isLowSignalText(value: string | null | undefined): boolean {
  const text = safeText(value ?? "");
  return !text || LOW_SIGNAL_EXACT_RE.test(text);
}

/**
 * 统计 `- item` / `* item` 列表项数量（同一行用 ` - ` 分隔也计）。
 *
 * @param text 文本
 * @returns 列表项数
 */
function bulletItemCount(text: string): number {
  const lineBullets = text.match(/(?:^|\n)\s*[-*•]\s+\S+/g);
  if (lineBullets && lineBullets.length >= 3) {
    return lineBullets.length;
  }
  const inline = text.match(/\s[-–—]\s+[^\s-]{2,}/g);
  return inline ? inline.length : 0;
}

function present(
  text: string,
  kind: BusinessEvidenceKind,
  reason: string,
): BusinessEvidenceClassification {
  return { text, quality: "present", kind, reason };
}

/**
 * 尝试把文本抬到 present；无法判定时返回 null。
 *
 * @param text 已脱敏文本
 * @param goal 可选任务目标
 * @returns present 分类或 null
 */
function tryPresentClassification(text: string, goal?: string | null): BusinessEvidenceClassification | null {
  const directRules: Array<[RegExp, BusinessEvidenceKind, string]> = [
    [DESKTOP_LIST_HEADER_RE, "list_result", "desktop_list_header"],
    [COUNT_ENTITY_RE, "count_result", "count_entity"],
    [PRICE_ENTITY_RE, "count_result", "price_entity"],
    [FILE_EXT_RE, "file_result", "file_extension"],
    [EXPLICIT_PATH_RE, "file_result", "explicit_path"],
    [/https?:\/\/\S{6,}/i, "url_result", "url"],
    [RESULT_ENTITY_PHRASE_RE, "file_result", "result_entity_phrase"],
  ];
  for (const [pattern, kind, reason] of directRules) {
    if (pattern.test(text)) {
      return present(text, kind, reason);
    }
  }
  return tryPresentFromBulletList(text, goal);
}

/**
 * 列表结构 + 目标联合抬 present。
 *
 * @param text 已脱敏文本
 * @param goal 可选任务目标
 * @returns present 分类或 null
 */
function tryPresentFromBulletList(
  text: string,
  goal?: string | null,
): BusinessEvidenceClassification | null {
  const hasBullets = MULTI_BULLET_LIST_RE.test(text) || bulletItemCount(text) >= 3;
  if (!hasBullets) {
    return null;
  }
  const goalText = safeText(goal ?? "");
  if (LIST_GOAL_RE.test(goalText)) {
    return present(text, "list_result", "list_goal_with_bullets");
  }
  if (RESEARCH_GOAL_RE.test(goalText) && PRICE_ENTITY_RE.test(text)) {
    return present(text, "count_result", "research_goal_with_price");
  }
  if (/(?:桌面|文件夹|快捷方式|图标|文件)/.test(text)) {
    return present(text, "list_result", "desktopish_bullet_list");
  }
  return null;
}

/**
 * 对单段文本做业务信号分类。
 *
 * @param value 待检查文本
 * @param goal 可选任务目标
 * @returns 分类结果（text 为脱敏原文）
 */
export function classifyTextBusinessSignal(
  value: string | null | undefined,
  goal?: string | null,
): BusinessEvidenceClassification {
  const text = safeText(value ?? "");
  if (!text || isLowSignalText(text)) {
    return { text: text || null, quality: "missing", kind: "low_signal", reason: "low_signal_or_empty" };
  }
  const isBoilerplate =
    COMPLETION_BOILERPLATE_RE.test(text) && !FILE_EXT_RE.test(text) && !COUNT_ENTITY_RE.test(text);
  if (isBoilerplate) {
    return { text, quality: "missing", kind: "low_signal", reason: "completion_boilerplate" };
  }
  const presentHit = tryPresentClassification(text, goal);
  if (presentHit) {
    return presentHit;
  }
  return { text, quality: "weak", kind: "usable_progress", reason: "usable_without_strong_entity" };
}

/**
 * 判断摘要是否含可验收业务实体（路径、文件、数量、清单结构等）。
 * 裸 `/` `\` 不得单独抬到 present。
 *
 * @param value 待检查文本
 * @param goal 可选任务目标；列举类目标可与列表结构联合判定
 * @returns 含实体信号时为 true
 */
export function hasBusinessEntitySignal(
  value: string | null | undefined,
  goal?: string | null,
): boolean {
  return classifyTextBusinessSignal(value, goal).quality === "present";
}

/**
 * 判断文本是否可作为进度/失败等人话摘要（允许无实体，但拒绝低信号与空壳套话）。
 *
 * @param value 待检查文本
 * @returns 可用作 progressSummary 时为 true
 */
export function isUsableProgressText(value: string | null | undefined): boolean {
  const classified = classifyTextBusinessSignal(value);
  return classified.quality === "present" || classified.quality === "weak";
}

/**
 * 判断文本是否可作为 completed / 可验收摘要。
 *
 * @param value 待检查文本
 * @param goal 可选任务目标
 * @returns 非空、非低信号，且含业务实体信号时为 true
 */
export function isMeaningfulCompletionText(
  value: string | null | undefined,
  goal?: string | null,
): boolean {
  return classifyTextBusinessSignal(value, goal).quality === "present";
}

/**
 * 从证据候选中同源分类业务结果（门闩与投影共用）。
 *
 * @param evidence OpenClaw 观测证据
 * @param options 目标与兜底
 * @returns 最优分类；无文本时 quality=missing
 */
export function classifyBusinessEvidence(
  evidence: OpenClawExecutionEvidence,
  options?: ClassifyBusinessEvidenceOptions,
): BusinessEvidenceClassification {
  const goal = options?.goal ?? null;
  const toolTexts = [...evidence.toolFindings]
    .reverse()
    .flatMap((finding) => [finding.summary, finding.errorCode]);
  const candidates = [
    evidence.finalReply?.text,
    evidence.task?.terminalSummary,
    evidence.task?.progressSummary,
    ...toolTexts,
    evidence.task?.error,
    evidence.wait?.error,
    evidence.lifecycle?.terminalReason,
    options?.fallback,
  ];
  let bestWeak: BusinessEvidenceClassification | null = null;
  for (const candidate of candidates) {
    const classified = classifyTextBusinessSignal(candidate, goal);
    if (classified.quality === "present" && classified.text) {
      return classified;
    }
    if (classified.quality === "weak" && classified.text && !bestWeak) {
      bestWeak = classified;
    }
  }
  if (bestWeak) {
    return bestWeak;
  }
  return { text: null, quality: "missing", kind: "none", reason: "no_usable_candidate" };
}

/**
 * 按优先级挑选第一段有业务含义的文本。
 *
 * @param evidence OpenClaw 观测证据
 * @param fallback 可选兜底；低信号时忽略
 * @param goal 可选任务目标
 * @returns 脱敏后的业务文本；无可用文本时为 null
 */
export function pickMeaningfulBusinessText(
  evidence: OpenClawExecutionEvidence,
  fallback?: string | null,
  goal?: string | null,
): string | null {
  return classifyBusinessEvidence(evidence, {
    fallback: fallback ?? null,
    goal: goal ?? null,
  }).text;
}
