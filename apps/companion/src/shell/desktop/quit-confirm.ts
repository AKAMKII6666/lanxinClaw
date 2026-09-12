/**
 * 退出确认。
 *
 * 职责：托盘退出前向用户确认；无 dialog 注入时按确认处理，便于测试/降级。
 * 不拥有：窗口隐藏、runtime 停止、app.quit。
 * 副作用：可弹出原生确认框。
 */

/** 确认框依赖 */
export interface QuitConfirmDialog {
  /**
   * 显示消息框。
   *
   * @param options 选项
   * @returns 用户响应
   */
  showMessageBox(options: {
    type: "question";
    buttons: string[];
    defaultId: number;
    cancelId: number;
    title: string;
    message: string;
    detail: string;
    noLink: boolean;
  }): Promise<{ response: number }>;
}

/**
 * 请求退出确认。
 *
 * @param dialog dialog；缺省视为确认
 * @returns 是否确认退出
 */
export async function confirmQuit(dialog?: QuitConfirmDialog | null): Promise<boolean> {
  if (!dialog) {
    return true;
  }
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["退出澜星 Claw", "取消"],
    defaultId: 1,
    cancelId: 1,
    title: "退出澜星 Claw",
    message: "确定要完全退出澜星 Claw 吗？",
    detail: "退出后会停止本机 OpenClaw 运行时，并断开与澜星电话的连接。",
    noLink: true,
  });
  return result.response === 0;
}
