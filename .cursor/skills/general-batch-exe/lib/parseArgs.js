'use strict';

/**
 * Module: parseArgs
 * Purpose: CLI argument parsing for gbx.
 */

function parseArgs(argv) {
  const out = {
    help: false,
    dryRun: false,
    mockAgent: false,
    checkpoint: false,
    noCheckpoint: false,
    resetState: false,
    /** Unblock BLOCKED → smart resume; clears agent stdout + archives latest review. */
    clearBlocked: false,
    /**
     * With --clear-blocked: human already ran verify / checked ✅.
     * Prefer VERIFY_BATCH (all active ✅) or FIX_BATCH (still ⬜) over re-EXECUTE.
     */
    afterManual: false,
    continueOnExecutorFail: false,
    /** Default live console; --quiet or GBX_QUIET=1 suppresses streams. */
    quiet: process.env.GBX_QUIET === '1' || process.env.GBX_QUIET === 'true',
    /** Disable tee heartbeats (agent stdout/stderr still live). */
    noHeartbeat: false,
    /** Force plain text console (no ANSI). */
    noColor: process.env.GBX_NO_COLOR === '1' || process.env.GBX_NO_COLOR === 'true',
    /** Force neo-blessed dashboard (when TTY). */
    tui: process.env.GBX_TUI === '1' || process.env.GBX_TUI === 'true',
    /** Force line-based console (v0.6). */
    plainConsole: false,
    /** auto | tui | plain */
    consoleUi: null,
    /** Disable cursor-agent --force (shell/delete still need interactive approval). */
    noAgentForce: process.env.GBX_AGENT_FORCE === '0' || process.env.GBX_AGENT_FORCE === 'false',
    /** Disable cursor-agent --trust. */
    noAgentTrust: process.env.GBX_AGENT_TRUST === '0' || process.env.GBX_AGENT_TRUST === 'false',
    exFile: null,
    config: null,
    workdir: process.cwd(),
    agentCmd: null,
    maxIterations: null,
  };

  const valueOptions = new Map([
    ['--exFile', 'exFile'],
    ['--ex-file', 'exFile'],
    ['--config', 'config'],
    ['--workdir', 'workdir'],
    ['--agent-cmd', 'agentCmd'],
    ['--max-iterations', 'maxIterations'],
  ]);

  function fail(message) {
    const error = new Error(message);
    error.code = 'CLI_INVALID_ARGUMENT';
    throw error;
  }

  function readValue(option, index) {
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) {
      fail(`Option ${option} requires a value`);
    }
    return value;
  }

  function setValue(key, option, value) {
    if (key === 'maxIterations') {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        fail(`${option} must be a positive integer`);
      }
      out[key] = parsed;
      return;
    }
    if (!value) {
      fail(`Option ${option} requires a non-empty value`);
    }
    out[key] = value;
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (arg === '--mock-agent') {
      out.mockAgent = true;
      continue;
    }
    if (arg === '--checkpoint') {
      out.checkpoint = true;
      continue;
    }
    if (arg === '--no-checkpoint') {
      out.noCheckpoint = true;
      continue;
    }
    if (arg === '--reset-state') {
      out.resetState = true;
      continue;
    }
    if (arg === '--clear-blocked') {
      out.clearBlocked = true;
      continue;
    }
    if (arg === '--after-manual') {
      out.afterManual = true;
      continue;
    }
    if (arg === '--continue-on-executor-fail') {
      out.continueOnExecutorFail = true;
      continue;
    }
    if (arg === '--quiet') {
      out.quiet = true;
      continue;
    }
    if (arg === '--verbose') {
      out.quiet = false;
      continue;
    }
    if (arg === '--no-heartbeat') {
      out.noHeartbeat = true;
      continue;
    }
    if (arg === '--no-color') {
      out.noColor = true;
      continue;
    }
    if (arg === '--no-agent-force') {
      out.noAgentForce = true;
      continue;
    }
    if (arg === '--no-agent-trust') {
      out.noAgentTrust = true;
      continue;
    }
    if (arg === '--tui') {
      out.tui = true;
      continue;
    }
    if (arg === '--plain') {
      out.plainConsole = true;
      continue;
    }
    if (valueOptions.has(arg)) {
      const value = readValue(arg, i);
      setValue(valueOptions.get(arg), arg, value);
      i += 1;
      continue;
    }

    const equalsIndex = arg.indexOf('=');
    if (equalsIndex > 0) {
      const option = arg.slice(0, equalsIndex);
      if (valueOptions.has(option)) {
        setValue(valueOptions.get(option), option, arg.slice(equalsIndex + 1));
        continue;
      }
    }

    if (arg.startsWith('-')) {
      fail(`Unknown option: ${arg}`);
    }
    fail(`Unexpected positional argument: ${arg}`);
  }

  if (out.checkpoint && out.noCheckpoint) {
    fail('--checkpoint and --no-checkpoint cannot be used together');
  }
  if (out.resetState && out.clearBlocked) {
    fail('--reset-state and --clear-blocked cannot be used together');
  }
  if (out.afterManual && !out.clearBlocked) {
    fail('--after-manual requires --clear-blocked');
  }

  return out;
}

module.exports = { parseArgs };
