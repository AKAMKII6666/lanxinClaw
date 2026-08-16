'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { splitFrontmatter, loadExFile } = require('../lib/loadExFile');
const { parseTableTasks } = require('../lib/adapters/table');
const { parseCheckboxTasks } = require('../lib/adapters/checkbox');
const { selectBatch, assertBatchChecked } = require('../lib/tasks');
const { decideAfterReview, decideAfterVerify } = require('../lib/reviewDecision');
const { STATUSES } = require('../lib/fsm');
const { runVerifyCommands } = require('../lib/verify');
const { checkHardStop } = require('../lib/hardStop');
const { runOrchestrator } = require('../lib/orchestrator');

const SKILL_ROOT = path.resolve(__dirname, '..');

describe('splitFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const { frontmatter, body } = splitFrontmatter('---\nbatch_size: 2\n---\n\n# Hi\n');
    assert.equal(frontmatter.batch_size, 2);
    assert.match(body, /# Hi/);
  });

  it('rejects missing frontmatter', () => {
    assert.throws(() => splitFrontmatter('# no yaml\n'), /must start with YAML/);
  });
});

describe('table adapter', () => {
  it('parses status table', () => {
    const body = `
| 状态 | ID | 任务 | verify |
|------|-----|------|--------|
| ⬜ | M1-1 | do a | npm run typecheck |
| ✅ | M1-0 | done | — |
`;
    const tasks = parseTableTasks(body);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, 'M1-1');
    assert.equal(tasks[0].status, 'todo');
    assert.equal(tasks[1].status, 'done');
  });
});

describe('checkbox adapter', () => {
  it('parses checkboxes', () => {
    const tasks = parseCheckboxTasks('- [ ] A1 foo\n- [x] A0 bar\n');
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, 'A1');
    assert.equal(tasks[1].status, 'done');
  });
});

describe('selectBatch', () => {
  it('respects batch_size', () => {
    const tasks = [
      { id: 'M1-1', status: 'todo' },
      { id: 'M1-2', status: 'todo' },
      { id: 'M1-3', status: 'todo' },
    ];
    assert.deepEqual(
      selectBatch(tasks, { batchSize: 2 }).map((t) => t.id),
      ['M1-1', 'M1-2'],
    );
  });

  it('assertBatchChecked', () => {
    const r = assertBatchChecked(
      [
        { id: 'A', status: 'done' },
        { id: 'B', status: 'todo' },
      ],
      ['A', 'B'],
    );
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ['B']);
  });
});

describe('reviewDecision', () => {
  it('batch pass → VERIFY_BATCH', () => {
    const d = decideAfterReview(
      { result: 'pass', blocker: 0, critical: 0 },
      { phase: 'batch', batchFixAttempts: 0, maxFixAttempts: 2 },
    );
    assert.equal(d.next, STATUSES.VERIFY_BATCH);
  });

  it('batch fail → FIX_BATCH', () => {
    const d = decideAfterReview(
      { result: 'fail', blocker: 0, critical: 1 },
      { phase: 'batch', batchFixAttempts: 0, maxFixAttempts: 2 },
    );
    assert.equal(d.next, STATUSES.FIX_BATCH);
  });

  it('batch fail over budget → BLOCKED', () => {
    const d = decideAfterReview(
      { result: 'fail', blocker: 0, critical: 1 },
      { phase: 'batch', batchFixAttempts: 2, maxFixAttempts: 2 },
    );
    assert.equal(d.next, STATUSES.BLOCKED);
  });

  it('verify pass with todos → EXECUTE_BATCH', () => {
    const d = decideAfterVerify({
      verifyOk: true,
      checksOk: true,
      phase: 'batch',
      hasRemainingTodos: true,
      batchFixAttempts: 0,
      fullFixAttempts: 0,
      maxFixAttempts: 2,
      maxFullFixAttempts: 2,
    });
    assert.equal(d.next, STATUSES.EXECUTE_BATCH);
  });

  it('verify ok but unchecked → FIX_BATCH checkbox_missing (does not use hard budget)', () => {
    const d = decideAfterVerify({
      verifyOk: true,
      checksOk: false,
      phase: 'batch',
      hasRemainingTodos: true,
      batchFixAttempts: 5,
      fullFixAttempts: 0,
      maxFixAttempts: 5,
      maxFullFixAttempts: 2,
      checkboxFixAttempts: 0,
      maxCheckboxFixAttempts: 2,
      missingTaskIds: ['V2-R1-4', 'V2-R2-1'],
    });
    assert.equal(d.next, STATUSES.FIX_BATCH);
    assert.match(d.reason, /checkbox_missing/);
    assert.match(d.reason, /V2-R1-4/);
  });

  it('checkbox gap over budget → BLOCKED with checkbox_missing reason', () => {
    const d = decideAfterVerify({
      verifyOk: true,
      checksOk: false,
      phase: 'batch',
      hasRemainingTodos: true,
      batchFixAttempts: 0,
      fullFixAttempts: 0,
      maxFixAttempts: 5,
      maxFullFixAttempts: 2,
      checkboxFixAttempts: 2,
      maxCheckboxFixAttempts: 2,
      missingTaskIds: ['A'],
    });
    assert.equal(d.next, STATUSES.BLOCKED);
    assert.match(d.reason, /checkbox_missing/);
    assert.doesNotMatch(d.reason, /batch verify failed/);
  });

  it('hard verify fail still uses batchFixAttempts', () => {
    const d = decideAfterVerify({
      verifyOk: false,
      checksOk: false,
      phase: 'batch',
      hasRemainingTodos: true,
      batchFixAttempts: 5,
      fullFixAttempts: 0,
      maxFixAttempts: 5,
      maxFullFixAttempts: 2,
      checkboxFixAttempts: 0,
      maxCheckboxFixAttempts: 2,
    });
    assert.equal(d.next, STATUSES.BLOCKED);
    assert.match(d.reason, /batch verify failed/);
  });

  it('full review pass → READY', () => {
    const d = decideAfterReview(
      { result: 'pass', blocker: 0, critical: 0 },
      { phase: 'full', fullFixAttempts: 0, maxFullFixAttempts: 2 },
    );
    assert.equal(d.next, STATUSES.READY_FOR_MANUAL_QA);
  });
});

describe('verify + hardStop', () => {
  it('runs node exit 0 command', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-v-'));
    const r = runVerifyCommands(['node -e "process.exit(0)"'], tmp, null, 't');
    assert.equal(r.ok, true);
  });

  it('detects hard stop', () => {
    const r = checkHardStop('hello GBX_FORCE_HARD_STOP_TOKEN world', [
      'GBX_FORCE_HARD_STOP_TOKEN',
    ]);
    assert.equal(r.hit, true);
  });

  it('keeps pattern source when earlier regex is invalid', () => {
    const r = checkHardStop('HIT_TOKEN_HERE', ['[invalid', 'HIT_TOKEN']);
    assert.equal(r.hit, true);
    assert.equal(r.pattern, 'HIT_TOKEN');
  });

  it('skips negated out-of-scope mentions (Realtime / 电话壳)', () => {
    const doc =
      '新增非本仓分母节（壳／Realtime／向量／LLM vignette 抽取／体验签字）';
    const r = checkHardStop(doc, ['电话壳|Realtime|对标迁移旧话机']);
    assert.equal(r.hit, false, 'should not block documenting out-of-scope');
    assert.ok(r.skippedNegations >= 1);

    const intent = '下一步我们要实现 Realtime 语音链路';
    const r2 = checkHardStop(intent, ['实现电话壳|接入 Realtime|Realtime']);
    assert.equal(r2.hit, true);
  });

  it('does not hard-stop on cursor-agent apiKeySource init metadata', () => {
    const init =
      '{"type":"system","subtype":"init","apiKeySource":"login","cwd":"F:\\\\workspace\\\\lanxinClaw"}';
    const r = checkHardStop(init, [
      'API[ _-]?key|私钥|token|secret|凭据明文',
    ]);
    assert.equal(r.hit, false, 'apiKeySource must not match API key pattern');

    const leak = 'do not paste API key sk-live-example into the repo';
    const r2 = checkHardStop(leak, ['API[ _-]?key|私钥|凭据明文']);
    assert.equal(r2.hit, true, 'real API key mention still blocks');
  });
});

describe('collectVerifyCommands merge', () => {
  it('merges task verify with defaults', () => {
    const { collectVerifyCommands } = require('../lib/tasks');
    const cmds = collectVerifyCommands(
      [{ verify: 'npm run test -- foo' }, { verify: null }],
      ['npm run typecheck', 'npm run test -- foo'],
    );
    assert.deepEqual(cmds, ['npm run test -- foo', 'npm run typecheck']);
  });
});

describe('loadExFile examples', () => {
  it('loads mock-happy-index', () => {
    const loaded = loadExFile({
      exFile: path.join(SKILL_ROOT, 'examples/mock-happy-index.md'),
      workdir: SKILL_ROOT,
      cli: {},
    });
    assert.equal(loaded.tasks.length, 3);
    assert.equal(loaded.config.batch_size, 2);
  });
});

describe('orchestrator mock happy path', () => {
  it('reaches READY_FOR_MANUAL_QA', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-run-'));
    fs.writeFileSync(path.join(tmp, 'README.md'), '# tmp\n');
    const src = fs.readFileSync(path.join(SKILL_ROOT, 'examples/mock-happy-index.md'), 'utf8');
    const ex = path.join(tmp, 'index.md');
    fs.writeFileSync(ex, src);

    const code = runOrchestrator({
      exFile: ex,
      workdir: tmp,
      mockAgent: true,
      dryRun: false,
    });
    assert.equal(code, 0);
    const state = JSON.parse(
      fs.readFileSync(path.join(tmp, '.ai-workflow-mock', 'STATE.json'), 'utf8'),
    );
    assert.equal(state.status, 'READY_FOR_MANUAL_QA');
  });
});
