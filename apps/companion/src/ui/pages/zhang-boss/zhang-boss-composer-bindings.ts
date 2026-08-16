/**
 * 张老板页 Composer 提交绑定。
 *
 * 职责：把草稿与 panel 绑定到 bridge 提交回调。
 * 不拥有：权限、OpenClaw、把 chat 当系统指令。
 * 副作用：经回调触发 bridge 提交。
 */

import type { ChatContentKind, ContextAttachHistoryView } from "../../../chat/views.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import { submitZhangBossAttach, submitZhangBossMessage } from "./zhang-boss-actions.js";
import { buildLocalAttachHistory } from "./zhang-boss-local-history.js";

/**
 * Composer 提交所需上下文。
 */
export interface ZhangBossComposerBindingsInput {
  /** bridge */
  bridge: RendererBridgeApi;
  /** 草稿 */
  draft: string;
  /** 内容种类 */
  contentKind: ChatContentKind;
  /** 当前事务 id */
  affairId: string | null;
  /** 通话目标标签 */
  activeCallLabel: string;
  /** 事务目标标签 */
  affairLabel: string;
  /** 失败回调 */
  fail: (message: string) => void;
  /** 成功后清草稿 */
  onOk: (text: string, prefix?: string, attach?: ContextAttachHistoryView) => void;
}

/**
 * @param input 绑定上下文
 * @returns 三个提交函数
 */
export function createZhangBossComposerBindings(input: ZhangBossComposerBindingsInput): {
  onSendMessage: () => void;
  onAttachActiveCall: () => void;
  onAttachAffair: () => void;
} {
  return {
    onSendMessage: () => {
      submitZhangBossMessage(
        input.bridge,
        input.draft.trim(),
        input.affairId,
        input.fail,
        (text) => input.onOk(text),
      );
    },
    onAttachActiveCall: () => {
      submitZhangBossAttach(
        input.bridge,
        input.draft.trim(),
        "active_call",
        input.contentKind,
        input.affairId,
        input.fail,
        (text, kind) =>
          input.onOk(
            text,
            `[附加:${kind}] `,
            buildLocalAttachHistory(
              text,
              kind,
              input.activeCallLabel,
              "realtime 或 FC（经 companion）",
            ),
          ),
      );
    },
    onAttachAffair: () => {
      submitZhangBossAttach(
        input.bridge,
        input.draft.trim(),
        "affair",
        input.contentKind,
        input.affairId,
        input.fail,
        (text, kind) =>
          input.onOk(
            text,
            `[附加:${kind}] `,
            buildLocalAttachHistory(
              text,
              kind,
              input.affairLabel,
              "companion FC fallback",
            ),
          ),
      );
    },
  };
}
