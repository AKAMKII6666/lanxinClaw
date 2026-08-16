'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runOrchestrator } = require('../lib/orchestrator');

const SKILL_ROOT = path.resolve(__dirname, '..');

describe('orchestrator mock fail-then-pass', () => {
  it('recovers via FIX_BATCH then READY', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-fail-'));
    fs.writeFileSync(path.join(tmp, 'README.md'), '# tmp\n');
    const src = fs.readFileSync(path.join(SKILL_ROOT, 'examples/mock-happy-index.md'), 'utf8');
    fs.writeFileSync(path.join(tmp, 'index.md'), src);

    const prev = process.env.GBX_MOCK_SCENARIO;
    process.env.GBX_MOCK_SCENARIO = 'fail-then-pass';
    try {
      const code = runOrchestrator({
        exFile: path.join(tmp, 'index.md'),
        workdir: tmp,
        mockAgent: true,
      });
      assert.equal(code, 0);
      const state = JSON.parse(
        fs.readFileSync(path.join(tmp, '.ai-workflow-mock', 'STATE.json'), 'utf8'),
      );
      assert.equal(state.status, 'READY_FOR_MANUAL_QA');
      assert.ok(state.mockReviewFailedOnce === true);
    } finally {
      if (prev === undefined) {
        delete process.env.GBX_MOCK_SCENARIO;
      } else {
        process.env.GBX_MOCK_SCENARIO = prev;
      }
    }
  });
});
