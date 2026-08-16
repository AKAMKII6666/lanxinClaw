'use strict';

/**
 * Module: ui/terminalDismiss
 * Purpose: Terminal-state dismiss copy and blocking stdin wait for plain mode.
 */

const fs = require('fs');
const path = require('path');
const { STATUSES } = require('../fsm');
const { truncateText } = require('../consoleTheme');

function buildTerminalDismissMessage({ status, exFile, blockedReason } = {}) {
  const name = path.basename(String(exFile || '执行索引.md'));
  if (status === STATUSES.BLOCKED) {
    const reason = truncateText(String(blockedReason || '任务已阻断'), 120);
    return `任务已阻断：${reason}\n按任意键退出...`;
  }
  return `已经完成 ${name} 的所有内容，按任意键退出...`;
}

function waitForStdinKey() {
  if (!process.stdin.isTTY) return;
  const buf = Buffer.alloc(1);
  let wasRaw = false;
  try {
    if (typeof process.stdin.setRawMode === 'function') {
      wasRaw = process.stdin.isRaw();
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    fs.readSync(0, buf, 0, 1, null);
  } catch {
    /* Ignore stdin read failures in non-interactive shells. */
  } finally {
    try {
      if (typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(wasRaw);
      }
      process.stdin.pause();
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  buildTerminalDismissMessage,
  waitForStdinKey,
};
