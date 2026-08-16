/**
 * 已配对设备列表与 revoke / 断开入口。
 *
 * 职责：展示设备摘要并提交断开/撤销意图。
 * 不拥有：identity store、pairing 状态机。
 * 副作用：仅回调。
 */

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { PairedDeviceView } from "../../../../permissions/views.js";

/**
 * @param props 设备列表与操作
 * @returns 区块 JSX
 */
export function PairedDevicesSection(props: {
  devices: PairedDeviceView[];
  onDisconnect: (device: PairedDeviceView) => void;
  onRevoke: (device: PairedDeviceView) => void;
}): ReactElement {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        已配对设备
      </Typography>
      {props.devices.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          尚无已配对设备
        </Typography>
      ) : (
        props.devices.map((device) => (
          <Box
            key={`${device.phoneDeviceId}:${device.desktopDeviceId}`}
            sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 1 }}
          >
            <Typography variant="subtitle2">
              {device.phoneDisplayName} · {device.connectionLabel}
              {device.fingerprintHint ? ` · 指纹 ${device.fingerprintHint}` : ""}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button size="small" variant="outlined" onClick={() => props.onDisconnect(device)}>
                断开
              </Button>
              {device.canRevoke ? (
                <Button size="small" color="error" variant="outlined" onClick={() => props.onRevoke(device)}>
                  撤销配对
                </Button>
              ) : null}
            </Stack>
          </Box>
        ))
      )}
    </Box>
  );
}
