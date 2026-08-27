/**
 * 协议监听 host 解析单测。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProtocolListenHost } from "../../src/shell/session/listen-host.js";

test("parseProtocolListenHost：仅允许回环或全接口", () => {
  assert.equal(parseProtocolListenHost("0.0.0.0"), "0.0.0.0");
  assert.equal(parseProtocolListenHost("127.0.0.1"), "127.0.0.1");
  assert.equal(parseProtocolListenHost("192.168.0.1"), "127.0.0.1");
  assert.equal(parseProtocolListenHost(undefined), "127.0.0.1");
});
