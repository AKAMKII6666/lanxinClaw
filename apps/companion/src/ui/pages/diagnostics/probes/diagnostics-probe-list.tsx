/**
 * 诊断 probe 列表区块。
 *
 * 职责：按服务/环境分组展示 probe 状态与提示。
 * 不拥有：真实探测、复制报告、重启。
 * 副作用：仅渲染。
 */

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import { PROBE_STATUS_LABEL } from "../diagnostics-labels.js";
import type { DiagnosticProbeView, ProbeStatus } from "../diagnostics-models.js";

/**
 * @param status probe 状态
 * @returns MUI Chip 色
 */
function chipColor(status: ProbeStatus): "success" | "warning" | "error" | "default" {
  if (status === "ok") {
    return "success";
  }
  if (status === "warn") {
    return "warning";
  }
  if (status === "error") {
    return "error";
  }
  return "default";
}

/**
 * @param props 标题与 probe 列表
 * @returns 区块 JSX
 */
export function DiagnosticsProbeList(props: {
  title: string;
  probes: DiagnosticProbeView[];
}): ReactElement {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        {props.title}
      </Typography>
      {props.probes.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          暂无检查项
        </Typography>
      ) : (
        <Stack spacing={1}>
          {props.probes.map((probe) => (
            <Box
              key={probe.probeId}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2">{probe.label}</Typography>
                <Chip
                  size="small"
                  label={PROBE_STATUS_LABEL[probe.status]}
                  color={chipColor(probe.status)}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {probe.detail}
              </Typography>
              {probe.hint ? (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  {probe.hint}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
