'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractErrorLocations } = require('../lib/verifyLocations');
const {
  buildVerifyReport,
  verifyFingerprint,
  writeVerifyReports,
  formatBlockedVerifyReport,
  buildVerifyExcerptForPrompt,
} = require('../lib/verifyReport');
const { runVerifyCommands } = require('../lib/verify');
const { buildPrompt } = require('../lib/prompts');
const { workflowPaths, ensureWorkflowDirs } = require('../lib/stateStore');

describe('verifyLocations', () => {
  it('parses TypeScript TS1351 diagnostics', () => {
    const text = `
app/(studio)/world/page.tsx(213,36): error TS1351: An identifier or keyword cannot immediately follow a numeric literal.
app/(studio)/world/page.tsx(323,38): error TS1351: An identifier or keyword cannot immediately follow a numeric literal.
`;
    const locs = extractErrorLocations(text);
    assert.equal(locs.length, 2);
    assert.equal(locs[0].file, 'app/(studio)/world/page.tsx');
    assert.equal(locs[0].line, 213);
    assert.equal(locs[0].column, 36);
    assert.equal(locs[0].code, 'TS1351');
  });

  it('parses STUDIO-STRUCT hard error and prefers it over WARN', () => {
    const text = `
WARN STUDIO-STRUCT-002  apps/studioV2/src/pageComponents/storyEditor/StoryEditorShell.tsx:36:60  函数 StoryEditorShell 有效行数 95 超过告警线 60  考虑拆分以保持可测性
STUDIO-STRUCT-008  apps/studioV2/src/pageComponents/storyEditor/com:1:1  目录含 5 个源文件且职责组≥2（character,dock,panel），应分子目录  按 domain/commands/features 等职责拆分子目录，禁止长前缀代目录
check:studio-structure failed (1 errors, 16 warnings, 148 files)
quality:studio FAILED
`;
    const locs = extractErrorLocations(text);
    assert.ok(locs.length >= 2);
    assert.equal(locs[0].code, 'STUDIO-STRUCT-008');
    assert.equal(locs[0].severity, 'error');
    assert.equal(locs[0].file, 'apps/studioV2/src/pageComponents/storyEditor/com');
    assert.equal(locs[0].line, 1);
    assert.match(locs[0].message, /职责组/);
    const warn = locs.find((l) => l.code === 'STUDIO-STRUCT-002');
    assert.ok(warn);
    assert.equal(warn.severity, 'warn');
  });

  it('parses ENGINE-STRUCT 告警线 as warn and 硬上限 as error', () => {
    const text = `
ENGINE-STRUCT-002  packages/rpg-engine/src/host/createScheduleClockApi.ts:18:1  当前=95  允许=60  函数 createScheduleClockApi 有效行数 95 超过告警线 60  考虑拆分以保持可测性
ENGINE-STRUCT-007  packages/rpg-engine/src/validation/validatePackage.ts:1:1  当前=802  允许=800  历史基线 effectiveLines 净增长：当前 802 > 基线 800  触碰遗留超限文件时指标只能持平或下降
ENGINE-STRUCT-002  packages/rpg-engine/src/host/wet.ts:196:1  当前=120  允许=100  函数 buildWetReplayView 有效行数 120 超过硬上限 100  拆出步骤函数或领域服务
`;
    const locs = extractErrorLocations(text);
    assert.ok(locs.length >= 3);
    assert.equal(locs[0].severity, 'error');
    assert.ok(
      locs[0].code === 'ENGINE-STRUCT-007' || locs[0].code === 'ENGINE-STRUCT-002',
    );
    const warn = locs.find(
      (l) =>
        l.code === 'ENGINE-STRUCT-002' &&
        l.file.includes('createScheduleClockApi'),
    );
    assert.ok(warn);
    assert.equal(warn.severity, 'warn');
    const hardFn = locs.find(
      (l) => l.code === 'ENGINE-STRUCT-002' && l.file.includes('wet.ts'),
    );
    assert.ok(hardFn);
    assert.equal(hardFn.severity, 'error');
  });

  it('BLOCKED checkbox_missing message prefers unchecked ids over WARN list', () => {
    const text = formatBlockedVerifyReport({
      blockedReason: 'checkbox_missing; fix budget exhausted; missing=V2-R1-4,V2-R2-1',
      state: {
        activeTaskIds: ['V2-R1-4', 'V2-R2-1'],
        fixTrigger: 'checkbox_missing',
      },
      report: {
        ok: true,
        failedCommand: null,
        exitCode: 0,
        errorLocations: [
          {
            file: 'apps/studioV2/src/x.tsx',
            line: 1,
            column: 1,
            code: 'STUDIO-STRUCT-002',
            message: '超过告警线 60',
            severity: 'warn',
          },
        ],
        results: [],
      },
      latestVerifyPath: '/tmp/latest-verify.json',
      latestReviewPath: '/tmp/latest.json',
    });
    assert.match(text, /kind: checkbox_missing/);
    assert.match(text, /V2-R1-4/);
    assert.doesNotMatch(text, /errorLocations \(hard only\)/);
    assert.match(text, /--clear-blocked --after-manual/);
  });
});

describe('verifyReport + latest-verify', () => {
  it('writes latest-verify.json on failure and fingerprints stably', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-vr-'));
    const paths = workflowPaths(tmp, '.ai-workflow');
    ensureWorkflowDirs(paths);

    const report = buildVerifyReport({
      label: 'batch-1',
      ok: false,
      phase: 'batch',
      activeTaskIds: ['E2'],
      results: [
        {
          command: 'npm run typecheck',
          exitCode: 1,
          stdout: 'app/x.ts(10,1): error TS1351: bad\n',
          stderr: '',
        },
      ],
    });
    assert.equal(report.errorLocations.length, 1);
    const written = writeVerifyReports(paths, report);
    assert.ok(fs.existsSync(written.latestFile));
    const loaded = JSON.parse(fs.readFileSync(paths.latestVerify, 'utf8'));
    assert.equal(loaded.ok, false);
    assert.equal(loaded.failedCommand, 'npm run typecheck');

    const fp1 = verifyFingerprint(report);
    const fp2 = verifyFingerprint(buildVerifyReport({
      label: 'batch-1',
      ok: false,
      results: [
        {
          command: 'npm run typecheck',
          exitCode: 1,
          stdout: 'app/x.ts(10,1): error TS1351: bad\n',
          stderr: '',
        },
      ],
    }));
    assert.equal(fp1, fp2);
  });

  it('formatBlockedVerifyReport includes locations', () => {
    const report = buildVerifyReport({
      label: 't',
      ok: false,
      results: [
        {
          command: 'npm run typecheck',
          exitCode: 1,
          stdout: 'foo.ts(1,2): error TS1351: nope\n',
          stderr: '',
        },
      ],
    });
    const text = formatBlockedVerifyReport({
      blockedReason: 'batch verify failed',
      state: { activeTaskIds: ['E2'] },
      report,
      latestVerifyPath: '/tmp/latest-verify.json',
      latestReviewPath: '/tmp/latest.json',
    });
    assert.match(text, /BLOCKED/);
    assert.match(text, /foo\.ts:1:2/);
    assert.match(text, /npm run typecheck/);
  });

  it('runVerifyCommands persists latest-verify for failing cmd', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-vv-'));
    const paths = workflowPaths(tmp, '.wf');
    ensureWorkflowDirs(paths);
    const v = runVerifyCommands(
      ['node -e "process.exit(2)"'],
      tmp,
      paths,
      'unit-fail',
      { quiet: true, phase: 'batch', activeTaskIds: ['T1'] },
    );
    assert.equal(v.ok, false);
    assert.ok(v.report);
    assert.ok(fs.existsSync(paths.latestVerify));
    assert.ok(v.fingerprint);
  });
});

describe('fixer prompt verify contract', () => {
  it('requires latest-verify and forbids empty exit on review pass', () => {
    const prompt = buildPrompt('fixer', {
      exAbs: '/tmp/idx.md',
      workdir: '/tmp/proj',
      workflowDir: '.ai-workflow',
      batchIds: ['E2'],
      batchNumber: 1,
      config: { fixer_extra: '' },
      readFirstStatus: [],
      fixTrigger: 'verify_fail',
      latestVerifyPath: '/tmp/proj/.ai-workflow/reports/latest-verify.json',
      verifyExcerpt: 'ok=false\nerrorLocations:\n- world/page.tsx:213:36 TS1351',
    });
    assert.match(prompt, /verify_fail/);
    assert.match(prompt, /latest-verify\.json/);
    assert.match(prompt, /FORBIDDEN/);
    assert.match(prompt, /world\/page\.tsx:213/);
    assert.match(prompt, /review\.result=pass/);
    assert.match(prompt, /STUDIO-STRUCT-008/);
    assert.match(prompt, /未自验/);
  });

  it('executor prompt requires same-turn ✅ after green verify', () => {
    const prompt = buildPrompt('executor', {
      exAbs: '/tmp/idx.md',
      workdir: '/tmp/proj',
      workflowDir: '.ai-workflow',
      batchIds: ['V2-R2-1'],
      batchNumber: 2,
      config: { executor_extra: '' },
      readFirstStatus: [],
    });
    assert.match(prompt, /HARD: When every batch verify command exits 0/);
    assert.match(prompt, /index still ⬜/);
  });

  it('fixer prompt checkbox_missing forbids chasing WARN', () => {
    const prompt = buildPrompt('fixer', {
      exAbs: '/tmp/idx.md',
      workdir: '/tmp/proj',
      workflowDir: '.ai-workflow',
      batchIds: ['V2-R2-1'],
      batchNumber: 2,
      config: { fixer_extra: '' },
      readFirstStatus: [],
      fixTrigger: 'checkbox_missing',
      latestVerifyPath: '/tmp/proj/.ai-workflow/reports/latest-verify.json',
      verifyExcerpt: 'ok=true',
    });
    assert.match(prompt, /checkbox_missing/);
    assert.match(prompt, /ONLY mark the active task IDs/);
    assert.match(prompt, /WARN/);
  });

  it('buildVerifyExcerptForPrompt surfaces STUDIO-STRUCT locations and studioQualityTail', () => {
    const report = buildVerifyReport({
      label: 't',
      ok: false,
      results: [
        {
          command: 'npm run quality:studio',
          exitCode: 1,
          stdout: `
STUDIO-STRUCT-008  apps/studioV2/src/pageComponents/storyEditor/com:1:1  目录含 5 个源文件且职责组≥2（character,dock,panel），应分子目录  按职责拆分
check:studio-structure failed (1 errors)
quality:studio FAILED
`,
          stderr: '',
        },
      ],
    });
    assert.ok(report.errorLocations.some((l) => l.code === 'STUDIO-STRUCT-008'));
    const excerpt = buildVerifyExcerptForPrompt(report);
    assert.match(excerpt, /STUDIO-STRUCT-008/);
    assert.match(excerpt, /storyEditor\/com/);
    assert.match(excerpt, /studioQualityTail/);
  });
});
