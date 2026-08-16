/**
 * 诊断页「最近错误」区块。
 *
 * 职责：展示 last error 摘要；不把 worker completed 写成 affair closed。
 * 不拥有：重试执行、权限裁决。
 * 副作用：仅渲染。
 */

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { DiagnosticLastErrorView } from "../diagnostics-models.js";

/**
 * @param props.lastError 最近错误；null 表示无
 * @returns 区块 JSX
 */
export function DiagnosticsLastError(props: {
  lastError: DiagnosticLastErrorView | null;
}): ReactElement {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        最近错误
      </Typography>
      {props.lastError === null ? (
        <Typography color="text.secondary" variant="body2">
          无
        </Typography>
      ) : (
        <Alert severity="error" variant="outlined">
          <Typography variant="body2">
            {props.lastError.occurredAt.slice(11, 16)} {props.lastError.code}：
            {props.lastError.message}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            {props.lastError.retryable ? "可重试" : "不可自动重试"}
            {props.lastError.affairId ? ` · affair ${props.lastError.affairId}` : ""}
            {props.lastError.jobId ? ` · job ${props.lastError.jobId}` : ""}
          </Typography>
        </Alert>
      )}
    </Box>
  );
}
