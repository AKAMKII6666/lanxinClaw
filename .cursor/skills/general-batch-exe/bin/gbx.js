#!/usr/bin/env node
'use strict';

/**
 * Module: gbx CLI
 * Purpose: Entry for general-batch-exe orchestrator.
 */

const path = require('path');
const { parseArgs } = require('../lib/parseArgs');
const { runOrchestrator } = require('../lib/orchestrator');

const SKILL_ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(SKILL_ROOT, 'package.json'));

function printHelp() {
  const lines = [
    `general-batch-exe (gbx) v${pkg.version}`,
    '',
    'External Batch Execute–Review–Repair orchestrator.',
    'Does NOT depend on @batch-execute or any host-repo npm scripts.',
    '',
    'Usage:',
    '  gbx --exFile <path-to-execution-index.md> [options]',
    '  gbx --help',
    '',
    'Options:',
    '  --exFile <path>                 Execution index (required).',
    '  --config <path>                 Optional project defaults YAML.',
    '  --workdir <path>                Target repo root (default: cwd).',
    '  --dry-run                       Parse + validate; do not start loop.',
    '  --mock-agent                    Drive FSM without cursor-agent.',
    '  --checkpoint                    Opt-in git checkpoint (default OFF; dirty tree refused).',
    '  --no-checkpoint                 Force checkpoints off (redundant with default).',
    '  --reset-state                   Delete workflow STATE.json before run.',
    '  --clear-blocked                 Unblock BLOCKED; archives stale latest.json; smart resume.',
    '  --after-manual                  With --clear-blocked: human already verified/checked →',
    '                                  VERIFY_BATCH (all active ✅) or FIX_BATCH (still ⬜).',
    '  --continue-on-executor-fail     Do not BLOCKED when executor exits non-zero.',
    '  --agent-cmd <cmd>               Override agent binary (default: cursor-agent, falls back to agent).',
    '  --max-iterations <n>            Override max_rounds from index.',
    '  --quiet                         Capture-only agent/verify (no live tee/heartbeats).',
    '  --verbose                       Live console (default; overrides GBX_QUIET).',
    '  --no-heartbeat                  Live agent output without periodic heartbeat lines.',
    '  --no-color                      Plain text console (no ANSI); respects NO_COLOR.',
    '  --no-agent-force                Do not pass cursor-agent --force (shell/delete need approval).',
    '  --no-agent-trust                Do not pass cursor-agent --trust.',
    '  --tui                           Force neo-blessed dashboard (when TTY).',
    '  --plain                         Force line console (disable TUI).',
    '  --help, -h                      Show this help.',
    '',
    'Docs:',
    `  ${path.join(SKILL_ROOT, 'README.md')}`,
  ];
  console.log(lines.join('\n'));
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    console.error('Run gbx --help for usage.');
    process.exit(1);
  }

  if (args.help || process.argv.length <= 2) {
    printHelp();
    process.exit(0);
  }

  const code = runOrchestrator(args);
  process.exit(code);
}

main();
