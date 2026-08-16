'use strict';

/**
 * Module: fsm
 * Purpose: Valid workflow statuses (transitions decided in orchestrator + reviewDecision).
 */

const STATUSES = Object.freeze({
  EXECUTE_BATCH: 'EXECUTE_BATCH',
  BATCH_REVIEW: 'BATCH_REVIEW',
  FIX_BATCH: 'FIX_BATCH',
  VERIFY_BATCH: 'VERIFY_BATCH',
  FULL_REVIEW: 'FULL_REVIEW',
  FULL_FIX: 'FULL_FIX',
  FULL_VERIFY: 'FULL_VERIFY',
  BLOCK_ANALYZE: 'BLOCK_ANALYZE',
  BLOCK_REPAIR: 'BLOCK_REPAIR',
  BLOCK_VERIFY: 'BLOCK_VERIFY',
  READY_FOR_MANUAL_QA: 'READY_FOR_MANUAL_QA',
  BLOCKED: 'BLOCKED',
});

const TERMINAL = new Set([STATUSES.READY_FOR_MANUAL_QA, STATUSES.BLOCKED]);

function isTerminal(status) {
  return TERMINAL.has(status);
}

function exitCodeForStatus(status) {
  if (status === STATUSES.READY_FOR_MANUAL_QA) {
    return 0;
  }
  if (status === STATUSES.BLOCKED) {
    return 3;
  }
  return 2;
}

module.exports = { STATUSES, TERMINAL, isTerminal, exitCodeForStatus };
