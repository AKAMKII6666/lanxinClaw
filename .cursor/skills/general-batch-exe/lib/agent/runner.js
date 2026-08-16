'use strict';

/**
 * Module: agent/runner
 * Purpose: Spawn cursor-agent / agent with prompt on disk (avoids ARG_MAX).
 * Default: live tee to console + log file + themed heartbeats (not silent).
 * TUI mode: uiPipe teeChild + blocking stdout read → independent TUI renderer.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readSync } = require('fs');
const { createTheme, printRoleBanner } = require('../consoleTheme');
const { isProcessAlive } = require('../ui/processLiveness');
const { resolveAgentCommand } = require('./resolveAgentCommand');

function commandExists(command) {
  const resolved = resolveAgentCommand(command);
  if (process.platform === 'win32' && resolved.shell && fs.existsSync(resolved.command)) {
    return true;
  }
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(whichCmd, [command], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return r.status === 0;
}

function readLog(logFile) {
  try {
    if (fs.existsSync(logFile)) {
      return fs.readFileSync(logFile, 'utf8');
    }
  } catch {
    /* ignore */
  }
  return '';
}

function yieldMs(ms) {
  const waitCell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitCell, 0, 0, Math.max(1, ms));
}

function terminateChildTree(child) {
  if (!child || !Number.isInteger(child.pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    /* already exited */
  }
}

function exitForUiCancel(child, uiWriter) {
  terminateChildTree(child);
  try {
    uiWriter?.destroy?.();
  } catch {
    /* renderer may already be gone */
  }
  process.stderr.write('[gbx] cancelled from TUI\n');
  process.exit(130);
}

function handleUiPipeLine(line, uiWriter) {
  if (!line.startsWith('GBX\t')) return null;
  try {
    const ev = JSON.parse(line.slice(4));
    uiWriter.onTeeEvent(ev);
    let lastActivity = ev.text;
    if ((ev.kind === 'result' || ev.kind === 'stderr') && ev.text) {
      const lines = String(ev.text)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      lastActivity = lines.length ? lines[lines.length - 1] : '';
    }
    // onTeeEvent(done) clears the active agent. Do not immediately recreate it
    // with the final event, otherwise the status bar freezes on the old timer.
    if (ev.kind !== 'done') {
      uiWriter.setAgent({
        label: ev.label,
        role: ev.role,
        elapsed: ev.elapsed,
        lastActivity,
        logFile: ev.logFile,
      });
    }
    return ev;
  } catch {
    /* ignore malformed */
    return null;
  }
}

function runTeeWithUi(child, uiWriter, timeoutMs, options = {}) {
  let buf = '';
  const start = Date.now();
  let observedExitCode = null;
  const eventsFile = options.eventsFile || null;

  function ingestLine(line) {
    const event = handleUiPipeLine(line, uiWriter);
    if (event?.kind === 'done') observedExitCode = event.exitCode;
  }

  function ingestChunk(text) {
    buf += text;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      ingestLine(line);
    }
  }

  // Production TUI calls always provide a sidecar file. Polling it avoids
  // blocking readSync semantics and stdout-pipe backpressure on every platform.
  const stdoutFd = child.stdout?.fd ?? child.stdout?._handle?.fd;
  const useFile = Boolean(eventsFile);

  if (useFile) {
    let offset = 0;
    let childExited = false;
    let exitCode = null;
    child.on('exit', (code) => {
      childExited = true;
      exitCode = code == null ? 1 : code;
    });

    while (true) {
      if (timeoutMs && Date.now() - start > timeoutMs) {
        child.kill('SIGKILL');
        break;
      }
      if (uiWriter?.render) uiWriter.render();
      if (uiWriter?.isCancelRequested?.()) {
        exitForUiCancel(child, uiWriter);
      }

      try {
        if (fs.existsSync(eventsFile)) {
          const stat = fs.statSync(eventsFile);
          if (stat.size < offset) offset = 0;
          if (stat.size > offset) {
            const fd = fs.openSync(eventsFile, 'r');
            try {
              const length = stat.size - offset;
              const chunk = Buffer.alloc(length);
              fs.readSync(fd, chunk, 0, length, offset);
              offset = stat.size;
              ingestChunk(chunk.toString('utf8'));
            } finally {
              fs.closeSync(fd);
            }
          }
        }
      } catch {
        /* transient */
      }

      // The Windows file transport runs in a synchronous polling loop, so
      // child.on('exit') cannot fire until this function returns. The done
      // record is the authoritative completion signal for this transport.
      if (Number.isInteger(observedExitCode)) {
        break;
      }
      if (!isProcessAlive(child.pid)) {
        exitCode = 1;
        break;
      }

      if (childExited) {
        // Final drain
        try {
          if (fs.existsSync(eventsFile)) {
            const stat = fs.statSync(eventsFile);
            if (stat.size > offset) {
              const fd = fs.openSync(eventsFile, 'r');
              try {
                const length = stat.size - offset;
                const chunk = Buffer.alloc(length);
                fs.readSync(fd, chunk, 0, length, offset);
                ingestChunk(chunk.toString('utf8'));
              } finally {
                fs.closeSync(fd);
              }
            }
          }
        } catch {
          /* ignore */
        }
        break;
      }
      yieldMs(30);
    }

    if (buf.trim()) {
      for (const line of buf.split('\n')) {
        if (line.trim()) ingestLine(line);
      }
    }
    if (uiWriter?.clearAgent) uiWriter.clearAgent();
    return Number.isInteger(observedExitCode)
      ? observedExitCode
      : Number.isInteger(exitCode)
        ? exitCode
        : 1;
  }

  if (!Number.isInteger(stdoutFd) || stdoutFd < 0) {
    child.kill('SIGKILL');
    if (uiWriter?.clearAgent) uiWriter.clearAgent();
    return 1;
  }

  while (true) {
    if (timeoutMs && Date.now() - start > timeoutMs) {
      child.kill('SIGKILL');
      break;
    }
    if (uiWriter?.render) uiWriter.render();
    if (uiWriter?.isCancelRequested?.()) {
      exitForUiCancel(child, uiWriter);
    }

    try {
      const chunk = Buffer.alloc(65536);
      const n = readSync(stdoutFd, chunk, 0, chunk.length, null);
      if (n > 0) {
        ingestChunk(chunk.toString('utf8', 0, n));
      } else {
        break;
      }
    } catch (err) {
      if (err.code === 'EOF' || err.code === 'EPIPE') break;
      yieldMs(30);
    }
  }

  if (buf.trim()) {
    for (const line of buf.split('\n')) {
      if (line.trim()) ingestLine(line);
    }
  }

  if (uiWriter?.clearAgent) uiWriter.clearAgent();
  return Number.isInteger(observedExitCode) ? observedExitCode : 1;
}

/**
 * @param {object} params
 * @param {object} [params.permissions]
 * @param {boolean} [params.permissions.force] cursor-agent --force (auto-approve shell/delete)
 * @param {boolean} [params.permissions.trust] cursor-agent --trust workspace
 * @param {boolean} [params.permissions.approveMcps] cursor-agent --approve-mcps
 * @param {'enabled'|'disabled'|null} [params.permissions.sandbox]
 */
function buildAgentArgs({
  printFlag,
  shortPrompt,
  outputFormat,
  streamPartialOutput,
  permissions = {},
}) {
  const args = [];
  if (permissions.force) {
    args.push('--force');
  }
  if (permissions.trust) {
    args.push('--trust');
  }
  if (permissions.approveMcps) {
    args.push('--approve-mcps');
  }
  if (permissions.sandbox === 'enabled' || permissions.sandbox === 'disabled') {
    args.push('--sandbox', permissions.sandbox);
  }
  args.push(printFlag);
  const fmt = outputFormat || 'text';
  if (fmt && fmt !== 'text') {
    args.push('--output-format', fmt);
    if (fmt === 'stream-json' && streamPartialOutput) {
      args.push('--stream-partial-output');
    }
  }
  args.push(shortPrompt);
  return args;
}

function resolveAgentPermissions(agent = {}) {
  return {
    force: agent.force !== false,
    trust: agent.trust !== false,
    approveMcps: Boolean(agent.approve_mcps),
    sandbox:
      agent.sandbox === 'enabled' || agent.sandbox === 'disabled'
        ? agent.sandbox
        : null,
  };
}

function formatPermissionNote(permissions) {
  const parts = [];
  if (permissions.force) parts.push('force');
  if (permissions.trust) parts.push('trust');
  if (permissions.approveMcps) parts.push('approve-mcps');
  if (permissions.sandbox) parts.push(`sandbox=${permissions.sandbox}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Write full prompt to disk; argv only carries a short pointer (ARG_MAX safe).
 */
function runCursorAgent({
  command = 'cursor-agent',
  printFlag = '-p',
  outputFormat = 'stream-json',
  streamPartialOutput = false,
  prompt,
  workdir,
  promptDir = null,
  timeoutMs = 1_800_000,
  quiet = false,
  heartbeatMs = 15_000,
  label = 'agent',
  role = null,
  themeOptions = null,
  bannerCtx = null,
  consoleTheme = null,
  agentPermissions = null,
  uiWriter = null,
}) {
  const dir = promptDir || path.join(os.tmpdir(), 'gbx-prompts');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const promptFile = path.join(dir, `prompt-${stamp}.md`);
  const logFile = path.join(dir, `agent-${stamp}.log`);
  fs.writeFileSync(promptFile, prompt, 'utf8');

  const shortPrompt = [
    'Follow the instructions in the prompt file exactly. Do not skip sections.',
    `Prompt file (absolute path): ${promptFile}`,
    'Read that file now and execute it.',
  ].join('\n');

  const permissions = agentPermissions || resolveAgentPermissions({});
  const args = buildAgentArgs({
    printFlag,
    shortPrompt,
    outputFormat,
    streamPartialOutput,
    permissions,
  });
  const env = {
    ...process.env,
    GBX_PROMPT_FILE: promptFile,
  };
  const resolved = resolveAgentCommand(command);

  const agentRole =
    role || (label.includes(':') ? label.slice(0, label.indexOf(':')) : label);
  const theme = createTheme(themeOptions || { enabled: true, color: true });
  const useUiPipe = Boolean(uiWriter && uiWriter.mode === 'tui');

  if (quiet) {
    const result = spawnSync(resolved.command, args, {
      cwd: workdir,
      encoding: 'utf8',
      timeout: timeoutMs,
      env,
      maxBuffer: 20 * 1024 * 1024,
      shell: resolved.shell,
    });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    try {
      fs.writeFileSync(logFile, `${stdout}${stderr ? `\n--- stderr ---\n${stderr}` : ''}`, 'utf8');
    } catch {
      /* ignore */
    }
    return {
      ok: result.status === 0,
      exitCode: result.status == null ? 1 : result.status,
      stdout,
      stderr,
      error: result.error ? String(result.error.message) : null,
      promptFile,
      logFile,
    };
  }

  if (consoleTheme?.show_role_banner !== false && bannerCtx) {
    if (useUiPipe) {
      uiWriter.log(`── ${agentRole.toUpperCase()} ── batch:${(bannerCtx.batchIds || []).join(',') || '-'}`, {
        level: 'info',
      });
    } else {
      printRoleBanner(theme, agentRole, {
        ...bannerCtx,
        promptHint: promptFile,
        workdir,
      });
    }
  }

  const teeChild = path.join(__dirname, 'teeChild.js');
  const payloadFile = path.join(dir, `spawn-${stamp}.json`);
  const uiEventsFile = path.join(dir, `events-${stamp}.ndjson`);
  const showEvents = consoleTheme?.show_agent_events !== false;
  if (useUiPipe) {
    fs.writeFileSync(uiEventsFile, '', 'utf8');
  }
  fs.writeFileSync(
    payloadFile,
    `${JSON.stringify(
      {
        command: resolved.command,
        args,
        workdir,
        logFile,
        heartbeatMs,
        label,
        role: agentRole,
        colorEnabled: theme.color,
        themeEnabled: theme.options.enabled !== false,
        outputFormat: outputFormat || 'text',
        streamPartialOutput: Boolean(streamPartialOutput),
        showAgentEvents: showEvents,
        uiPipe: useUiPipe,
        uiEventsFile: useUiPipe ? uiEventsFile : null,
        shell: resolved.shell,
        env: { GBX_PROMPT_FILE: promptFile },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const fmtNote = outputFormat && outputFormat !== 'text' ? ` format=${outputFormat}` : '';
  const permNote = formatPermissionNote(permissions);
  const launchLine = `[gbx] launching ${label} (${resolved.command}${fmtNote}${permNote}); log=${logFile}`;
  if (useUiPipe) {
    uiWriter.log(launchLine, { level: 'info' });
    uiWriter.setAgent({ label, role: agentRole, logFile, elapsed: 0, lastActivity: '' });
  } else {
    process.stderr.write(`${launchLine}; live output below\n`);
  }

  let exitCode = 1;
  if (useUiPipe) {
    const child = spawn(process.execPath, [teeChild, payloadFile], {
      cwd: workdir,
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    exitCode = runTeeWithUi(child, uiWriter, timeoutMs, { eventsFile: uiEventsFile });
  } else {
    const result = spawnSync(process.execPath, [teeChild, payloadFile], {
      cwd: workdir,
      stdio: 'inherit',
      timeout: timeoutMs,
      env,
    });
    exitCode = result.status == null ? 1 : result.status;
  }

  const captured = readLog(logFile);
  return {
    ok: exitCode === 0,
    exitCode,
    stdout: captured,
    stderr: null,
    error: null,
    promptFile,
    logFile,
  };
}

module.exports = {
  runCursorAgent,
  commandExists,
  resolveAgentCommand,
  buildAgentArgs,
  resolveAgentPermissions,
  formatPermissionNote,
  runTeeWithUi,
  handleUiPipeLine,
};
