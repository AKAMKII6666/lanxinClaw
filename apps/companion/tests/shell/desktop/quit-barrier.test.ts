/** 窗口驻留不能阻止显式退出/重启；退出必须等待一次资源清理。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createQuitBarrier } from "../../../src/shell/desktop/quit-barrier.js";

test("连续退出请求共享清理，清理完成前不关闭窗口或重复退出", async () => {
  let finish!: () => void;
  const stopped = new Promise<void>((resolve) => { finish = resolve; });
  const calls: string[] = [];
  const handler = createQuitBarrier({ shutdown: async () => { calls.push("stop"); await stopped; },
    allowWindowClose: () => calls.push("allow-close"), quit: () => calls.push("quit"),
    onError: () => calls.push("error") });
  const event = { preventDefault: () => calls.push("prevent") };
  handler(event); handler(event);
  await Promise.resolve();
  assert.deepEqual(calls, ["prevent", "prevent", "stop"]);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["prevent", "prevent", "stop", "allow-close", "quit"]);
  handler(event);
  assert.equal(calls.length, 5);
});

test("清理异常被记录，退出屏障仍可完成", async () => {
  const calls: string[] = [];
  const handler = createQuitBarrier({ shutdown: async () => { throw new Error("stop failed"); },
    allowWindowClose: () => calls.push("allow-close"), quit: () => calls.push("quit"),
    onError: () => calls.push("error") });
  handler({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["error", "allow-close", "quit"]);
});
