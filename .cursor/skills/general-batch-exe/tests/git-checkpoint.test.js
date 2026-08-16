'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runOrchestrator } = require('../lib/orchestrator');

const SKILL_ROOT = path.resolve(__dirname, '..');
const EXAMPLE = fs.readFileSync(
  path.join(SKILL_ROOT, 'examples/mock-happy-index.md'),
  'utf8',
);

function git(workdir, args) {
  const result = spawnSync('git', args, { cwd: workdir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || '').trim();
}

describe('verified batch checkpoints', () => {
  it('commits each verified batch and excludes workflow runtime artifacts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-checkpoint-'));
    git(tmp, ['init']);
    git(tmp, ['config', 'user.name', 'GBX Test']);
    git(tmp, ['config', 'user.email', 'gbx@example.test']);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# checkpoint test\n');
    fs.writeFileSync(path.join(tmp, 'index.md'), EXAMPLE);
    git(tmp, ['add', '-A']);
    git(tmp, ['commit', '-m', 'initial']);

    const code = runOrchestrator({
      exFile: 'index.md',
      workdir: tmp,
      mockAgent: true,
      checkpoint: true,
    });
    assert.equal(code, 0);

    const subjects = git(tmp, ['log', '--format=%s']).split('\n');
    assert.deepEqual(subjects.slice(0, 3), [
      'checkpoint: gbx batch 02',
      'checkpoint: gbx batch 01',
      'initial',
    ]);
    assert.equal(
      git(tmp, ['ls-files', '.ai-workflow-mock']),
      '',
      'workflow runtime files must never enter a checkpoint',
    );
    assert.match(fs.readFileSync(path.join(tmp, 'index.md'), 'utf8'), /✅/);
  });

  it('blocks before execution when the initial application tree is dirty', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-checkpoint-dirty-'));
    git(tmp, ['init']);
    git(tmp, ['config', 'user.name', 'GBX Test']);
    git(tmp, ['config', 'user.email', 'gbx@example.test']);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# dirty checkpoint test\n');
    fs.writeFileSync(path.join(tmp, 'index.md'), EXAMPLE);
    git(tmp, ['add', '-A']);
    git(tmp, ['commit', '-m', 'initial']);
    fs.writeFileSync(path.join(tmp, 'dirty.txt'), 'user change\n');

    const code = runOrchestrator({
      exFile: 'index.md',
      workdir: tmp,
      mockAgent: true,
      checkpoint: true,
    });
    assert.equal(code, 3);
    assert.doesNotMatch(fs.readFileSync(path.join(tmp, 'index.md'), 'utf8'), /✅/);
  });
});
