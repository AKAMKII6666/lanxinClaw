'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('../lib/parseArgs');
const { loadExFile } = require('../lib/loadExFile');
const { runOrchestrator } = require('../lib/orchestrator');
const { validateReviewReport } = require('../lib/validation/reviewReport');

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

describe('strict CLI parsing', () => {
  it('rejects unknown options instead of accidentally starting a real run', () => {
    assert.throws(() => parseArgs(['--dryrun']), /Unknown option: --dryrun/);
  });

  it('rejects missing values and invalid iteration counts', () => {
    assert.throws(() => parseArgs(['--exFile']), /requires a value/);
    assert.throws(() => parseArgs(['--max-iterations', '0']), /positive integer/);
    assert.throws(() => parseArgs(['--max-iterations=1.5']), /positive integer/);
  });

  it('rejects conflicting reset/clear-blocked switches', () => {
    assert.throws(
      () => parseArgs(['--reset-state', '--clear-blocked']),
      /cannot be used together/,
    );
  });
});

describe('configuration validation', () => {
  it('rejects unsafe and nonsensical merged config during load', () => {
    const tmp = makeTemp('gbx-config-');
    const index = EXAMPLE.replace('batch_size: 2', 'batch_size: 0');
    fs.writeFileSync(path.join(tmp, 'index.md'), index);
    assert.throws(
      () => loadExFile({ exFile: 'index.md', workdir: tmp, cli: {} }),
      /batch_size must be an integer >= 1/,
    );

    const unsafeCheckpoint = EXAMPLE.replace(
      'batch_size: 2',
      'batch_size: 2\ncheckpoint_require_clean: false',
    );
    fs.writeFileSync(path.join(tmp, 'checkpoint.md'), unsafeCheckpoint);
    assert.throws(
      () =>
        loadExFile({
          exFile: 'checkpoint.md',
          workdir: tmp,
          cli: { checkpoint: true },
        }),
      /checkpoint_require_clean=false is unsafe/,
    );
  });

  it('keeps dry-run free of workflow writes', () => {
    const tmp = makeTemp('gbx-dry-');
    fs.writeFileSync(path.join(tmp, 'index.md'), EXAMPLE);
    const code = runOrchestrator({
      exFile: 'index.md',
      workdir: tmp,
      mockAgent: true,
      dryRun: true,
    });
    assert.equal(code, 0);
    assert.equal(fs.existsSync(path.join(tmp, '.ai-workflow-mock')), false);
  });
});

describe('review report freshness', () => {
  it('requires the exact current run, role, and batch identity', () => {
    const base = {
      schemaVersion: 1,
      reviewRunId: 'old-run',
      role: 'batch-reviewer',
      batchId: '1',
      result: 'pass',
      blocker: 0,
      critical: 0,
      major: 0,
      minor: 0,
      issues: [],
    };
    const result = validateReviewReport(base, {
      role: 'batch-reviewer',
      batchId: 1,
      reviewRunId: 'new-run',
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /current review run/);
  });

  it('blocks when the reviewer exits successfully but writes no new report', () => {
    const tmp = makeTemp('gbx-no-review-');
    fs.writeFileSync(path.join(tmp, 'index.md'), EXAMPLE);
    const reviews = path.join(tmp, '.ai-workflow-mock', 'reviews');
    fs.mkdirSync(reviews, { recursive: true });
    fs.writeFileSync(
      path.join(reviews, 'latest.json'),
      JSON.stringify({ result: 'pass', blocker: 0, critical: 0 }),
    );

    const code = withEnv({ GBX_MOCK_SCENARIO: 'reviewer-no-report' }, () =>
      runOrchestrator({ exFile: 'index.md', workdir: tmp, mockAgent: true }),
    );
    assert.equal(code, 3);
    const state = JSON.parse(
      fs.readFileSync(path.join(tmp, '.ai-workflow-mock', 'STATE.json'), 'utf8'),
    );
    assert.equal(state.status, 'BLOCKED');
    assert.match(state.blockedReason, /missing or invalid JSON/);
  });

  it('blocks on reviewer process failure without consulting an old pass', () => {
    const tmp = makeTemp('gbx-review-fail-');
    fs.writeFileSync(path.join(tmp, 'index.md'), EXAMPLE);
    const code = withEnv({ GBX_MOCK_SCENARIO: 'reviewer-fail' }, () =>
      runOrchestrator({ exFile: 'index.md', workdir: tmp, mockAgent: true }),
    );
    assert.equal(code, 3);
    const state = JSON.parse(
      fs.readFileSync(path.join(tmp, '.ai-workflow-mock', 'STATE.json'), 'utf8'),
    );
    assert.match(state.blockedReason, /batch-reviewer failed/);
  });
});

describe('workflow state identity', () => {
  it('refuses to reuse terminal state for another execution index', () => {
    const tmp = makeTemp('gbx-state-id-');
    fs.writeFileSync(path.join(tmp, 'first.md'), EXAMPLE);
    fs.writeFileSync(path.join(tmp, 'second.md'), EXAMPLE);
    assert.equal(
      runOrchestrator({ exFile: 'first.md', workdir: tmp, mockAgent: true }),
      0,
    );
    assert.equal(
      runOrchestrator({ exFile: 'second.md', workdir: tmp, mockAgent: true }),
      1,
    );
  });
});

describe('full verification coverage', () => {
  it('re-runs every task command after final-fixer', () => {
    const tmp = makeTemp('gbx-full-verify-');
    const index = `---
batch_size: 1
max_rounds: 20
max_fix_attempts: 2
max_full_fix_attempts: 2
workflow_dir: .workflow-runtime
verify_default:
  - node -e "process.exit(0)"
---

| 状态 | ID | 任务 | verify |
|------|----|------|--------|
| ⬜ | A1 | first | node -e "console.log('task-a')" |
| ⬜ | B1 | second | node -e "console.log('task-b')" |
`;
    fs.writeFileSync(path.join(tmp, 'index.md'), index);

    const code = withEnv(
      { GBX_MOCK_SCENARIO: 'final-fail-then-verify', GBX_MOCK_REAL_VERIFY: '1' },
      () => runOrchestrator({ exFile: 'index.md', workdir: tmp, mockAgent: true }),
    );
    assert.equal(code, 0);
    const reportsDir = path.join(tmp, '.workflow-runtime', 'reports');
    const fullReport = fs
      .readdirSync(reportsDir)
      .find((name) => name.startsWith('full-'));
    const report = JSON.parse(fs.readFileSync(path.join(reportsDir, fullReport), 'utf8'));
    assert.deepEqual(
      report.results.map((result) => result.command),
      [
        'node -e "console.log(\'task-a\')"',
        'node -e "console.log(\'task-b\')"',
        'node -e "process.exit(0)"',
      ],
    );
  });
});
