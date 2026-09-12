/**
 * Gateway sessionKey 规范化单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeGatewaySessionKey,
  sessionKeysEquivalent,
  toGatewaySessionKey,
  toJobIdempotencyKey,
} from "../../src/client/gateway/session-key.js";

describe("gateway-session-key", () => {
  it("toGatewaySessionKey 产出 agent:main:lanxing-job:…", () => {
    assert.equal(toGatewaySessionKey("job_1"), "agent:main:lanxing-job:job_1");
    assert.equal(toGatewaySessionKey("job_1", "worker"), "agent:worker:lanxing-job:job_1");
  });

  it("canonicalize 兼容裸 key 与已 canonical", () => {
    assert.equal(
      canonicalizeGatewaySessionKey("lanxing-job:job_1"),
      "agent:main:lanxing-job:job_1",
    );
    assert.equal(
      canonicalizeGatewaySessionKey("agent:main:lanxing-job:job_1"),
      "agent:main:lanxing-job:job_1",
    );
    assert.equal(
      canonicalizeGatewaySessionKey(null, "main", "job_1"),
      "agent:main:lanxing-job:job_1",
    );
  });

  it("sessionKeysEquivalent 接受 legacy ↔ canonical", () => {
    assert.equal(
      sessionKeysEquivalent("agent:main:lanxing-job:job_1", "lanxing-job:job_1", "job_1"),
      true,
    );
    assert.equal(
      sessionKeysEquivalent("lanxing-job:job_1", "agent:main:lanxing-job:job_1", "job_1"),
      true,
    );
    assert.equal(
      sessionKeysEquivalent("agent:main:lanxing-job:job_1", "lanxing-job:other", "job_1"),
      false,
    );
  });

  it("idempotencyKey 与 sessionKey 解耦", () => {
    assert.equal(toJobIdempotencyKey("job_1"), "lanxing-job:job_1");
    assert.notEqual(toJobIdempotencyKey("job_1"), toGatewaySessionKey("job_1"));
  });
});
