#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTeeWithUi } = require('../../lib/agent/runner');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-ui-cancel-'));
const eventsFile = path.join(dir, 'events.ndjson');
fs.writeFileSync(eventsFile, '');

const child = {
  pid: 2147483647,
  stdout: { fd: -1 },
  on() {},
  kill() {},
};
const ui = {
  mode: 'tui',
  isCancelRequested() {
    return true;
  },
  onTeeEvent() {},
  setAgent() {},
  clearAgent() {},
  render() {},
  destroy() {},
};

runTeeWithUi(child, ui, 2_000, { eventsFile });
process.exit(99);
