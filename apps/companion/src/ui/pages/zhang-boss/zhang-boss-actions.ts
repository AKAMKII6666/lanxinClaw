/**
 * 张老板页提交动作（纯编排辅助）。
 *
 * 职责：构造并经 bridge 提交 chat 意图；校验失败时回调。
 * 不拥有：UI 状态、权限、系统指令解析。
 * 副作用：调用 bridge.submitAction。
 */

import {
  buildContextAttach,
  buildUserChatMessage,
} from "../../../chat/build-outbound.js";
import type { ChatContentKind } from "../../../chat/views.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";

/**
 * 发送 chat.message。
 *
 * @param bridge renderer 侧 bridge
 * @param text 用户正文
 * @param affairId 可选事务
 * @param onFail 失败回调
 * @param onOk 成功回调
 */
export function submitZhangBossMessage(
  bridge: RendererBridgeApi,
  text: string,
  affairId: string | null,
  onFail: (message: string) => void,
  onOk: (acceptedText: string) => void,
): void {
  const built = buildUserChatMessage(text, affairId);
  if (!built.ok) {
    onFail(built.error.message);
    return;
  }
  void bridge
    .submitAction({ type: "chat.sendMessage", text: built.value.text, affairId })
    .then((result) => {
      if (!result.ok) {
        onFail(result.error.message);
        return;
      }
      onOk(built.value.text);
    }).catch((error: unknown) => onFail(error instanceof Error ? error.message : "消息尚未确认保存，请重试"));
}

/**
 * 提交 chat.attachContext。
 *
 * @param bridge renderer 侧 bridge
 * @param text 附加正文
 * @param target 附加目标
 * @param contentKind 内容种类
 * @param affairId 事务 id（affair 目标时必填）
 * @param onFail 失败回调
 * @param onOk 成功回调
 */
export function submitZhangBossAttach(
  bridge: RendererBridgeApi,
  text: string,
  target: "active_call" | "affair",
  contentKind: ChatContentKind,
  affairId: string | null,
  onFail: (message: string) => void,
  onOk: (acceptedText: string, kind: ChatContentKind) => void,
): void {
  if (target === "affair" && !affairId) {
    onFail("当前没有可附加的事务");
    return;
  }
  const built = buildContextAttach(
    text,
    target,
    contentKind,
    target === "affair" ? affairId : null,
  );
  if (!built.ok) {
    onFail(built.error.message);
    return;
  }
  const action = {
    type: "chat.attachContext",
    text: built.value.text,
    target: built.value.target,
    contentKind: built.value.contentKind,
    ...(built.value.affairId !== undefined ? { affairId: built.value.affairId } : {}),
  } as const;
  void bridge
    .submitAction(action)
    .then((result) => {
      if (!result.ok) {
        onFail(result.error.message);
        return;
      }
      onOk(built.value.text, built.value.contentKind);
    });
}
