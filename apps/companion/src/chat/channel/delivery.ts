/**
 * 精确文本通道：realtime 注入与 FC fallback。
 *
 * 职责：决定 chat.context_attach 走 realtime 还是 companion FC 投递。
 * 不拥有：把文本当系统指令执行、权限、OpenClaw、affair 关闭。
 * 纯函数：选择策略；不发网。
 */

/** 投递通道 */
export type ContextDeliveryChannel = "realtime_inject" | "companion_fc";

/**
 * 通道能力探测结果。
 */
export interface ContextDeliveryCapability {
  /** 当前通话是否支持 realtime 文本注入 */
  realtimeInjectAvailable: boolean;
  /** companion FC 是否可用（张老板工具） */
  companionFcAvailable: boolean;
}

/**
 * 一次上下文投递计划。
 */
export interface ContextDeliveryPlan {
  /** 选用通道 */
  channel: ContextDeliveryChannel;
  /** 选择原因 */
  reason: string;
  /** 是否须先入 pending 队列（通话不可达时） */
  enqueuePending: boolean;
}

/**
 * 选择投递通道：优先 realtime；不可用则 FC fallback。
 *
 * @param capability 能力
 * @param hasActiveCall 是否有活跃通话
 * @returns 计划；两通道皆不可用则 null
 */
export function planContextDelivery(
  capability: ContextDeliveryCapability,
  hasActiveCall: boolean,
): ContextDeliveryPlan | null {
  if (hasActiveCall && capability.realtimeInjectAvailable) {
    return {
      channel: "realtime_inject",
      reason: "活跃通话且 realtime 可用，直接注入",
      enqueuePending: false,
    };
  }
  if (capability.companionFcAvailable) {
    return {
      channel: "companion_fc",
      reason: hasActiveCall
        ? "realtime 不可用，回退 companion FC"
        : "无活跃通话，经 companion FC 附加到 affair",
      enqueuePending: !hasActiveCall,
    };
  }
  return null;
}
