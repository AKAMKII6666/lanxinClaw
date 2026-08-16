'use strict';

/**
 * Module: gitCheckpoint
 * Purpose: Preflight a clean tree, then commit a batch only after review and verification pass.
 */

const { spawnSync } = require('child_process');

function isGitRepo(workdir) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: workdir,
    encoding: 'utf8',
  });
  return r.status === 0 && String(r.stdout).trim() === 'true';
}

function runGit(args, workdir) {
  return spawnSync('git', args, {
    cwd: workdir,
    encoding: 'utf8',
    env: process.env,
  });
}

function excludePathspecs(excludePaths) {
  const specs = [];
  for (const rel of excludePaths || []) {
    if (!rel || rel === '.') {
      continue;
    }
    const normalized = String(rel).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
    specs.push(`:(exclude,literal)${normalized}`);
  }
  return specs;
}

function porcelain(workdir, { excludePaths = [] } = {}) {
  const status = runGit(
    ['status', '--porcelain', '--untracked-files=all', '--', '.', ...excludePathspecs(excludePaths)],
    workdir,
  );
  if (status.status !== 0) {
    throw new Error(`git status failed: ${status.stderr || status.stdout}`);
  }
  return String(status.stdout || '').trim();
}

/**
 * @returns {{ skipped: boolean, sha: string|null, reason?: string, error?: boolean }}
 */
function checkCheckpointPreflight(
  workdir,
  { enabled = false, requireClean = true, excludePaths = [] } = {},
) {
  if (!enabled) {
    return { skipped: true, sha: null, reason: 'checkpoints disabled (default; pass --checkpoint to enable)' };
  }
  if (!isGitRepo(workdir)) {
    return {
      skipped: true,
      sha: null,
      error: true,
      reason: '--checkpoint requires --workdir to be inside a git repository',
    };
  }

  let dirty;
  try {
    dirty = porcelain(workdir, { excludePaths });
  } catch (error) {
    return { skipped: true, sha: null, error: true, reason: error.message };
  }
  if (requireClean && dirty) {
    return {
      skipped: true,
      sha: null,
      error: true,
      reason:
        'working tree is dirty before execution; commit/stash first, use a clean worktree, or omit --checkpoint.',
    };
  }

  return { skipped: false, sha: null };
}

/**
 * Commit the verified batch while excluding orchestrator runtime artifacts.
 */
function createCheckpoint(workdir, batchNumber, { enabled = false, excludePaths = [] } = {}) {
  if (!enabled) {
    return { skipped: true, sha: null, reason: 'checkpoints disabled' };
  }
  if (!isGitRepo(workdir)) {
    return { skipped: true, sha: null, reason: 'not a git repository' };
  }

  const add = runGit(['add', '-A', '--', '.', ...excludePathspecs(excludePaths)], workdir);
  if (add.status !== 0) {
    return { skipped: true, sha: null, error: true, reason: `git add failed: ${add.stderr}` };
  }

  const staged = runGit(['diff', '--cached', '--quiet', '--exit-code'], workdir);
  if (staged.status === 0) {
    const rev = runGit(['rev-parse', '--short', 'HEAD'], workdir);
    return {
      skipped: true,
      sha: rev.status === 0 ? String(rev.stdout).trim() : null,
      reason: 'nothing to commit (clean tree)',
    };
  }
  if (staged.status !== 1) {
    return {
      skipped: true,
      sha: null,
      error: true,
      reason: `git diff --cached failed: ${staged.stderr}`,
    };
  }
  const msg = `checkpoint: gbx batch ${String(batchNumber).padStart(2, '0')}`;
  const commit = runGit(['commit', '-m', msg, '--no-verify'], workdir);
  if (commit.status !== 0) {
    return { skipped: true, sha: null, error: true, reason: `git commit failed: ${commit.stderr}` };
  }
  const rev = runGit(['rev-parse', '--short', 'HEAD'], workdir);
  return {
    skipped: false,
    sha: rev.status === 0 ? String(rev.stdout).trim() : null,
  };
}

module.exports = {
  isGitRepo,
  checkCheckpointPreflight,
  createCheckpoint,
  porcelain,
};
