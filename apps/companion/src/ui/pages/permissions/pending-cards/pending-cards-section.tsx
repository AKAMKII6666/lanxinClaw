/**
 * 待确认权限卡片列表。
 *
 * 职责：展示请求原因、范围、风险与决策按钮。
 * 不拥有：最终授权；仅回调用户选择。
 * 副作用：onDecide 回调。
 */

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type {
  PendingPermissionCardView,
  PermissionDecisionChoice,
} from "../../../../permissions/views.js";
import { DECISION_LABEL, REQUESTER_LABEL, labelOf } from "../permissions-labels.js";

/**
 * @param props 待确认卡片与决策回调
 * @returns 区块 JSX
 */
export function PendingPermissionCardsSection(props: {
  cards: PendingPermissionCardView[];
  onDecide: (permissionRequestId: string, decision: PermissionDecisionChoice) => void;
}): ReactElement {
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6" gutterBottom>
        待确认
      </Typography>
      {props.cards.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          暂无待确认权限请求
        </Typography>
      ) : (
        props.cards.map((card) => (
          <Box
            key={card.permissionRequestId}
            sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 1 }}
          >
            <Typography variant="subtitle2">
              请求：{card.scopeSummary}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              请求方：{labelOf(REQUESTER_LABEL, card.requester)} · 风险：{card.risk}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              事务：{card.affairTitle ?? card.affairId ?? "未绑定"} · Job：{card.jobId}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              原因：{card.reason}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              拒绝后：{card.denyConsequence}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
              {card.availableDecisions.map((decision) => (
                <Button
                  key={decision}
                  size="small"
                  variant={decision === "deny" ? "outlined" : "contained"}
                  color={decision === "deny" ? "error" : "primary"}
                  onClick={() => props.onDecide(card.permissionRequestId, decision)}
                >
                  {DECISION_LABEL[decision]}
                </Button>
              ))}
            </Stack>
          </Box>
        ))
      )}
    </Box>
  );
}
