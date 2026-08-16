'use strict';

/**
 * Module: clearBlocked
 * Purpose: Decide FSM status after --clear-blocked [--after-manual].
 */

const { STATUSES } = require('./fsm');
const { assertBatchChecked, todoTasks } = require('./tasks');

/**
 * Archive reviews/latest.json so hard_stop does not re-scan stale "未见 Host 写口" text.
 * @returns {string|null} archived path, or null if nothing to archive
 */
function archiveLatestReview(latestPath, reviewsDir) {
  const fs = require('fs');
  const path = require('path');
  if (!latestPath || !fs.existsSync(latestPath)) {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(reviewsDir, `latest-blocked-${stamp}.json`);
  fs.renameSync(latestPath, dest);
  return dest;
}

/**
 * @param {{
 *   tasks: Array<{id: string, status: string}>,
 *   activeTaskIds?: string[],
 *   fixTrigger?: string|null,
 *   afterManual?: boolean,
 * }} opts
 * @returns {{ next: string, activeTaskIds: string[], reason: string }}
 */
function resolveClearBlockedNext(opts) {
  const {
    tasks,
    activeTaskIds = [],
    fixTrigger = null,
    afterManual = false,
  } = opts;

  const todos = todoTasks(tasks);
  if (todos.length === 0) {
    return {
      next: STATUSES.FULL_REVIEW,
      activeTaskIds: [],
      reason: 'no remaining todos → FULL_REVIEW',
    };
  }

  const ids = Array.isArray(activeTaskIds) ? activeTaskIds.filter(Boolean) : [];
  const batchCheck =
    ids.length > 0 ? assertBatchChecked(tasks, ids) : { ok: false, missing: ids };

  // Human finished verify + checked ✅ for the stuck batch → re-verify then review.
  if (afterManual && ids.length > 0 && batchCheck.ok) {
    return {
      next: STATUSES.VERIFY_BATCH,
      activeTaskIds: ids,
      reason: '--after-manual: active batch already ✅ → VERIFY_BATCH',
    };
  }

  // Human fixed some issues but batch still open → Fixer, not full re-Execute.
  if (
    afterManual &&
    ids.length > 0 &&
    !batchCheck.ok &&
    (fixTrigger === 'review_fail' ||
      fixTrigger === 'verify_fail' ||
      fixTrigger === 'checkbox_missing' ||
      fixTrigger === 'full_review_fail' ||
      fixTrigger === 'full_verify_fail')
  ) {
    const nextTrigger =
      fixTrigger === 'verify_fail' || fixTrigger === 'checkbox_missing' || !fixTrigger
        ? 'checkbox_missing'
        : fixTrigger;
    return {
      next: STATUSES.FIX_BATCH,
      activeTaskIds: ids,
      fixTrigger: nextTrigger,
      reason: `--after-manual: fixTrigger=${nextTrigger}, missing=${batchCheck.missing.join(',')} → FIX_BATCH`,
    };
  }

  if (afterManual && ids.length > 0 && !batchCheck.ok) {
    return {
      next: STATUSES.FIX_BATCH,
      activeTaskIds: ids,
      fixTrigger: 'checkbox_missing',
      reason: `--after-manual: active batch still has ⬜ (${batchCheck.missing.join(',')}) → FIX_BATCH`,
    };
  }

  // Default unlock: continue implementing remaining todos.
  return {
    next: STATUSES.EXECUTE_BATCH,
    activeTaskIds: [],
    reason: `remaining todos=${todos.length} → EXECUTE_BATCH`,
  };
}

module.exports = {
  archiveLatestReview,
  resolveClearBlockedNext,
};
