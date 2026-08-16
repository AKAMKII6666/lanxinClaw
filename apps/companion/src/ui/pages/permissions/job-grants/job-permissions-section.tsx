/**
 * 当前 job 权限授予列表。
 *
 * 职责：展示 permission id、范围与授予态。
 * 不拥有：gate 裁决、命令执行。
 * 纯展示：无副作用。
 */

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { JobPermissionGrantView } from "../../../../permissions/views.js";
import { GRANT_STATUS_LABEL, PERMISSION_ID_LABEL, labelOf } from "../permissions-labels.js";

/**
 * @param props job 权限列表
 * @returns 区块 JSX
 */
export function JobPermissionsSection(props: {
  currentJobId: string | null;
  grants: JobPermissionGrantView[];
}): ReactElement {
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6" gutterBottom>
        当前 job 权限
      </Typography>
      {props.currentJobId ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          job：{props.currentJobId}
        </Typography>
      ) : null}
      {props.grants.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          当前无 job 权限记录
        </Typography>
      ) : (
        props.grants.map((grant) => (
          <Box
            key={`${grant.permissionId}:${grant.scopeSummary}`}
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(120px, 1fr) minmax(0, 2fr) auto",
              gap: 1,
              py: 0.75,
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Typography variant="body2">{labelOf(PERMISSION_ID_LABEL, grant.permissionId)}</Typography>
            <Typography variant="body2" color="text.secondary">
              {grant.scopeSummary}
            </Typography>
            <Typography variant="body2">{labelOf(GRANT_STATUS_LABEL, grant.grantStatus)}</Typography>
          </Box>
        ))
      )}
    </Box>
  );
}
