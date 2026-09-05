/**
 * 待投递上下文队列（通话不可达或 FC 延迟时）。
 *
 * 职责：缓存用户从电脑端附加的 path/log/url/note，待张老板消费。
 * 不拥有：把内容当系统指令、权限、OpenClaw。
 * 副作用：仅改本实例队列；内容视为 untrusted。
 */

import type { ChatAttachTarget, ChatContentKind } from "../views.js";

/**
 * 一条待投递上下文。
 */
export interface PendingContextItem {
  /** 本地 id */
  pendingId: string;
  /** 原 bridge action receipt id；旧数据可无 */
  actionReceiptId?: string | null;
  /** 正文；untrusted */
  text: string;
  /** 内容种类 */
  contentKind: ChatContentKind;
  /** 附加目标 */
  target: ChatAttachTarget;
  /** 事务 id；affair 目标必填 */
  affairId: string | null;
  /** 入队时绑定的 job id；旧数据可无 */
  jobId?: string | null;
  /** 入队时间 */
  enqueuedAt: string;
}

/**
 * 内存 pending 队列。
 */
export class PendingContextQueue {
  #items: PendingContextItem[] = [];
  #seq = 0;

  /**
   * 入队一条 untrusted 上下文。
   *
   * @param input 字段
   * @returns 条目或错误
   */
  enqueue(input: {
    text: string;
    contentKind: ChatContentKind;
    target: ChatAttachTarget;
    affairId: string | null;
    actionReceiptId?: string | null;
    jobId?: string | null;
    enqueuedAt?: string;
  }): { ok: true; item: PendingContextItem } | { ok: false; code: string; message: string } {
    const text = input.text.trim();
    if (!text) {
      return { ok: false, code: "pending_empty", message: "上下文不能为空" };
    }
    if (input.target === "affair" && !input.affairId) {
      return {
        ok: false,
        code: "pending_affair_required",
        message: "附加到 affair 时必须提供 affairId",
      };
    }
    this.#seq += 1;
    const item: PendingContextItem = {
      pendingId: `pending_ctx_${String(this.#seq).padStart(4, "0")}`,
      actionReceiptId: input.actionReceiptId ?? null,
      text,
      contentKind: input.contentKind,
      target: input.target,
      affairId: input.affairId,
      jobId: input.jobId ?? null,
      enqueuedAt: input.enqueuedAt ?? new Date().toISOString(),
    };
    this.#items.push(item);
    return { ok: true, item };
  }

  /**
   * 列出未消费项。
   *
   * @returns 副本
   */
  list(): PendingContextItem[] {
    return [...this.#items];
  }

  /**
   * 按 id 取出并移除。
   *
   * @param pendingId id
   * @returns 条目或 null
   */
  take(pendingId: string): PendingContextItem | null {
    const idx = this.#items.findIndex((i) => i.pendingId === pendingId);
    if (idx < 0) {
      return null;
    }
    const [item] = this.#items.splice(idx, 1);
    return item ?? null;
  }

  /**
   * 取出全部未消费项。
   *
   * @returns 原队列内容
   */
  drain(): PendingContextItem[] {
    const items = [...this.#items];
    this.#items = [];
    return items;
  }

  /**
   * 从落盘恢复。
   *
   * @param items 条目
   */
  restore(items: readonly PendingContextItem[]): void {
    this.#items = items.map((item) => ({ ...item }));
  }
}

/**
 * 创建空队列。
 *
 * @returns 新队列
 */
export function createPendingContextQueue(): PendingContextQueue {
  return new PendingContextQueue();
}
