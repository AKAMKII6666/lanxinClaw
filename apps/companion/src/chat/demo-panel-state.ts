/**
 * 张老板页演示状态（真实 chat 通道未闭环前的安全占位）。
 *
 * 职责：提供在线态、当前事务与样例线程。
 * 不拥有：真实 phone session、权限、OpenClaw。
 * 纯函数：返回静态结构；不含凭据明文；text 为 untrusted。
 */

import type { ZhangBossPanelView } from "./views.js";

/**
 * 构造张老板页演示面板。
 *
 * @returns 可渲染且无秘密的面板视图
 */
export function createDemoZhangBossPanel(): ZhangBossPanelView {
  return {
    presence: "supervising",
    summary: "正在盯「修好 xxx 项目代码问题」",
    activeCallId: "call_demo_001",
    currentAffair: {
      affairId: "affair_fix_code_001",
      title: "修好 xxx 项目代码问题",
      status: "running",
      progressSummary: "已定位失败用例，正在尝试修复",
    },
    messages: [
      {
        messageId: "chat_demo_zb_001",
        authorKind: "zhang-boss",
        text: "我现在在看这个项目，刚才测试卡在一个路径问题上。",
        sentAt: "2026-07-23T01:00:00.000Z",
      },
      {
        messageId: "chat_demo_user_001",
        authorKind: "user",
        text: "F:/workspace/xxx/src/main.ts 就是这个文件。",
        sentAt: "2026-07-23T01:01:00.000Z",
      },
      {
        messageId: "chat_demo_zb_002",
        authorKind: "zhang-boss",
        text: "收到，我把这个路径补进当前事务里，让 Claw 重点看这里。",
        sentAt: "2026-07-23T01:02:00.000Z",
      },
    ],
    attachHistory: [
      {
        attachId: "attach_demo_001",
        targetLabel: "事务 affair_fix_code_001",
        contentKind: "path",
        text: "F:/workspace/xxx/src/main.ts",
        deliveryLabel: "companion FC fallback",
        attachedAt: "2026-07-23T01:01:05.000Z",
      },
    ],
  };
}
