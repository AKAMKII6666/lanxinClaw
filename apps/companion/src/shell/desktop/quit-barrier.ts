/** 统一 app.quit/relaunch 的资源清理；清理只执行一次，完成后才允许窗口关闭。 */
export function createQuitBarrier(input: {
  shutdown: () => Promise<void>;
  allowWindowClose: () => void;
  quit: () => void;
  onError: (error: unknown) => void;
}): (event?: { preventDefault(): void }) => void {
  let complete = false;
  let pending: Promise<void> | null = null;
  return (event) => {
    if (complete) return;
    event?.preventDefault();
    if (pending) return;
    pending = Promise.resolve().then(input.shutdown).catch(input.onError).then(() => {
      complete = true;
      input.allowWindowClose();
      input.quit();
    });
  };
}
