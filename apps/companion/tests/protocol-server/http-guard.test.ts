/**
 * HTTP 回环判断单测。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { isLoopbackAddress } from "../../src/protocol-server/guards/http/http-guard.js";

test("isLoopbackAddress 识别 IPv4/IPv6 回环", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.8"), false);
  assert.equal(isLoopbackAddress(undefined), false);
});
