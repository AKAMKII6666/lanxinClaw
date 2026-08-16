/**
 * 首次 Pairing 确认弹窗。
 *
 * 职责：展示设备指纹、双确认文案，并提交允许 / 拒绝 / 重新扫描意图。
 * 不拥有：pairing 状态机、identity 持久化、凭据传输。
 * 副作用：仅回调；最终裁决仍在 companion backend。
 */

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { PendingPairingRequestView } from "../../../pairing/views/pending-request-view.js";

/**
 * @param props 请求视图与操作回调
 * @returns Dialog JSX；无请求时返回 null
 */
export function FirstPairingDialog(props: {
  request: PendingPairingRequestView | null;
  open: boolean;
  onApprove: (pairingId: string) => void;
  onReject: (pairingId: string) => void;
  onRescan: () => void;
}): ReactElement | null {
  if (props.request === null) {
    return null;
  }
  const request = props.request;

  return (
    <Dialog open={props.open} maxWidth="sm" fullWidth disableEscapeKeyDown>
      <DialogTitle>确认配对澜星电话</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {request.summary}
        </Typography>
        <Stack spacing={1} sx={{ mb: 2 }}>
          <Typography variant="subtitle2">{request.phoneDisplayName}</Typography>
          <Typography variant="body2" color="text.secondary">
            设备指纹：{request.fingerprintHint}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            发现方式：{request.discoveryMethodLabel} · 状态：{request.statusLabel}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            设备 id：{request.phoneDeviceId}
          </Typography>
        </Stack>
        <Alert severity="info" variant="outlined">
          {request.dualConfirmHint}
        </Alert>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={props.onRescan}>重新扫描</Button>
        <Button color="inherit" onClick={() => props.onReject(request.pairingId)}>
          拒绝
        </Button>
        <Button variant="contained" onClick={() => props.onApprove(request.pairingId)}>
          允许
        </Button>
      </DialogActions>
    </Dialog>
  );
}
