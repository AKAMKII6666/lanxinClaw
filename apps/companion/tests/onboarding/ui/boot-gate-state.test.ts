/**
 * ???????????
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveShellBootTarget } from "../../../src/ui/pages/onboarding/boot-gate-state.js";
import { labelOfOnboardingPhase } from "../../../src/ui/pages/onboarding/phase-labels.js";

test("resolveShellBootTarget: null->loading; ready->bootstrap; else->config", () => {
  assert.equal(resolveShellBootTarget(null), "loading");
  assert.equal(resolveShellBootTarget("ready"), "bootstrap");
  assert.equal(resolveShellBootTarget("unconfigured"), "config");
  assert.equal(resolveShellBootTarget("failed"), "config");
  assert.equal(resolveShellBootTarget("configuring"), "config");
});

test("labelOfOnboardingPhase covers both phases", () => {
  assert.match(labelOfOnboardingPhase("verifying_key"), /API Key/);
  assert.match(labelOfOnboardingPhase("starting_runtime"), /OpenClaw/);
});
