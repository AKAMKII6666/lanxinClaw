'use strict';

/**
 * Module: stateStore
 * Purpose: Read/write STATE.json — only orchestrator writes this.
 */

const fs = require('fs');
const path = require('path');

const INITIAL = {
  status: 'EXECUTE_BATCH',
  currentBatch: 1,
  batchFixAttempts: 0,
  fullFixAttempts: 0,
  /** Scripts OK but active tasks still ⬜ (separate budget from batchFixAttempts). */
  checkboxFixAttempts: 0,
  iteration: 0,
  lastSuccessfulCommit: null,
  manualQaRequired: false,
  blockedReason: null,
  activeTaskIds: [],
  exFile: null,
  /** review_fail | verify_fail | checkbox_missing | full_review_fail | full_verify_fail | null */
  fixTrigger: null,
  lastVerifyOk: null,
  lastVerifySummary: null,
  lastVerifyFingerprint: null,
  lastVerifyReportPath: null,
  ineffectiveFixStreak: 0,
  /** Separate budget and audit trail for post-Fixer automatic block recovery. */
  recoveryAttempts: 0,
  recoveryOriginStatus: null,
  recoveryResumeState: null,
  recoveryOriginReason: null,
  recoveryKind: null,
  recoveryAnalysisRunId: null,
  recoveryAnalysisReportPath: null,
  recoveryApprovedPaths: [],
};

function workflowPaths(workdir, workflowDir) {
  const root = path.resolve(workdir, workflowDir || '.ai-workflow');
  return {
    root,
    state: path.join(root, 'STATE.json'),
    reviews: path.join(root, 'reviews'),
    latestReview: path.join(root, 'reviews', 'latest.json'),
    reports: path.join(root, 'reports'),
    latestVerify: path.join(root, 'reports', 'latest-verify.json'),
    latestBlockAnalysis: path.join(root, 'reports', 'latest-block-analysis.json'),
    latestBlockRepair: path.join(root, 'reports', 'latest-block-repair.json'),
    logs: path.join(root, 'logs'),
    logFile: path.join(root, 'logs', 'loop.log'),
  };
}

function ensureWorkflowDirs(paths) {
  for (const d of [paths.root, paths.reviews, paths.reports, paths.logs]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function readState(paths) {
  if (!fs.existsSync(paths.state)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(paths.state, 'utf8'));
}

function sleepMs(ms) {
  const wait = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(wait, 0, 0, Math.max(1, ms));
}

function isTransientFsError(error) {
  if (!error) return false;
  const code = error.code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
    return true;
  }
  // Windows Defender / cloud sync often surfaces errno -4094 as UNKNOWN.
  return error.errno === -4094;
}

function writeState(paths, state) {
  ensureWorkflowDirs(paths);
  const body = `${JSON.stringify(state, null, 2)}\n`;
  const tmp = `${paths.state}.${process.pid}.${Date.now()}.tmp`;
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, paths.state);
      return;
    } catch (error) {
      lastError = error;
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      if (!isTransientFsError(error) || attempt === 7) {
        break;
      }
      sleepMs(40 * (attempt + 1));
    }
  }
  // Final fallback: direct write (no rename) after retries.
  try {
    fs.writeFileSync(paths.state, body, 'utf8');
  } catch (error) {
    throw lastError || error;
  }
}

function initState(paths, { exFile }) {
  const state = {
    ...INITIAL,
    exFile,
    updatedAt: new Date().toISOString(),
  };
  writeState(paths, state);
  return state;
}

function loadOrInitState(paths, { exFile }) {
  ensureWorkflowDirs(paths);
  const existing = readState(paths);
  if (existing) {
    const expected = fs.realpathSync(exFile);
    let actual;
    if (typeof existing.exFile === 'string' && existing.exFile) {
      try {
        actual = fs.realpathSync(existing.exFile);
      } catch {
        actual = path.resolve(existing.exFile);
      }
    } else {
      actual = null;
    }
    if (actual !== expected) {
      const error = new Error(
        `workflow state belongs to another execution index (${existing.exFile || 'unknown'}); use --reset-state or a different workflow_dir`,
      );
      error.code = 'STATE_EXFILE_MISMATCH';
      throw error;
    }
    return existing;
  }
  return initState(paths, { exFile: fs.realpathSync(exFile) });
}

function patchState(paths, patch) {
  const cur = readState(paths) || { ...INITIAL };
  const next = {
    ...cur,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeState(paths, next);
  return next;
}

function appendLog(paths, line) {
  ensureWorkflowDirs(paths);
  const stamp = new Date().toISOString();
  fs.appendFileSync(paths.logFile, `[${stamp}] ${line}\n`, 'utf8');
}

module.exports = {
  INITIAL,
  workflowPaths,
  ensureWorkflowDirs,
  readState,
  writeState,
  initState,
  loadOrInitState,
  patchState,
  appendLog,
};
