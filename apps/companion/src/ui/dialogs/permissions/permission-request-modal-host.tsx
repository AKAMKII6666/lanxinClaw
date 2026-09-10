import { PermissionRequestDialog } from "./permission-request-dialog.js";
/**
 * 全局权限请求弹窗宿主。
 *
 * 职责：无论当前在哪个页面，待授权请求都顶层弹出；同意/拒绝走 bridge permission.decide。
 * 不拥有：PermissionGate 裁决、renderer 自行授予。
 * 副作用：轮询/刷新 pending cards；关闭仅 dismiss，不决定。
 */

import { useEffect, useState, type ReactElement } from "react";
import type {
  PendingPermissionCardView,
  PermissionDecisionChoice,
} from "../../../permissions/views.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";

const POLL_MS = 1500;

/**
 * 选出尚未 dismiss 的第一条待授权卡。
 *
 * @param cards 全部 pending
 * @param dismissedIds 用户稍后处理的 id
 * @returns 当前应弹窗的卡片；无则 null
 */
export function selectActivePermissionCard(
  cards: PendingPermissionCardView[],
  dismissedIds: readonly string[],
): PendingPermissionCardView | null {
  return cards.find((card) => !dismissedIds.includes(card.permissionRequestId)) ?? null;
}
/**
 * 主同意决策：优先 allow_for_job，否则 allow_once。
 *
 * @param available 卡片可用决策
 * @returns 决策或 null
 */
export function pickPrimaryAllowDecision(
  available: readonly PermissionDecisionChoice[],
): PermissionDecisionChoice | null {
  if (available.includes("allow_for_job")) {
    return "allow_for_job";
  }
  if (available.includes("allow_once")) {
    return "allow_once";
  }
  return null;
}

/**
 * 把 id 加入 dismiss 列表（幂等）。
 *
 * @param prev 原列表
 * @param permissionRequestId 待 dismiss
 * @returns 新列表
 */
export function appendDismissedId(
  prev: readonly string[],
  permissionRequestId: string,
): string[] {
  return prev.includes(permissionRequestId) ? [...prev] : [...prev, permissionRequestId];
}

/**
 * @param props bridge
 * @returns Dialog JSX
 */
export function PermissionRequestModalHost(props: {
  bridge: RendererBridgeApi;
}): ReactElement | null {
  const { bridge } = props;
  const [cards, setCards] = useState<PendingPermissionCardView[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function refresh(): void {
      void bridge.listPendingPermissionCards().then((next) => {
        if (!cancelled) {
          setCards(next);
        }
      });
    }
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [bridge]);

  const active = selectActivePermissionCard(cards, dismissedIds);
  if (active === null) {
    return null;
  }

  const remainingCount = cards.filter(
    (card) => !dismissedIds.includes(card.permissionRequestId),
  ).length;
  const allowDecision = pickPrimaryAllowDecision(active.availableDecisions);
  const canDeny = active.availableDecisions.includes("deny");

  return (
    <PermissionRequestDialog
      card={active}
      remainingCount={remainingCount}
      errorText={errorText}
      busy={busy}
      canDeny={canDeny}
      allowDecision={allowDecision}
      onClearError={() => setErrorText(null)}
      onDismiss={() => {
        setDismissedIds((prev) => appendDismissedId(prev, active.permissionRequestId));
      }}
      onDecide={(decision) => {
        submitPermissionDecision({
          bridge,
          permissionRequestId: active.permissionRequestId,
          decision,
          busy,
          setBusy,
          setErrorText,
          setCards,
          setDismissedIds,
        });
      }}
    />
  );
}

/**
 * 提交 permission.decide 并刷新卡片。
 */
function submitPermissionDecision(input: {
  bridge: RendererBridgeApi;
  permissionRequestId: string;
  decision: PermissionDecisionChoice;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setErrorText: (value: string | null) => void;
  setCards: (cards: PendingPermissionCardView[]) => void;
  setDismissedIds: (updater: (prev: string[]) => string[]) => void;
}): void {
  if (input.busy) {
    return;
  }
  input.setBusy(true);
  input.setErrorText(null);
  void input.bridge
    .submitAction({
      type: "permission.decide",
      permissionRequestId: input.permissionRequestId,
      decision: input.decision,
    })
    .then((result) => {
      input.setBusy(false);
      if (!result.ok) {
        input.setErrorText(result.error.message);
        void input.bridge.reportError({
          source: "permission-modal",
          message: result.error.message,
        });
        return;
      }
      if (result.pendingPermissionCards) {
        input.setCards(result.pendingPermissionCards);
      } else {
        void input.bridge.listPendingPermissionCards().then(input.setCards);
      }
      input.setDismissedIds((prev) =>
        prev.filter((id) => id !== input.permissionRequestId),
      );
    })
    .catch((error: unknown) => {
      input.setBusy(false);
      input.setErrorText(error instanceof Error ? error.message : String(error));
    });
}
