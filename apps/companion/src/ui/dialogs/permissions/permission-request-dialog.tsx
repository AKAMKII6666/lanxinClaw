/** 权限卡纯展示；不裁决权限，用户选择经宿主 bridge 处理。 */
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { PendingPermissionCardView, PermissionDecisionChoice } from "../../../permissions/views.js";
import {
  DECISION_LABEL,
  REQUESTER_LABEL,
  labelOf,
} from "../../pages/permissions/permissions-labels.js";

/**
 * 纯展示弹窗；决策回调由宿主注入。
 */
export function PermissionRequestDialog(props: {
  card: PendingPermissionCardView;
  remainingCount: number;
  errorText: string | null;
  busy: boolean;
  canDeny: boolean;
  allowDecision: PermissionDecisionChoice | null;
  onClearError: () => void;
  onDismiss: () => void;
  onDecide: (decision: PermissionDecisionChoice) => void;
}): ReactElement {
  const card = props.card;
  return (
    <Dialog open maxWidth="sm" fullWidth onClose={props.onDismiss}>
      <DialogTitle>电脑事务需要授权</DialogTitle>
      <DialogContent>
        {props.errorText ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={props.onClearError}>
            {props.errorText}
          </Alert>
        ) : null}
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          张老板发来的任务正在等待桌面授权。同意或拒绝后才会继续；关闭本弹窗不会做决定，可稍后在「权限」页处理。
        </Typography>
        <Stack spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2">{card.scopeSummary}</Typography>
          <Typography variant="body2" color="text.secondary">
            请求方：{labelOf(REQUESTER_LABEL, card.requester)} · 风险：{card.risk}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            事务：{card.affairTitle ?? card.affairId ?? "未绑定"} · Job：{card.jobId}
          </Typography>
          <Typography variant="body2">原因：{card.reason}</Typography>
          <Typography variant="body2" color="text.secondary">
            拒绝后：{card.denyConsequence}
          </Typography>
          {props.remainingCount > 1 ? (
            <Typography variant="caption" color="text.secondary">
              另有 {props.remainingCount - 1} 条待授权，处理完本条后会继续弹出。
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" disabled={props.busy} onClick={props.onDismiss}>
          稍后处理
        </Button>
        {props.canDeny ? (
          <Button
            color="error"
            variant="outlined"
            disabled={props.busy}
            onClick={() => props.onDecide("deny")}
          >
            {DECISION_LABEL.deny}
          </Button>
        ) : null}
        {props.allowDecision ? (
          <Button
            variant="contained"
            disabled={props.busy}
            onClick={() => props.onDecide(props.allowDecision as PermissionDecisionChoice)}
          >
            {DECISION_LABEL[props.allowDecision]}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
