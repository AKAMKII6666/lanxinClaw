'use strict';

/**
 * REST-G1/G2: final-reviewer Prompt must require batchId "final";
 * validateReviewReport must reject numeric batch ids for final phase.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildPrompt,
  batchReviewJsonContract,
  finalReviewJsonContract,
} = require('../lib/prompts');
const { validateReviewReport } = require('../lib/validation/reviewReport');
const { decideAfterReview } = require('../lib/reviewDecision');
const { STATUSES } = require('../lib/fsm');
const { runOrchestrator } = require('../lib/orchestrator');

const SKILL_ROOT = path.resolve(__dirname, '..');
const EXAMPLE = fs.readFileSync(
  path.join(SKILL_ROOT, 'examples/mock-happy-index.md'),
  'utf8',
);

function makeTemp(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(tmp, 'README.md'), '# test workdir\n');
  return tmp;
}

function withEnv(values, fn) {
  const before = {};
  for (const [key, value] of Object.entries(values)) {
    before[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const baseCtx = {
  exAbs: '/tmp/index.md',
  workdir: '/tmp',
  workflowDir: '.ai-workflow',
  batchIds: [],
  batchNumber: 8,
  config: {},
  readFirstStatus: [],
  reviewRunId: 'final-reviewer-final-test-uuid',
};

describe('final-reviewer prompt batchId contract', () => {
  it('final prompt requires batchId "final" and never the "<n>" placeholder', () => {
    const prompt = buildPrompt('final-reviewer', baseCtx);
    assert.match(prompt, /"batchId": "final"/);
    assert.doesNotMatch(prompt, /"batchId": "<n>"/);
    assert.match(prompt, /exactly the string "final"/i);
    // Must not surface a copy-pasteable current batch number line.
    assert.doesNotMatch(prompt, /Current batch number:\s*8/);
    assert.match(prompt, /no batch number/i);
  });

  it('batch prompt still documents a batch-number batchId, not "final"', () => {
    const prompt = buildPrompt('batch-reviewer', {
      ...baseCtx,
      batchIds: ['T1'],
      reviewRunId: 'batch-reviewer-8-test-uuid',
    });
    assert.match(prompt, /batch-reviewer/);
    assert.doesNotMatch(prompt, /"batchId": "final"/);
    assert.match(prompt, /Current batch number:\s*8/);
  });

  it('contract helpers diverge: batch vs final templates', () => {
    const batch = batchReviewJsonContract();
    const fin = finalReviewJsonContract();
    assert.match(batch, /batch-reviewer/);
    assert.doesNotMatch(batch, /"batchId": "final"/);
    assert.match(fin, /"batchId": "final"/);
    assert.doesNotMatch(fin, /"batchId": "<n>"/);
  });
});

describe('final-reviewer report validation (producer must use "final")', () => {
  const runId = 'final-reviewer-final-abc';

  function report(batchId) {
    return {
      schemaVersion: 1,
      reviewRunId: runId,
      role: 'final-reviewer',
      batchId,
      result: 'pass',
      blocker: 0,
      critical: 0,
      major: 0,
      minor: 0,
      issues: [],
      recommendedNextState: 'READY_FOR_MANUAL_QA',
    };
  }

  it('rejects batchId "8" (does not relax consumer)', () => {
    const result = validateReviewReport(report('8'), {
      role: 'final-reviewer',
      batchId: 'final',
      reviewRunId: runId,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /batchId must be final/);
  });

  it('accepts batchId "final" and decision reaches READY_FOR_MANUAL_QA', () => {
    const result = validateReviewReport(report('final'), {
      role: 'final-reviewer',
      batchId: 'final',
      reviewRunId: runId,
    });
    assert.equal(result.ok, true);
    const decision = decideAfterReview(report('final'), {
      phase: 'full',
      fullFixAttempts: 0,
      maxFullFixAttempts: 2,
    });
    assert.equal(decision.next, STATUSES.READY_FOR_MANUAL_QA);
  });
});

describe('mock final-reviewer path reaches READY_FOR_MANUAL_QA', () => {
  it('happy mock run ends READY_FOR_MANUAL_QA with batchId final', () => {
    const tmp = makeTemp('gbx-final-batchid-');
    fs.writeFileSync(path.join(tmp, 'index.md'), EXAMPLE);
    const code = withEnv({ GBX_MOCK_SCENARIO: '' }, () =>
      runOrchestrator({ exFile: 'index.md', workdir: tmp, mockAgent: true }),
    );
    assert.equal(code, 0);
    const state = JSON.parse(
      fs.readFileSync(path.join(tmp, '.ai-workflow-mock', 'STATE.json'), 'utf8'),
    );
    assert.equal(state.status, 'READY_FOR_MANUAL_QA');
  });
});
