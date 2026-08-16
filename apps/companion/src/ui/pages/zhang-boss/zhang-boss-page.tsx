/**
 * 控制面板张老板页基础入口。
 *
 * 职责：展示在线情况、当前事务，并将文字上下文提交到 companion backend。
 * 不拥有：把 chat 当系统指令、权限授予、OpenClaw、affair 关闭。
 * 副作用：经 bridge 提交 chat.sendMessage / chat.attachContext。
 */

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useEffect, useState, type ReactElement } from "react";
import { guessContentKind } from "../../../chat/build-outbound.js";
import { projectZhangBossPanelFromSnapshot } from "../../../chat/snapshot-panel-state.js";
import type {
  ChatContentKind,
  ContextAttachHistoryView,
  ZhangBossPanelView,
} from "../../../chat/views.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import { ZhangBossAttachHistory } from "./zhang-boss-attach-history.js";
import { ZhangBossComposer } from "./zhang-boss-composer.js";
import { createZhangBossComposerBindings } from "./zhang-boss-composer-bindings.js";
import { buildLocalUserMessage } from "./zhang-boss-local-history.js";
import { ZhangBossStatusBar } from "./zhang-boss-status-bar.js";
import { ZhangBossThread } from "./zhang-boss-thread.js";

/**
 * 张老板页。
 *
 * @param props 含 bridge
 * @returns 页面 JSX
 */
export function ZhangBossPage(props: { bridge: RendererBridgeApi }): ReactElement {
  const [panel, setPanel] = useState<ZhangBossPanelView>({
    presence: "offline",
    summary: null,
    activeCallId: null,
    currentAffair: null,
    messages: [],
    attachHistory: [],
  });
  const [draft, setDraft] = useState("");
  const [contentKind, setContentKind] = useState<ChatContentKind>("note");
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void props.bridge.getSnapshot().then((snapshot) => {
      if (!cancelled) {
        setPanel((prev) => projectZhangBossPanelFromSnapshot(snapshot, prev));
      }
    });
    const unsubscribe = props.bridge.subscribeSnapshot((snapshot) => {
      setPanel((prev) => projectZhangBossPanelFromSnapshot(snapshot, prev));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [props.bridge]);

  function fail(message: string): void {
    setErrorText(message);
    void props.bridge.reportError({ source: "zhang-boss", message });
  }

  function clearDraftAfterOk(text: string, prefix?: string, attach?: ContextAttachHistoryView): void {
    const entry = buildLocalUserMessage(prefix ? `${prefix}${text}` : text);
    setPanel((prev) => ({
      ...prev,
      messages: [...prev.messages, entry],
      attachHistory: attach ? [attach, ...prev.attachHistory] : prev.attachHistory,
    }));
    setDraft("");
  }

  const bindings = createZhangBossComposerBindings({
    bridge: props.bridge,
    draft,
    contentKind,
    affairId: panel.currentAffair?.affairId ?? null,
    activeCallLabel: panel.activeCallId ? `通话 ${panel.activeCallId}` : "当前通话",
    affairLabel: panel.currentAffair ? `事务 ${panel.currentAffair.affairId}` : "指定事务",
    fail,
    onOk: clearDraftAfterOk,
  });

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        张老板
      </Typography>
      {errorText ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorText(null)}>
          {errorText}
        </Alert>
      ) : null}
      <ZhangBossStatusBar panel={panel} />
      <ZhangBossThread messages={panel.messages} />
      <ZhangBossAttachHistory items={panel.attachHistory} />
      <ZhangBossComposer
        draft={draft}
        contentKind={contentKind}
        canAttachAffair={panel.currentAffair !== null}
        onDraftChange={(value) => {
          setDraft(value);
          if (value.trim().length > 0) {
            setContentKind(guessContentKind(value));
          }
        }}
        onContentKindChange={setContentKind}
        onSendMessage={bindings.onSendMessage}
        onAttachActiveCall={bindings.onAttachActiveCall}
        onAttachAffair={bindings.onAttachAffair}
      />
    </Box>
  );
}
