'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkHardStop } = require('../lib/hardStop');
const {
  archiveLatestReview,
  resolveClearBlockedNext,
} = require('../lib/clearBlocked');
const { parseArgs } = require('../lib/parseArgs');
const { STATUSES } = require('../lib/fsm');

describe('hardStop negation (reviewer wording)', () => {
  it('skips 「未见 Host 写口」', () => {
    const notes =
      'FormSchemaRenderer 按 kind 映射。未见 Host 写口、debugger 改动、eslint-disable。';
    const r = checkHardStop(notes, [
      '接入 Host|Host 写口|真实保存|写盘闭环|PUT /api',
    ]);
    assert.equal(r.hit, false);
    assert.ok(r.skippedNegations >= 1);
  });

  it('skips 「无 Host 写口」', () => {
    const notes = '实现面基本对齐；无 Host 写口、无 debugger 改动。';
    const r = checkHardStop(notes, ['接入 Host|Host 写口|真实保存']);
    assert.equal(r.hit, false);
    assert.ok(r.skippedNegations >= 1);
  });

  it('still blocks intentional Host wiring', () => {
    const text = '下一步接入 Host 写口并 PUT /api/stories';
    const r = checkHardStop(text, ['接入 Host|真实保存|写盘闭环|PUT /api']);
    assert.equal(r.hit, true);
  });

  it('skips musicPhone reviewer 「无 CallSessionManager」', () => {
    const notes =
      'phone/musicPhone/ 无 Call Chain 越界（无 CallSessionManager / client.connect / LineStateMachine）';
    const r = checkHardStop(notes, ['CallSessionManager|client\\.connect']);
    assert.equal(r.hit, false);
    assert.ok(r.skippedNegations >= 1);
  });
});

describe('clearBlocked resume', () => {
  it('--after-manual requires --clear-blocked', () => {
    assert.throws(
      () => parseArgs(['--after-manual']),
      /--after-manual requires --clear-blocked/,
    );
  });

  it('parses --after-manual with --clear-blocked', () => {
    const a = parseArgs(['--clear-blocked', '--after-manual']);
    assert.equal(a.clearBlocked, true);
    assert.equal(a.afterManual, true);
  });

  it('parses --no-heartbeat', () => {
    assert.equal(parseArgs(['--no-heartbeat']).noHeartbeat, true);
  });

  it('FULL_REVIEW when no todos', () => {
    const r = resolveClearBlockedNext({
      tasks: [{ id: 'A1', status: 'done' }],
      activeTaskIds: ['A1'],
      afterManual: true,
    });
    assert.equal(r.next, STATUSES.FULL_REVIEW);
  });

  it('--after-manual + all active done → VERIFY_BATCH', () => {
    const r = resolveClearBlockedNext({
      tasks: [
        { id: 'S1', status: 'done' },
        { id: 'S2', status: 'done' },
        { id: 'S3', status: 'todo' },
      ],
      activeTaskIds: ['S1', 'S2'],
      fixTrigger: 'review_fail',
      afterManual: true,
    });
    assert.equal(r.next, STATUSES.VERIFY_BATCH);
    assert.deepEqual(r.activeTaskIds, ['S1', 'S2']);
  });

  it('--after-manual + still todo → FIX_BATCH', () => {
    const r = resolveClearBlockedNext({
      tasks: [
        { id: 'S1', status: 'todo' },
        { id: 'S2', status: 'todo' },
      ],
      activeTaskIds: ['S1', 'S2'],
      fixTrigger: 'review_fail',
      afterManual: true,
    });
    assert.equal(r.next, STATUSES.FIX_BATCH);
    assert.deepEqual(r.activeTaskIds, ['S1', 'S2']);
  });

  it('default unlock → EXECUTE_BATCH', () => {
    const r = resolveClearBlockedNext({
      tasks: [{ id: 'S1', status: 'todo' }],
      activeTaskIds: ['S1'],
      afterManual: false,
    });
    assert.equal(r.next, STATUSES.EXECUTE_BATCH);
    assert.deepEqual(r.activeTaskIds, []);
  });

  it('archives latest.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-archive-'));
    const reviews = path.join(tmp, 'reviews');
    fs.mkdirSync(reviews);
    const latest = path.join(reviews, 'latest.json');
    fs.writeFileSync(latest, '{"result":"fail"}\n');
    const dest = archiveLatestReview(latest, reviews);
    assert.ok(dest);
    assert.equal(fs.existsSync(latest), false);
    assert.equal(fs.existsSync(dest), true);
  });
});
