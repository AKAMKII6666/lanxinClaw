'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createTheme,
  printRoleBanner,
  formatAgentActivity,
  formatAgentHeartbeat,
  blockRecoveryAnalyzeStart,
} = require('../lib/consoleTheme');
const { processLine, formatToolCallStarted } = require('../lib/agent/cursorStream');

describe('consoleTheme', () => {
  it('createTheme respects NO_COLOR', () => {
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const theme = createTheme({ color: true, forceColor: false });
    assert.equal(theme.color, false);
    const line = formatAgentActivity(theme, 'executor', '读取 foo.ts');
    assert.doesNotMatch(line, /\x1b\[/);
    if (prev == null) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  });

  it('formatAgentActivity includes activity text', () => {
    const theme = createTheme({ color: false });
    const line = formatAgentActivity(theme, 'block-resolver', '编辑 apps/studioV2/a.ts');
    assert.match(line, /编辑 apps\/studioV2\/a\.ts/);
    assert.match(line, /\[gbx\] ·/);
  });

  it('formatAgentHeartbeat includes last activity when provided', () => {
    const theme = createTheme({ color: false });
    const line = formatAgentHeartbeat(theme, 'fixer', 'fixer:V2-T1', 90, '运行 npm test');
    assert.match(line, /90s/);
    assert.match(line, /最近: 运行 npm test/);
  });

  it('blockRecoveryAnalyzeStart renders analyze banner lines', () => {
    const theme = createTheme({ color: false });
    const lines = blockRecoveryAnalyzeStart(theme, {
      reason: 'STUDIO-STRUCT-008',
      attempt: 0,
      maxAttempts: 2,
    });
    assert.equal(lines.length, 3);
    assert.match(lines[0], /启动自动分析/);
    assert.match(lines[1], /STUDIO-STRUCT-008/);
  });

  it('blockRecoveryAnalyzeStart formats diagnostic objects without object coercion', () => {
    const theme = createTheme({ color: false });
    const lines = blockRecoveryAnalyzeStart(theme, {
      fingerprint: {
        code: 'STUDIO-STRUCT-008',
        path: 'apps/studioV2/src/example.ts',
        message: 'directory must be split',
      },
      attempt: 0,
      maxAttempts: 2,
    });
    assert.match(lines[1], /STUDIO-STRUCT-008/);
    assert.doesNotMatch(lines[1], /\[object Object\]/);
  });

  it('printRoleBanner writes EXECUTOR header to stream', () => {
    const theme = createTheme({ color: false });
    const chunks = [];
    const fake = { write: (s) => chunks.push(s) };
    const orig = process.stderr.write;
    process.stderr.write = fake.write.bind(fake);
    try {
      printRoleBanner(theme, 'executor', { batchIds: ['V2-T3-5'], fixTrigger: 'verify_fail' });
    } finally {
      process.stderr.write = orig;
    }
    const text = chunks.join('');
    assert.match(text, /EXECUTOR/);
    assert.match(text, /V2-T3-5/);
    assert.match(text, /verify_fail/);
  });
});

describe('cursorStream', () => {
  it('processLine maps readToolCall started to 读取 path', () => {
    const line = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      call_id: 'c1',
      tool_call: { readToolCall: { args: { path: 'apps/studioV2/foo.ts' } } },
    });
    const events = processLine(line, { workdir: '/repo' });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'activity');
    assert.match(events[0].text, /读取/);
    assert.match(events[0].text, /foo\.ts/);
  });

  it('processLine maps result event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'done',
    });
    const events = processLine(line, {});
    assert.equal(events[0].type, 'result');
    assert.equal(events[0].text, 'done');
  });

  it('formatToolCallStarted handles shellToolCall', () => {
    const text = formatToolCallStarted(
      {
        tool_call: { shellToolCall: { args: { command: 'npm run quality:studio' } } },
      },
      '/repo',
    );
    assert.match(text, /运行 npm run quality:studio/);
  });
});
