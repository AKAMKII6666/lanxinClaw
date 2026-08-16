'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../lib/parseArgs');
const { mergeConfig } = require('../lib/mergeConfig');
const { buildAgentArgs } = require('../lib/agent/runner');

describe('agent runner permissions', () => {
  it('mergeConfig enables force and trust for unattended batch runs', () => {
    const cfg = mergeConfig({ cli: {} });
    assert.equal(cfg.agent.force !== false, true);
    assert.equal(cfg.agent.trust !== false, true);
  });

  it('buildAgentArgs adds --force and --trust before print flag by default', () => {
    const args = buildAgentArgs({
      printFlag: '-p',
      shortPrompt: 'go',
      outputFormat: 'stream-json',
      permissions: { force: true, trust: true },
    });
    assert.deepEqual(args.slice(0, 4), ['--force', '--trust', '-p', '--output-format']);
    assert.equal(args.at(-1), 'go');
  });

  it('buildAgentArgs omits permission flags when disabled', () => {
    const args = buildAgentArgs({
      printFlag: '-p',
      shortPrompt: 'go',
      permissions: { force: false, trust: false },
    });
    assert.deepEqual(args, ['-p', 'go']);
  });

  it('buildAgentArgs supports sandbox and approve-mcps', () => {
    const args = buildAgentArgs({
      printFlag: '-p',
      shortPrompt: 'go',
      permissions: {
        force: true,
        trust: false,
        approveMcps: true,
        sandbox: 'disabled',
      },
    });
    assert.deepEqual(args.slice(0, 6), [
      '--force',
      '--approve-mcps',
      '--sandbox',
      'disabled',
      '-p',
      'go',
    ]);
  });

  it('parses --no-agent-force', () => {
    assert.equal(parseArgs(['--no-agent-force']).noAgentForce, true);
  });

  it('mergeConfig applies --no-agent-force', () => {
    const cfg = mergeConfig({ cli: { noAgentForce: true } });
    assert.equal(cfg.agent.force, false);
    assert.equal(cfg.agent.trust, true);
  });
});
