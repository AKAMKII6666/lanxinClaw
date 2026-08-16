/**
 * 壳侧栏导航。
 *
 * 职责：渲染固定 Drawer 与页面切换入口。
 * 不拥有：页面内容、pairing 弹窗。
 * 副作用：经 onNavigate 回调。
 */

import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Toolbar from "@mui/material/Toolbar";
import type { ReactElement } from "react";
import type { BridgeNavPage } from "../../bridge/contract.js";

const DRAWER_WIDTH = 180;

/**
 * @param props 当前页与导航项
 * @returns Drawer JSX
 */
export function ShellSideNav(props: {
  page: BridgeNavPage;
  items: { page: BridgeNavPage; label: string }[];
  onNavigate: (page: BridgeNavPage) => void;
}): ReactElement {
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        [`& .MuiDrawer-paper`]: {
          width: DRAWER_WIDTH,
          boxSizing: "border-box",
          borderRight: 1,
          borderColor: "divider",
        },
      }}
    >
      <Toolbar />
      <List dense>
        {props.items.map((item) => (
          <ListItemButton
            key={item.page}
            selected={props.page === item.page}
            onClick={() => props.onNavigate(item.page)}
          >
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
}
