'use strict';

/**
 * Windows: Cursor CLI ships as agent.cmd / cursor-agent.cmd under %LOCALAPPDATA%.
 * Node spawn() cannot execute bare "agent" or .cmd without shell:true.
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {string} command
 * @returns {boolean}
 */
function needsShellSpawn(command) {
  if (process.platform !== 'win32') {
    return false;
  }
  if (/\.(cmd|bat|ps1)$/i.test(command)) {
    return true;
  }
  const base = path.basename(command).toLowerCase();
  return base === 'agent' || base === 'cursor-agent';
}

/**
 * Resolve Cursor CLI command for cross-platform spawn.
 * @param {string} command
 * @returns {{ command: string, shell: boolean }}
 */
function resolveAgentCommand(command) {
  if (!command || typeof command !== 'string') {
    return { command: command, shell: false };
  }
  const trimmed = command.trim();
  if (process.platform !== 'win32') {
    return { command: trimmed, shell: false };
  }

  const extMatch = trimmed.match(/\.(cmd|bat|ps1)$/i);
  if (extMatch && fs.existsSync(trimmed)) {
    return { command: trimmed, shell: true };
  }

  const base = path.basename(trimmed).toLowerCase().replace(/\.(cmd|bat|ps1)$/, '');
  if (base === 'agent' || base === 'cursor-agent') {
    const localApp = process.env.LOCALAPPDATA;
    if (localApp) {
      const cmdPath = path.join(localApp, 'cursor-agent', `${base}.cmd`);
      if (fs.existsSync(cmdPath)) {
        return { command: cmdPath, shell: true };
      }
    }
    return { command: trimmed, shell: true };
  }

  return { command: trimmed, shell: needsShellSpawn(trimmed) };
}

module.exports = {
  resolveAgentCommand: resolveAgentCommand,
  needsShellSpawn: needsShellSpawn,
};
