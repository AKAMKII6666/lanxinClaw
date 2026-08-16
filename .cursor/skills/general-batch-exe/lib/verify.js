'use strict';

/**
 * Module: verify
 * Purpose: Run verify shell commands in workdir; record reports (incl. latest-verify.json).
 * Default: live stdout/stderr (+ optional heartbeat via teeChild).
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildVerifyReport,
  writeVerifyReports,
  verifyFingerprint,
} = require('./verifyReport');
const { gbxErr } = require('./ui/emit');
const { runTeeWithUi } = require('./agent/runner');

function runOneQuiet(command, workdir, timeoutMs = 600_000, maxBytes = 65536) {
  const result = spawnSync(command, {
    cwd: workdir,
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
    maxBuffer: Math.max(maxBytes, 20 * 1024 * 1024),
  });
  return {
    command,
    exitCode: result.status == null ? 1 : result.status,
    signal: result.signal || null,
    stdout: (result.stdout || '').slice(0, maxBytes),
    stderr: (result.stderr || '').slice(0, maxBytes),
    error: result.error ? String(result.error.message) : null,
  };
}

function runOneLive(command, workdir, paths, timeoutMs = 600_000, maxBytes = 65536) {
  const teeChild = path.join(__dirname, 'agent', 'teeChild.js');
  const dir =
    paths && paths.logs
      ? paths.logs
      : path.join(os.tmpdir(), 'gbx-verify');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const logFile = path.join(dir, `verify-${stamp}.log`);
  const payloadFile = path.join(dir, `verify-spawn-${stamp}.json`);
  const uiEventsFile = path.join(dir, `verify-events-${stamp}.ndjson`);

  // Windows: do NOT use `cmd /d /s /c <raw>` — nested quotes in `node -e "..."` get
  // stripped and break. Prefer shell:true on the full command (same as runOneQuiet).
  const isWin = process.platform === 'win32';
  const useUi = paths?._ui && paths._ui.mode === 'tui';
  const payload = isWin
    ? {
        command,
        args: [],
        shell: true,
        workdir,
        logFile,
        heartbeatMs: 30_000,
        label: `verify:${command.slice(0, 60)}`,
        role: 'verify',
        uiPipe: Boolean(useUi),
        uiEventsFile: useUi ? uiEventsFile : null,
      }
    : {
        command: '/bin/sh',
        args: ['-c', command],
        shell: false,
        workdir,
        logFile,
        heartbeatMs: 30_000,
        label: `verify:${command.slice(0, 60)}`,
        role: 'verify',
        uiPipe: Boolean(useUi),
        uiEventsFile: useUi ? uiEventsFile : null,
      };

  if (useUi) {
    fs.writeFileSync(uiEventsFile, '', 'utf8');
  }
  fs.writeFileSync(payloadFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  let exitCode = 1;
  if (useUi) {
    paths._ui.setAgent({
      label: `verify:${command.slice(0, 40)}`,
      role: 'verify',
      lastActivity: command,
    });
    const child = spawn(process.execPath, [teeChild, payloadFile], {
      cwd: workdir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    exitCode = runTeeWithUi(child, paths._ui, timeoutMs, { eventsFile: uiEventsFile });
  } else {
    const result = spawnSync(process.execPath, [teeChild, payloadFile], {
      cwd: workdir,
      stdio: 'inherit',
      timeout: timeoutMs,
      env: process.env,
    });
    exitCode = result.status == null ? 1 : result.status;
  }

  let captured = '';
  try {
    if (fs.existsSync(logFile)) captured = fs.readFileSync(logFile, 'utf8');
  } catch {
    /* ignore */
  }

  return {
    command,
    exitCode,
    signal: null,
    stdout: captured.slice(0, maxBytes),
    stderr: '',
    error: null,
  };
}

function runOne(
  command,
  workdir,
  timeoutMs = 600_000,
  { quiet = false, paths = null, maxBytes = 65536 } = {},
) {
  if (quiet) {
    return runOneQuiet(command, workdir, timeoutMs, maxBytes);
  }
  return runOneLive(command, workdir, paths, timeoutMs, maxBytes);
}

/**
 * @returns {{
 *   ok: boolean,
 *   results: object[],
 *   reason: string,
 *   report: object | null,
 *   fingerprint: string | null,
 *   latestFile: string | null,
 * }}
 */
function runVerifyCommands(commands, workdir, paths, label = 'verify', options = {}) {
  const quiet = Boolean(options.quiet);
  const maxBytes = options.maxBytes != null ? options.maxBytes : 65536;
  const phase = options.phase || 'batch';
  const activeTaskIds = options.activeTaskIds || [];
  const results = [];

  if (commands.length === 0) {
    const report = buildVerifyReport({
      label,
      ok: false,
      results: [],
      phase,
      activeTaskIds,
      reason: 'no verify commands configured',
      maxBytes,
    });
    const written = writeVerifyReports(paths, report);
    return {
      ok: false,
      results: [],
      reason: 'no verify commands configured',
      report,
      fingerprint: verifyFingerprint(report),
      latestFile: written.latestFile,
    };
  }

  for (const cmd of commands) {
    if (!quiet) {
      gbxErr(paths, `[gbx] verify → ${cmd}`);
    }
    const r = runOne(cmd, workdir, 600_000, { quiet, paths, maxBytes });
    results.push(r);
    if (r.exitCode !== 0) {
      if (!quiet) {
        gbxErr(paths, `[gbx] verify FAILED exit=${r.exitCode} cmd=${cmd}`);
      }
      break;
    }
    if (!quiet) {
      gbxErr(paths, `[gbx] verify OK cmd=${cmd}`);
    }
  }

  const ok = results.length > 0 && results.every((r) => r.exitCode === 0);
  const report = buildVerifyReport({
    label,
    ok,
    results,
    phase,
    activeTaskIds,
    reason: ok ? 'all commands passed' : 'command failed',
    maxBytes,
  });
  const written = writeVerifyReports(paths, report);

  return {
    ok,
    results,
    reason: report.reason,
    report,
    fingerprint: verifyFingerprint(report),
    latestFile: written.latestFile,
  };
}

module.exports = { runOne, runVerifyCommands };
