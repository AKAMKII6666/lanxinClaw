'use strict';

/**
 * Module: reviewDecision
 * Purpose: Scheme B — agent writes latest.json; script decides next STATE.
 */

const fs = require('fs');
const { STATUSES } = require('./fsm');

function readLatestReview(latestPath) {
  if (!fs.existsSync(latestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeLatestReview(latestPath, report) {
  fs.mkdirSync(require('path').dirname(latestPath), { recursive: true });
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

/**
 * Decide next status after BATCH_REVIEW.
 * @param {object} report
 * @param {object} ctx
 * @param {number} ctx.batchFixAttempts
 * @param {number} ctx.maxFixAttempts
 * @param {boolean} ctx.hasRemainingTodos — if review pass, whether more work
 * @param {'batch'|'full'} ctx.phase
 */
function decideAfterReview(report, ctx) {
  const phase = ctx.phase || 'batch';
  const fixStatus = phase === 'full' ? STATUSES.FULL_FIX : STATUSES.FIX_BATCH;
  const passNext =
    phase === 'full'
      ? STATUSES.READY_FOR_MANUAL_QA
      : ctx.hasRemainingTodos
        ? STATUSES.EXECUTE_BATCH
        : STATUSES.FULL_REVIEW;

  if (!report) {
    return {
      next: STATUSES.BLOCKED,
      reason: 'reviews/latest.json missing or invalid after review',
    };
  }

  const blocker = Number(report.blocker || 0);
  const critical = Number(report.critical || 0);
  const result = report.result;

  if (result === 'blocked') {
    return { next: STATUSES.BLOCKED, reason: report.summary || 'reviewer result=blocked' };
  }

  if (result === 'pass' && blocker === 0 && critical === 0) {
    // After batch review pass we still need VERIFY before advancing —
    // orchestrator uses decideAfterReview only when review is the gate.
    // For BATCH_REVIEW: pass → VERIFY_BATCH (verify scripts), not skip to next batch.
    if (phase === 'batch') {
      return { next: STATUSES.VERIFY_BATCH, reason: 'batch review pass' };
    }
    return { next: passNext, reason: 'full review pass' };
  }

  const attempts = phase === 'full' ? ctx.fullFixAttempts : ctx.batchFixAttempts;
  const max = phase === 'full' ? ctx.maxFullFixAttempts : ctx.maxFixAttempts;
  if (attempts >= max) {
    return {
      next: STATUSES.BLOCKED,
      reason: `fix attempts exceeded (${attempts}/${max})`,
    };
  }

  return { next: fixStatus, reason: `review fail blocker=${blocker} critical=${critical}` };
}

/**
 * After VERIFY_BATCH / FULL_VERIFY script-only gate.
 * Scripts red (!verifyOk) and checkbox gaps (!checksOk) use separate budgets.
 */
function decideAfterVerify({
  verifyOk,
  checksOk,
  phase,
  hasRemainingTodos,
  batchFixAttempts,
  fullFixAttempts,
  maxFixAttempts,
  maxFullFixAttempts,
  checkboxFixAttempts = 0,
  maxCheckboxFixAttempts = 2,
  missingTaskIds = [],
}) {
  const missingLabel =
    Array.isArray(missingTaskIds) && missingTaskIds.length
      ? missingTaskIds.join(',')
      : '(unknown)';

  // Hard verify failure (commands exit ≠ 0)
  if (!verifyOk) {
    if (phase === 'full') {
      if (fullFixAttempts >= maxFullFixAttempts) {
        return { next: STATUSES.BLOCKED, reason: 'full verify failed; fix budget exhausted' };
      }
      return { next: STATUSES.FULL_FIX, reason: 'full verify failed' };
    }
    if (batchFixAttempts >= maxFixAttempts) {
      return { next: STATUSES.BLOCKED, reason: 'batch verify failed; fix budget exhausted' };
    }
    return { next: STATUSES.FIX_BATCH, reason: 'batch verify failed' };
  }

  // Scripts green but active tasks still ⬜ — do not burn hard-fix budget
  if (!checksOk) {
    if (phase === 'full') {
      if (checkboxFixAttempts >= maxCheckboxFixAttempts) {
        return {
          next: STATUSES.BLOCKED,
          reason: `checkbox_missing; fix budget exhausted; missing=${missingLabel}`,
        };
      }
      return {
        next: STATUSES.FULL_FIX,
        reason: `checkbox_missing; tasks not checked: ${missingLabel}`,
      };
    }
    if (checkboxFixAttempts >= maxCheckboxFixAttempts) {
      return {
        next: STATUSES.BLOCKED,
        reason: `checkbox_missing; fix budget exhausted; missing=${missingLabel}`,
      };
    }
    return {
      next: STATUSES.FIX_BATCH,
      reason: `checkbox_missing; tasks not checked: ${missingLabel}`,
    };
  }

  if (phase === 'full') {
    return { next: STATUSES.READY_FOR_MANUAL_QA, reason: 'full verify pass' };
  }

  if (hasRemainingTodos) {
    return { next: STATUSES.EXECUTE_BATCH, reason: 'batch verify pass; more todos' };
  }
  return { next: STATUSES.FULL_REVIEW, reason: 'batch verify pass; no todos left' };
}

module.exports = {
  readLatestReview,
  writeLatestReview,
  decideAfterReview,
  decideAfterVerify,
};
