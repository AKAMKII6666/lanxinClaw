/**
 * Gateway 指数退避策略测试。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_GATEWAY_RESTART_DELAY_MS,
  nextGatewayRestartDelayMs,
  shouldRetryGatewayRestart,
} from "../../../src/gateway-runtime/policy/restart-policy.js";

test("nextGatewayRestartDelayMs：1s、2s、4s，封顶 60s", () => {
  assert.equal(nextGatewayRestartDelayMs(1), 1_000);
  assert.equal(nextGatewayRestartDelayMs(2), 2_000);
  assert.equal(nextGatewayRestartDelayMs(3), 4_000);
  assert.equal(nextGatewayRestartDelayMs(10), MAX_GATEWAY_RESTART_DELAY_MS);
});

test("shouldRetryGatewayRestart：超过上限停止", () => {
  assert.equal(shouldRetryGatewayRestart(8, 8), true);
  assert.equal(shouldRetryGatewayRestart(9, 8), false);
});
