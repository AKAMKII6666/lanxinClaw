/**
 * 诊断页操作条。
 *
 * 职责：复制报告（本地剪贴板）、提交重启 / 打开日志意图。
 * 不拥有：真实重启 Companion、打开 OS 日志目录。
 * 副作用：剪贴板写入与 onAction 回调。
 */

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { ReactElement } from "react";

/**
 * @param props 报告文本与操作回调
 * @returns 操作条 JSX
 */
export function DiagnosticsActions(props: {
  copyText: string;
  onCopied: (ok: boolean, detail: string) => void;
  onRestart: () => void;
  onOpenLogs: () => void;
}): ReactElement {
  /**
   * 将诊断摘要写入剪贴板；失败时回传说明。
   */
  async function copyReport(): Promise<void> {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        props.onCopied(false, "当前环境无法访问剪贴板");
        return;
      }
      await navigator.clipboard.writeText(props.copyText);
      props.onCopied(true, "诊断报告已复制（不含凭据明文）");
    } catch {
      props.onCopied(false, "复制失败；请手动选择摘要文本");
    }
  }

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Button variant="contained" onClick={() => void copyReport()}>
        复制诊断报告
      </Button>
      <Button variant="outlined" onClick={props.onRestart}>
        重启 Companion
      </Button>
      <Button variant="outlined" onClick={props.onOpenLogs}>
        打开日志目录
      </Button>
    </Stack>
  );
}
