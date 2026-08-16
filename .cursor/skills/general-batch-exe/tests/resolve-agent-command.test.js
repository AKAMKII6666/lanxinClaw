'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveAgentCommand, needsShellSpawn } = require('../lib/agent/resolveAgentCommand');

describe('resolveAgentCommand (Windows merge)', () => {
  it('needsShellSpawn only on win32 for agent/.cmd', () => {
    if (process.platform === 'win32') {
      assert.equal(needsShellSpawn('cursor-agent'), true);
      assert.equal(needsShellSpawn('C:\\\\Tools\\\\agent.cmd'), true);
      assert.equal(needsShellSpawn('node'), false);
    } else {
      assert.equal(needsShellSpawn('cursor-agent'), false);
      assert.equal(needsShellSpawn('agent.cmd'), false);
    }
  });

  it('resolveAgentCommand returns shell flag on win32 for cursor-agent', () => {
    const r = resolveAgentCommand('cursor-agent');
    if (process.platform === 'win32') {
      assert.equal(r.shell, true);
      assert.ok(typeof r.command === 'string' && r.command.length > 0);
    } else {
      assert.equal(r.shell, false);
      assert.equal(r.command, 'cursor-agent');
    }
  });
});
