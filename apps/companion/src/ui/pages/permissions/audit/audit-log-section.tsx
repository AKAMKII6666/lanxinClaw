/**
 * 权限页审计日志区。
 *
 * 职责：展示 pairing / permission / job / 高风险动作审计摘要。
 * 不拥有：权限裁决、凭据、OpenClaw。
 * 副作用：无。
 */

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { AuditRecordView } from "../../../../audit/types.js";

/**
 * @param props 审计行
 * @returns JSX
 */
export function AuditLogSection(props: { records: AuditRecordView[] }): ReactElement {
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6">审计日志</Typography>
      {props.records.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          暂无审计记录
        </Typography>
      ) : (
        <Box component="ul" sx={{ mt: 1, pl: 2 }}>
          {props.records.map((r) => (
            <Typography component="li" key={r.auditId} variant="body2">
              [{r.kindLabel}] {r.summary}
              {r.outcome ? ` · ${r.outcome}` : ""}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}
