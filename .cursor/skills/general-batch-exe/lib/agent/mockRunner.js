'use strict';

/**
 * Module: agent/mockRunner
 * Purpose: Drive FSM without cursor-agent — mutate exFile checkmarks + write reviews.
 */

const fs = require('fs');
const path = require('path');
const { writeLatestReview } = require('../reviewDecision');
const { writeJson } = require('../blockRecovery');

function markTasksDoneInFile(exAbs, taskIds) {
  let raw = fs.readFileSync(exAbs, 'utf8');
  for (const id of taskIds) {
    const tableRe = new RegExp(
      `(\\|\\s*)⬜(\\s*\\|\\s*${escapeReg(id)}\\s*\\|)`,
      'g',
    );
    raw = raw.replace(tableRe, `$1✅$2`);
    const checkRe = new RegExp(
      `([-*]\\s+)\\[ \\](\\s+${escapeReg(id)}\\b)`,
      'g',
    );
    raw = raw.replace(checkRe, `$1[x]$2`);
  }
  fs.writeFileSync(exAbs, raw, 'utf8');
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mock controlled by GBX_MOCK_SCENARIO for deterministic FSM regression tests.
 */
function runMockAgent({ role, ctx, paths, state }) {
  const scenario = process.env.GBX_MOCK_SCENARIO || 'happy';

  if (role === 'block-analyzer') {
    const preflight = ctx.preflightIndexRecovery === true;
    const outOfScope = scenario === 'block-recovery-out-of-scope';
    const gbxPath = scenario === 'block-recovery-gbx-path';
    writeJson(paths.latestBlockAnalysis, {
      schemaVersion: 1,
      analysisRunId: ctx.analysisRunId,
      role: 'block-analyzer',
      kind: preflight
        ? 'INDEX_SCHEMA_CORRUPTION'
        : outOfScope
        ? 'OUT_OF_SCOPE_MODULE'
        : gbxPath
          ? 'IN_SCOPE_VERIFY'
          : 'IN_SCOPE_VERIFY',
      recoverable: !outOfScope,
      confidence: 'high',
      rootCause: preflight
        ? 'mock execution index contains an invalid machine field'
        : outOfScope
        ? 'mock repair requires unrelated module'
        : 'mock verify remains red after ordinary fixes',
      requiredPaths: preflight
        ? [path.relative(ctx.workdir, ctx.exAbs).split(path.sep).join('/')]
        : outOfScope
        ? ['unrelated/module.ts']
        : gbxPath
          ? ['.cursor/skills/general-batch-exe/lib/fsm.js']
          : ['recovered.ok'],
      scopeEvidence: outOfScope ? 'not part of active task' : 'mock active-task output',
      touchesGbx: false,
      touchesExternalSystem: false,
      dependencyAction: 'none',
      recommendedAction: 'create the expected recovery marker',
      humanReason: outOfScope ? 'requires unrelated module' : '',
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: '[mock] block analysis written',
      stderr: '',
      error: null,
    };
  }

  if (role === 'block-resolver') {
    if (ctx.preflightIndexRecovery === true) {
      const raw = fs.readFileSync(ctx.exAbs, 'utf8');
      fs.writeFileSync(
        ctx.exAbs,
        raw.replace('batch_size: invalid', 'batch_size: 1'),
        'utf8',
      );
    } else if (scenario !== 'block-recovery-needs-human') {
      fs.writeFileSync(path.join(ctx.workdir, 'recovered.ok'), 'recovered\n', 'utf8');
    }
    writeJson(paths.latestBlockRepair, {
      schemaVersion: 1,
      repairRunId: ctx.repairRunId,
      role: 'block-resolver',
      result:
        scenario === 'block-recovery-needs-human' ? 'needs_human' : 'repaired',
      summary: 'mock block resolver result',
      changedPaths: ctx.preflightIndexRecovery === true
        ? [path.relative(ctx.workdir, ctx.exAbs).split(path.sep).join('/')]
        : scenario === 'block-recovery-needs-human'
          ? []
          : ['recovered.ok'],
      dependencyAction: 'none',
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: '[mock] block repair completed',
      stderr: '',
      error: null,
    };
  }

  if (role === 'executor' || role === 'fixer' || role === 'final-fixer') {
    if (ctx.batchIds && ctx.batchIds.length) {
      markTasksDoneInFile(ctx.exAbs, ctx.batchIds);
    }
    return {
      ok: true,
      exitCode: 0,
      stdout: `[mock] ${role} marked tasks done: ${(ctx.batchIds || []).join(',')}`,
      stderr: '',
      error: null,
    };
  }

  if (role === 'batch-reviewer') {
    if (scenario === 'reviewer-no-report') {
      return {
        ok: true,
        exitCode: 0,
        stdout: '[mock] reviewer intentionally wrote no report',
        stderr: '',
        error: null,
      };
    }
    if (scenario === 'reviewer-fail') {
      return {
        ok: false,
        exitCode: 9,
        stdout: '',
        stderr: '[mock] reviewer failed',
        error: null,
      };
    }
    const failOnce =
      scenario === 'fail-then-pass' &&
      state.currentBatch === 1 &&
      state.batchFixAttempts === 0 &&
      !state.mockReviewFailedOnce;

    if (failOnce) {
      writeLatestReview(paths.latestReview, {
        schemaVersion: 1,
        reviewRunId: ctx.reviewRunId,
        role: 'batch-reviewer',
        batchId: String(state.currentBatch),
        result: 'fail',
        blocker: 0,
        critical: 1,
        major: 0,
        minor: 0,
        recommendedNextState: 'FIX_BATCH',
        summary: 'mock critical issue',
        issues: [
          {
            id: 'M-1',
            severity: 'critical',
            file: 'mock',
            location: 'n/a',
            description: 'mock failure for FSM test',
            expectedBehavior: 'pass after fix',
            suggestedVerification: 're-run',
          },
        ],
      });
      return {
        ok: true,
        exitCode: 0,
        stdout: '[mock] review fail',
        stderr: '',
        error: null,
        persist: { mockReviewFailedOnce: true },
      };
    }

    writeLatestReview(paths.latestReview, {
      schemaVersion: 1,
      reviewRunId: ctx.reviewRunId,
      role: 'batch-reviewer',
      batchId: String(state.currentBatch),
      result: 'pass',
      blocker: 0,
      critical: 0,
      major: 0,
      minor: 0,
      recommendedNextState: 'VERIFY_BATCH',
      summary: 'mock batch review pass',
      issues: [],
    });
    return { ok: true, exitCode: 0, stdout: '[mock] review pass', stderr: '', error: null };
  }

  if (role === 'final-reviewer') {
    if (scenario === 'final-fail-then-verify' && state.fullFixAttempts === 0) {
      writeLatestReview(paths.latestReview, {
        schemaVersion: 1,
        reviewRunId: ctx.reviewRunId,
        role: 'final-reviewer',
        batchId: 'final',
        result: 'fail',
        blocker: 0,
        critical: 1,
        major: 0,
        minor: 0,
        recommendedNextState: 'FULL_FIX',
        summary: 'mock final issue',
        issues: [
          {
            id: 'FM-1',
            severity: 'critical',
            file: 'mock',
            location: 'n/a',
            description: 'exercise full verify after final fixer',
            expectedBehavior: 'all commands run',
            suggestedVerification: 'inspect full report',
          },
        ],
      });
      return { ok: true, exitCode: 0, stdout: '[mock] final review fail', stderr: '', error: null };
    }
    writeLatestReview(paths.latestReview, {
      schemaVersion: 1,
      reviewRunId: ctx.reviewRunId,
      role: 'final-reviewer',
      batchId: 'final',
      result: 'pass',
      blocker: 0,
      critical: 0,
      major: 0,
      minor: 0,
      recommendedNextState: 'READY_FOR_MANUAL_QA',
      summary: 'mock final review pass',
      issues: [],
    });
    return { ok: true, exitCode: 0, stdout: '[mock] final review pass', stderr: '', error: null };
  }

  return {
    ok: false,
    exitCode: 1,
    stdout: '',
    stderr: `[mock] unknown role ${role}`,
    error: null,
  };
}

module.exports = { runMockAgent, markTasksDoneInFile };
