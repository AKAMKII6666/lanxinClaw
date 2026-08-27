/**
 * 控制面板诊断页。
 *
 * 职责：展示服务/环境 probe、最近错误，并经 bridge 提交重启与打开日志意图。
 * 不拥有：真实 OS 探测、凭据明文、自动修复系统问题。
 * 副作用：剪贴板复制与 bridge.submitAction / reportError。
 */

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useEffect, useState, type ReactElement } from "react";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import { DiagnosticsActions } from "./actions/diagnostics-actions.js";
import { DIAGNOSTICS_RESTART_COMPANION_ACTION } from "./diagnostics-bridge-actions.js";
import { OVERALL_STATUS_LABEL } from "./diagnostics-labels.js";
import type { DiagnosticReportView } from "./diagnostics-models.js";
import { DiagnosticsLastError } from "./probes/diagnostics-last-error.js";
import { DiagnosticsProbeList } from "./probes/diagnostics-probe-list.js";

/**
 * 诊断页。
 *
 * @param props 含 bridge
 * @returns 诊断页 JSX
 */
export function DiagnosticsPage(props: { bridge: RendererBridgeApi }): ReactElement {
  const [report, setReport] = useState<DiagnosticReportView | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load(): void {
      void props.bridge.getDiagnosticReport().then((next) => {
        if (!cancelled) {
          setReport(next);
        }
      });
    }
    load();
    const timer = setInterval(load, 3_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [props.bridge]);

  /**
   * 提交诊断相关 bridge 操作。
   *
   * @param action 白名单操作
   */
  function submit(
    action: typeof DIAGNOSTICS_RESTART_COMPANION_ACTION | { type: "diagnostics.openLogs" },
  ): void {
    void props.bridge.submitAction(action).then((result) => {
      if (!result.ok) {
        setErrorText(result.error.message);
        void props.bridge.reportError({ source: "diagnostics", message: result.error.message });
      }
    });
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Typography variant="h5">诊断</Typography>
        <Chip
          size="small"
          label={report ? OVERALL_STATUS_LABEL[report.overallStatus] : "加载中"}
          color={report?.overallStatus === "ok" ? "success" : "warning"}
        />
      </Box>
      {errorText ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorText(null)}>
          {errorText}
        </Alert>
      ) : null}
      {feedback ? (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setFeedback(null)}>
          {feedback}
        </Alert>
      ) : null}
      <DiagnosticsProbeList title="服务" probes={report?.services ?? []} />
      <DiagnosticsProbeList title="环境" probes={report?.environment ?? []} />
      <DiagnosticsLastError lastError={report?.lastError ?? null} />
      <DiagnosticsActions
        copyText={report?.copyText ?? "diagnostics=loading"}
        onCopied={(ok, detail) => {
          if (ok) {
            setFeedback(detail);
            setErrorText(null);
          } else {
            setErrorText(detail);
            void props.bridge.reportError({ source: "diagnostics", message: detail });
          }
        }}
        onRestart={() => {
          submit(DIAGNOSTICS_RESTART_COMPANION_ACTION);
        }}
        onOpenLogs={() => {
          submit({ type: "diagnostics.openLogs" });
        }}
      />
    </Box>
  );
}
