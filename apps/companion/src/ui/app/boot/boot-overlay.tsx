/**
 * 冷启动 / 加载全屏遮罩。
 *
 * 职责：展示运行时启动进度或错误重试。
 * 不拥有：bootstrap IPC。
 */

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { OnboardingPhase } from "../../../bridge/contract.js";
import { labelOfOnboardingPhase } from "../../pages/onboarding/phase-labels.js";

/**
 * @param props 阶段与错误
 * @returns JSX
 */
export function BootOverlay(props: {
  phase: OnboardingPhase;
  error: string | null;
  onRetry: (() => void) | null;
}): ReactElement {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        p: 2,
      }}
    >
      <Stack spacing={2} alignItems="center" sx={{ maxWidth: 420, textAlign: "center" }}>
        {props.error ? null : <CircularProgress />}
        <Typography variant="h6">澜星 Claw</Typography>
        <Typography variant="body1" color="text.secondary">
          {props.error ? props.error : labelOfOnboardingPhase(props.phase)}
        </Typography>
        {props.onRetry ? (
          <Button variant="contained" onClick={props.onRetry}>
            重试启动
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}
