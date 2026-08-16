/**
 * 阻塞通知文案与指纹。
 *
 * 职责：按阻塞沟通策略生成用户可见文案与抑制重复的指纹。
 * 不拥有：发送通道、开麦、权限、OpenClaw。
 * 纯函数：无 I/O。
 */

/**
 * 构造阻塞通知指纹；同一指纹应抑制重复打扰。
 *
 * @param affairId 事务 id
 * @param blockedReason 原因
 * @param resumeCondition 恢复条件
 * @returns 指纹字符串
 */
export function blockedNotifyFingerprint(
  affairId: string,
  blockedReason: string,
  resumeCondition: string,
): string {
  return `${affairId}|${resumeCondition}|${blockedReason}`;
}

/**
 * 阻塞通知文案。
 */
export interface BlockedNotifyCopy {
  /** 标题 */
  title: string;
  /** 正文 */
  body: string;
}

/**
 * 生成阻塞沟通文案（中文；技术标识可保留英文）。
 *
 * @param affairTitle 事务标题
 * @param blockedReason 原因
 * @param attemptedSteps 已尝试步骤
 * @param resumeCondition 恢复条件
 * @returns 标题与正文
 */
export function buildBlockedNotifyCopy(
  affairTitle: string,
  blockedReason: string,
  attemptedSteps: string[],
  resumeCondition: string,
): BlockedNotifyCopy {
  const steps =
    attemptedSteps.length > 0 ? attemptedSteps.join("；") : "（尚无步骤摘要）";
  return {
    title: "事务卡住了，需要你看一下",
    body: [
      `我这边让 Claw 推进「${affairTitle}」时停住了。`,
      `原因：${blockedReason}`,
      `已尝试：${steps}`,
      `恢复条件：${resumeCondition}`,
      "你处理好后告诉我，或在控制面板点「恢复」。",
    ].join("\n"),
  };
}

/**
 * 是否应对该指纹再发通知。
 *
 * @param memory 通知记忆
 * @param affairId 事务 id
 * @param fingerprint 本次指纹
 * @returns true 表示应通知
 */
export function shouldNotifyBlocked(
  memory: { lastBlockedFingerprintByAffair: Map<string, string> },
  affairId: string,
  fingerprint: string,
): boolean {
  return memory.lastBlockedFingerprintByAffair.get(affairId) !== fingerprint;
}
