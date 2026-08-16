#!/usr/bin/env node
'use strict';

/**
 * Module: agent/teeChild
 * Purpose: Child helper — spawn a command, tee stdout/stderr to log file,
 *          parse stream-json activity, emit themed heartbeats.
 * uiPipe: structured GBX\\t{json}\\n lines on stdout for parent TUI (no stderr UI).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createTheme, formatAgentStart, formatAgentActivity, formatAgentHeartbeat, formatAgentDone, formatAgentError } = require('../consoleTheme');
const { processLine } = require('./cursorStream');
const { resolveAgentCommand } = require('./resolveAgentCommand');

function extractRole(label) {
  const s = String(label || 'agent');
  const idx = s.indexOf(':');
  return idx >= 0 ? s.slice(0, idx) : s;
}

function emitUiLine(event, eventsFile) {
  const line = `GBX\t${JSON.stringify(event)}\n`;
  if (eventsFile) {
    try {
      fs.appendFileSync(eventsFile, line, 'utf8');
    } catch {
      /* parent may have cleaned up */
    }
  }
  // A sidecar consumer does not drain this helper's stdout pipe. Mirroring
  // every event to both transports eventually applies backpressure on long
  // commands. stdout remains the compatibility transport when no file exists.
  if (!eventsFile) {
    process.stdout.write(line);
  }
}

function writeUiOrStderr(uiPipe, theme, role, label, line, log, kind, extra = {}, eventsFile = null) {
  if (uiPipe) {
    emitUiLine({ kind, role, label, ...extra, text: extra.text || line }, eventsFile);
    return;
  }
  process.stderr.write(line);
  log.write(line);
}

function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    process.stderr.write('[gbx-tee] missing payload path\n');
    process.exit(2);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  } catch (error) {
    process.stderr.write(`[gbx-tee] bad payload: ${error.message}\n`);
    process.exit(2);
  }

  const {
    command,
    args = [],
    workdir,
    logFile,
    heartbeatMs = 15_000,
    label = 'agent',
    env: extraEnv = {},
    role = null,
    colorEnabled = true,
    themeEnabled = true,
    outputFormat = 'text',
    streamPartialOutput = false,
    showAgentEvents = true,
    uiPipe = false,
    shell: payloadShell,
    uiEventsFile = null,
  } = payload;

  if (!command || !logFile) {
    process.stderr.write('[gbx-tee] payload requires command + logFile\n');
    process.exit(2);
  }

  function emitUi(event) {
    if (!uiPipe) return;
    emitUiLine(event, uiEventsFile);
  }

  const resolved =
    payloadShell === true && (!args || args.length === 0)
      ? { command, shell: true }
      : resolveAgentCommand(command);
  const useShell = payloadShell != null ? Boolean(payloadShell) : resolved.shell;
  const spawnCommand = resolved.command;
  const agentRole = role || extractRole(label);
  const theme = createTheme({ enabled: themeEnabled, color: colorEnabled });
  const useStreamJson = outputFormat === 'stream-json';

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile, { flags: 'a' });

  const started = Date.now();
  let lastOutputAt = started;
  let lastActivity = '';
  let lastActivityPrinted = '';
  const beatEvery = Number(heartbeatMs);
  const heartbeatsEnabled = Number.isFinite(beatEvery) && beatEvery > 0;
  let ndjsonBuf = '';

  const header = formatAgentStart(theme, agentRole, label, {
    command: spawnCommand,
    workdir: workdir || process.cwd(),
  });
  if (uiPipe) {
    emitUi({
      kind: 'start',
      role: agentRole,
      label,
      logFile,
      command: spawnCommand,
      workdir: workdir || process.cwd(),
    });
    log.write(header);
  } else {
    process.stderr.write(header);
    log.write(header);
  }

  const child = spawn(spawnCommand, args, {
    cwd: workdir || process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell,
  });

  function writeActivity(text) {
    if (!showAgentEvents || !text) return;
    if (text === lastActivityPrinted) return;
    lastActivityPrinted = text;
    lastActivity = text;
    lastOutputAt = Date.now();
    const line = formatAgentActivity(theme, agentRole, text);
    if (uiPipe) {
      emitUi({ kind: 'activity', role: agentRole, label, text });
      log.write(line);
      return;
    }
    process.stderr.write(line);
    log.write(line);
  }

  function handleStdoutChunk(buf) {
    lastOutputAt = Date.now();
    log.write(buf);
    if (!useStreamJson) {
      // TUI needs raw command output (e.g. npm test) as result events.
      if (uiPipe) {
        emitUi({ kind: 'result', role: agentRole, label, text: buf.toString() });
      } else {
        process.stdout.write(buf);
      }
      return;
    }
    ndjsonBuf += buf.toString();
    let idx;
    while ((idx = ndjsonBuf.indexOf('\n')) >= 0) {
      const line = ndjsonBuf.slice(0, idx);
      ndjsonBuf = ndjsonBuf.slice(idx + 1);
      if (!line.trim()) continue;
      const events = processLine(line, {
        workdir: workdir || process.cwd(),
        streamPartial: streamPartialOutput,
        showAssistant: showAgentEvents,
      });
      for (const ev of events) {
        if (ev.type === 'activity') {
          writeActivity(ev.text);
        } else if (ev.type === 'assistant') {
          writeActivity(ev.text);
        } else if (ev.type === 'result') {
          const text = `${ev.text}\n`;
          if (uiPipe) {
            emitUi({ kind: 'result', role: agentRole, label, text: ev.text });
          } else {
            process.stdout.write(text);
          }
          log.write(text);
          lastOutputAt = Date.now();
        }
      }
    }
  }

  child.stdout.on('data', handleStdoutChunk);
  child.stderr.on('data', (buf) => {
    lastOutputAt = Date.now();
    const text = buf.toString();
    if (uiPipe) {
      emitUi({ kind: 'stderr', role: agentRole, label, text });
    } else {
      process.stderr.write(buf);
    }
    log.write(buf);
  });

  let hb = null;
  if (heartbeatsEnabled) {
    const interval = Math.max(5_000, beatEvery);
    hb = setInterval(() => {
      const silentMs = Date.now() - lastOutputAt;
      if (silentMs < interval) {
        return;
      }
      const elapsed = Math.round((Date.now() - started) / 1000);
      const line = formatAgentHeartbeat(theme, agentRole, label, elapsed, lastActivity);
      if (uiPipe) {
        emitUi({
          kind: 'heartbeat',
          role: agentRole,
          label,
          elapsed,
          text: lastActivity,
        });
        log.write(line);
        return;
      }
      process.stderr.write(line);
      log.write(line);
    }, interval);
  }

  child.on('error', (error) => {
    if (hb) clearInterval(hb);
    const line = formatAgentError(theme, agentRole, label, error.message);
    if (uiPipe) {
      emitUi({ kind: 'error', role: agentRole, label, text: error.message });
    } else {
      process.stderr.write(line);
    }
    log.write(line);
    log.end(() => process.exit(1));
  });

  child.on('close', (code, signal) => {
    if (hb) clearInterval(hb);
    if (ndjsonBuf.trim() && useStreamJson) {
      const events = processLine(ndjsonBuf, {
        workdir: workdir || process.cwd(),
        streamPartial: streamPartialOutput,
        showAgentEvents,
      });
      for (const ev of events) {
        if (ev.type === 'activity' || ev.type === 'assistant') writeActivity(ev.text);
        else if (ev.type === 'result') {
          const text = `${ev.text}\n`;
          if (uiPipe) {
            emitUi({ kind: 'result', role: agentRole, label, text: ev.text });
          } else {
            process.stdout.write(text);
          }
          log.write(text);
        }
      }
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    const exit = code == null ? 1 : code;
    const line = formatAgentDone(theme, agentRole, label, exit, elapsed, signal);
    if (uiPipe) {
      emitUi({
        kind: 'done',
        role: agentRole,
        label,
        exitCode: exit,
        elapsed,
        signal: signal || null,
      });
    } else {
      process.stderr.write(line);
    }
    try {
      fs.appendFileSync(logFile, line);
    } catch {
      /* ignore */
    }
    log.end(() => process.exit(exit));
  });
}

main();
