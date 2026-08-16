'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runOrchestrator } = require('../lib/orchestrator');
const { mergeConfig } = require('../lib/mergeConfig');
const {
  evaluateBlockAnalysis,
  evaluateRepairChanges,
} = require('../lib/blockRecovery');
const { buildPrompt } = require('../lib/prompts');

function makeTemp(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(tmp, 'README.md'), '# recovery test\n');
  return tmp;
}

function writeRecoveryIndex(tmp, { hardStopPattern = null } = {}) {
  const hardStop = hardStopPattern
    ? `hard_stop_patterns:
  - ${JSON.stringify(hardStopPattern)}
`
    : '';
  const index = `---
batch_size: 1
max_rounds: 20
max_fix_attempts: 0
workflow_dir: .workflow-recovery
verify_default:
  - >-
    node -e "process.exit(require('fs').existsSync('recovered.ok') ? 0 : 1)"
${hardStop}block_recovery:
  enabled: true
  max_attempts: 1
---

| 状态 | ID | 任务 | verify |
|------|----|------|--------|
| ⬜ | R1 | create recovery marker | — |
`;
  fs.writeFileSync(path.join(tmp, 'index.md'), index);
}

function withScenario(scenario, fn) {
  const previousScenario = process.env.GBX_MOCK_SCENARIO;
  const previousRealVerify = process.env.GBX_MOCK_REAL_VERIFY;
  process.env.GBX_MOCK_SCENARIO = scenario;
  process.env.GBX_MOCK_REAL_VERIFY = '1';
  try {
    return fn();
  } finally {
    if (previousScenario === undefined) delete process.env.GBX_MOCK_SCENARIO;
    else process.env.GBX_MOCK_SCENARIO = previousScenario;
    if (previousRealVerify === undefined) delete process.env.GBX_MOCK_REAL_VERIFY;
    else process.env.GBX_MOCK_REAL_VERIFY = previousRealVerify;
  }
}

describe('automatic block recovery FSM', () => {
  it('keeps malformed-index dry-run read-only', () => {
    const tmp = makeTemp('gbx-block-dry-');
    fs.writeFileSync(
      path.join(tmp, 'index.md'),
      `---
batch_size: invalid
verify_default:
  - node -e "process.exit(0)"
---
| 状态 | ID | 任务 |
|---|---|---|
| ⬜ | D1 | dry |
`,
    );
    const code = runOrchestrator({
      exFile: 'index.md',
      workdir: tmp,
      mockAgent: true,
      dryRun: true,
    });
    assert.equal(code, 1);
    assert.equal(
      fs.existsSync(path.join(tmp, '.ai-workflow-preflight')),
      false,
    );
  });

  it('respects an explicit preflight recovery opt-out', () => {
    const tmp = makeTemp('gbx-block-disabled-');
    fs.writeFileSync(
      path.join(tmp, 'index.md'),
      `---
batch_size: invalid
block_recovery:
  enabled: false
verify_default:
  - node -e "process.exit(0)"
---
| 状态 | ID | 任务 |
|---|---|---|
| ⬜ | D1 | disabled |
`,
    );
    const code = runOrchestrator({
      exFile: 'index.md',
      workdir: tmp,
      mockAgent: true,
    });
    assert.equal(code, 1);
    assert.equal(
      fs.existsSync(path.join(tmp, '.ai-workflow-preflight')),
      false,
    );
  });

  it('repairs a syntactically loadable but invalid execution-index field before start', () => {
    const tmp = makeTemp('gbx-block-preflight-');
    const index = `---
batch_size: invalid
max_rounds: 10
workflow_dir: .workflow-main
verify_default:
  - node -e "process.exit(0)"
---

| 状态 | ID | 任务 | verify |
|------|----|------|--------|
| ⬜ | P1 | preflight repair | — |
`;
    fs.writeFileSync(path.join(tmp, 'index.md'), index);

    const code = withScenario('happy', () =>
      runOrchestrator({
        exFile: 'index.md',
        workdir: tmp,
        mockAgent: true,
      }),
    );

    assert.equal(code, 0);
    assert.match(
      fs.readFileSync(path.join(tmp, 'index.md'), 'utf8'),
      /batch_size: 1/,
    );
    assert.ok(
      fs.existsSync(
        path.join(
          tmp,
          '.ai-workflow-preflight',
          'reports',
          'latest-block-analysis.json',
        ),
      ),
    );
  });

  it('analyzes, repairs, verifies, and resumes after ordinary fix budget is exhausted', () => {
    const tmp = makeTemp('gbx-block-recover-');
    writeRecoveryIndex(tmp);

    const code = withScenario('block-recovery-success', () =>
      runOrchestrator({
        exFile: 'index.md',
        workdir: tmp,
        mockAgent: true,
      }),
    );

    assert.equal(code, 0);
    assert.equal(fs.existsSync(path.join(tmp, 'recovered.ok')), true);
    const workflow = path.join(tmp, '.workflow-recovery');
    const state = JSON.parse(
      fs.readFileSync(path.join(workflow, 'STATE.json'), 'utf8'),
    );
    assert.equal(state.status, 'READY_FOR_MANUAL_QA');
    const log = fs.readFileSync(path.join(workflow, 'logs', 'loop.log'), 'utf8');
    assert.match(log, /status=BLOCK_ANALYZE/);
    assert.match(log, /status=BLOCK_REPAIR/);
    assert.match(log, /status=BLOCK_VERIFY/);
    assert.ok(fs.existsSync(path.join(workflow, 'reports', 'latest-block-analysis.json')));
    assert.ok(fs.existsSync(path.join(workflow, 'reports', 'latest-block-repair.json')));
  });

  it('does not re-trigger a quoted hard-stop while analyzer and resolver run', () => {
    const tmp = makeTemp('gbx-block-hard-stop-quote-');
    writeRecoveryIndex(tmp, { hardStopPattern: 'mock batch review pass' });

    const code = withScenario('block-recovery-success', () =>
      runOrchestrator({
        exFile: 'index.md',
        workdir: tmp,
        mockAgent: true,
      }),
    );

    assert.equal(code, 0);
    assert.equal(fs.existsSync(path.join(tmp, 'recovered.ok')), true);
    const workflow = path.join(tmp, '.workflow-recovery');
    const log = fs.readFileSync(path.join(workflow, 'logs', 'loop.log'), 'utf8');
    assert.equal((log.match(/status=BLOCK_ANALYZE/g) || []).length, 1);
    assert.equal((log.match(/status=BLOCK_REPAIR/g) || []).length, 1);
    assert.match(log, /hard_stop scan bypassed during BLOCK_ANALYZE/);
    assert.match(log, /hard_stop scan bypassed during BLOCK_REPAIR/);
  });

  it('reopens a legacy recoverable BLOCKED state on the next invocation', () => {
    const tmp = makeTemp('gbx-block-reopen-');
    writeRecoveryIndex(tmp);
    const indexPath = path.join(tmp, 'index.md');
    fs.writeFileSync(
      indexPath,
      fs.readFileSync(indexPath, 'utf8').replace('| ⬜ | R1 |', '| ✅ | R1 |'),
    );
    const workflow = path.join(tmp, '.workflow-recovery');
    fs.mkdirSync(workflow, { recursive: true });
    fs.writeFileSync(
      path.join(workflow, 'STATE.json'),
      `${JSON.stringify({
        status: 'BLOCKED',
        currentBatch: 1,
        batchFixAttempts: 5,
        fullFixAttempts: 0,
        checkboxFixAttempts: 0,
        iteration: 0,
        activeTaskIds: ['R1'],
        exFile: fs.realpathSync(indexPath),
        fixTrigger: 'verify_fail',
        blockedReason: 'batch verify failed; fix budget exhausted',
        recoveryAttempts: 0,
      }, null, 2)}\n`,
    );

    const code = withScenario('block-recovery-success', () =>
      runOrchestrator({
        exFile: 'index.md',
        workdir: tmp,
        mockAgent: true,
      }),
    );

    assert.equal(code, 0);
    assert.equal(fs.existsSync(path.join(tmp, 'recovered.ok')), true);
    const state = JSON.parse(
      fs.readFileSync(path.join(workflow, 'STATE.json'), 'utf8'),
    );
    assert.equal(state.status, 'READY_FOR_MANUAL_QA');
  });

  it('heals a persisted recursive recovery resume target from v0.6.0', () => {
    const tmp = makeTemp('gbx-block-recursive-resume-');
    writeRecoveryIndex(tmp);
    const indexPath = path.join(tmp, 'index.md');
    fs.writeFileSync(
      indexPath,
      fs.readFileSync(indexPath, 'utf8').replace('| ⬜ | R1 |', '| ✅ | R1 |'),
    );
    const workflow = path.join(tmp, '.workflow-recovery');
    fs.mkdirSync(workflow, { recursive: true });
    fs.writeFileSync(
      path.join(workflow, 'STATE.json'),
      `${JSON.stringify({
        status: 'BLOCK_ANALYZE',
        currentBatch: 1,
        batchFixAttempts: 0,
        fullFixAttempts: 0,
        checkboxFixAttempts: 0,
        iteration: 0,
        activeTaskIds: ['R1'],
        exFile: fs.realpathSync(indexPath),
        fixTrigger: 'review_fail',
        recoveryOriginStatus: 'BLOCK_REPAIR',
        recoveryResumeState: 'BLOCK_REPAIR',
        recoveryOriginReason: 'quoted hard-stop',
        recoveryAttempts: 0,
      }, null, 2)}\n`,
    );

    const code = withScenario('block-recovery-success', () =>
      runOrchestrator({
        exFile: 'index.md',
        workdir: tmp,
        mockAgent: true,
      }),
    );

    assert.equal(code, 0);
    const state = JSON.parse(
      fs.readFileSync(path.join(workflow, 'STATE.json'), 'utf8'),
    );
    assert.equal(state.status, 'READY_FOR_MANUAL_QA');
    const log = fs.readFileSync(path.join(workflow, 'logs', 'loop.log'), 'utf8');
    assert.match(log, /repaired recursive recovery resume BLOCK_REPAIR → VERIFY_BATCH/);
  });

  it('stops with a human-review reason when analysis finds an unrelated module', () => {
    const tmp = makeTemp('gbx-block-human-');
    writeRecoveryIndex(tmp);

    const code = withScenario('block-recovery-out-of-scope', () =>
      runOrchestrator({
        exFile: 'index.md',
        workdir: tmp,
        mockAgent: true,
      }),
    );

    assert.equal(code, 3);
    const state = JSON.parse(
      fs.readFileSync(
        path.join(tmp, '.workflow-recovery', 'STATE.json'),
        'utf8',
      ),
    );
    assert.equal(state.status, 'BLOCKED');
    assert.match(state.blockedReason, /无法解决block/);
    assert.match(state.blockedReason, /无关模块/);
    assert.equal(fs.existsSync(path.join(tmp, 'recovered.ok')), false);
  });
});

describe('block recovery policy gate', () => {
  const baseReport = {
    schemaVersion: 1,
    analysisRunId: 'analysis-1',
    role: 'block-analyzer',
    kind: 'IN_SCOPE_VERIFY',
    recoverable: true,
    confidence: 'high',
    rootCause: 'hard structure error',
    requiredPaths: ['src/feature/**'],
    scopeEvidence: 'active task owns feature',
    touchesGbx: false,
    touchesExternalSystem: false,
    dependencyAction: 'none',
    recommendedAction: 'split directory',
  };

  it('enforces declared task scope', () => {
    const config = mergeConfig({
      frontmatter: {
        block_recovery: {
          task_scopes: {
            R1: {
              allowed_paths: ['src/feature/**'],
              related_paths: ['tests/feature/**'],
            },
          },
        },
      },
    });
    const allowed = evaluateBlockAnalysis({
      report: baseReport,
      analysisRunId: 'analysis-1',
      config,
      workdir: '/tmp/project',
      activeTaskIds: ['R1'],
      skillRoot: '/tmp/project/.cursor/skills/general-batch-exe',
    });
    assert.equal(allowed.ok, true);

    const denied = evaluateBlockAnalysis({
      report: { ...baseReport, requiredPaths: ['src/unrelated/file.ts'] },
      analysisRunId: 'analysis-1',
      config,
      workdir: '/tmp/project',
      activeTaskIds: ['R1'],
      skillRoot: '/tmp/project/.cursor/skills/general-batch-exe',
    });
    assert.equal(denied.ok, false);
    assert.match(denied.reason, /未声明的模块/);
  });

  it('always rejects gbx-self and project-external repairs', () => {
    const config = mergeConfig();
    const gbx = evaluateBlockAnalysis({
      report: {
        ...baseReport,
        requiredPaths: ['.cursor/skills/general-batch-exe/lib/fsm.js'],
      },
      analysisRunId: 'analysis-1',
      config,
      workdir: '/tmp/project',
      activeTaskIds: ['R1'],
      skillRoot: '/tmp/project/.cursor/skills/general-batch-exe',
    });
    assert.equal(gbx.ok, false);
    assert.match(gbx.reason, /禁止路径/);

    const external = evaluateBlockAnalysis({
      report: { ...baseReport, requiredPaths: ['../system.env'] },
      analysisRunId: 'analysis-1',
      config,
      workdir: '/tmp/project',
      activeTaskIds: ['R1'],
      skillRoot: '/tmp/project/.cursor/skills/general-batch-exe',
    });
    assert.equal(external.ok, false);
    assert.match(external.reason, /项目目录外/);
  });

  it('detects resolver changes outside approved paths', () => {
    const result = evaluateRepairChanges({
      changed: ['src/feature/a.ts', 'src/unrelated/b.ts'],
      approvedPaths: ['src/feature/**'],
      workflowDir: '.workflow',
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.outside, ['src/unrelated/b.ts']);
  });

  it('allows declared-only dependency recovery only with a project manifest path', () => {
    const config = mergeConfig();
    const missingManifest = evaluateBlockAnalysis({
      report: {
        ...baseReport,
        kind: 'PROJECT_DEPENDENCY_MISSING',
        dependencyAction: 'install_declared',
      },
      analysisRunId: 'analysis-1',
      config,
      workdir: '/tmp/project',
      activeTaskIds: ['R1'],
      skillRoot: '/tmp/project/.cursor/skills/general-batch-exe',
    });
    assert.equal(missingManifest.ok, false);
    assert.match(missingManifest.reason, /manifest\/lockfile/);

    const allowed = evaluateBlockAnalysis({
      report: {
        ...baseReport,
        kind: 'PROJECT_DEPENDENCY_MISSING',
        dependencyAction: 'install_declared',
        requiredPaths: ['package.json', 'package-lock.json'],
      },
      analysisRunId: 'analysis-1',
      config,
      workdir: '/tmp/project',
      activeTaskIds: ['R1'],
      skillRoot: '/tmp/project/.cursor/skills/general-batch-exe',
    });
    assert.equal(allowed.ok, true);
  });
});

describe('block recovery prompts', () => {
  const context = {
    exAbs: '/tmp/project/index.md',
    workdir: '/tmp/project',
    workflowDir: '.workflow',
    batchIds: ['R1'],
    batchNumber: 1,
    readFirstStatus: [],
    config: mergeConfig(),
  };

  it('keeps analyzer read-only and requires a fresh structured report', () => {
    const prompt = buildPrompt('block-analyzer', {
      ...context,
      analysisRunId: 'analysis-1',
      latestBlockAnalysisPath: '/tmp/project/.workflow/reports/latest-block-analysis.json',
      latestVerifyPath: '/tmp/project/.workflow/reports/latest-verify.json',
      recoveryOriginStatus: 'VERIFY_BATCH',
      recoveryOriginReason: 'verify failed',
    });
    assert.match(prompt, /analysis-1/);
    assert.match(prompt, /application source remains read-only/);
    assert.match(prompt, /requiredPaths must be complete/);
    assert.match(prompt, /GBX_INTERNAL_FAILURE/);
  });

  it('limits resolver to approved paths and project-local declared dependencies', () => {
    const prompt = buildPrompt('block-resolver', {
      ...context,
      repairRunId: 'repair-1',
      latestBlockRepairPath: '/tmp/project/.workflow/reports/latest-block-repair.json',
      recoveryRootCause: 'hard structure error',
      recoveryKind: 'IN_SCOPE_VERIFY',
      recoveryApprovedPaths: ['src/feature/**'],
      recoveryRecommendedAction: 'split directory',
    });
    assert.match(prompt, /Approved paths/);
    assert.match(prompt, /src\/feature/);
    assert.match(prompt, /Never modify \.cursor\/skills\/general-batch-exe/);
    assert.match(prompt, /declared-only/);
  });
});
