'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../lib/parseArgs');
const { mergeConfig } = require('../lib/mergeConfig');
const { resolveConsoleUiMode } = require('../lib/ui/createConsoleWriter');
const { handleUiPipeLine, runTeeWithUi } = require('../lib/agent/runner');
const { createPlainWriter } = require('../lib/ui/plainWriter');
const {
  createTuiProcessProxy,
  waitUntilFileContent,
} = require('../lib/ui/tuiProcessProxy');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  tag,
  formatHeartbeatLine,
  TUI_LAYOUT,
} = require('../lib/ui/tuiApp');
const {
  normalizeSplashArt,
  fitSplashArt,
  loadSplashArt,
} = require('../lib/ui/splashArt');
const {
  buildTerminalDismissMessage,
} = require('../lib/ui/terminalDismiss');
const { STATUSES } = require('../lib/fsm');

describe('console UI mode', () => {
  it('parses --tui and --plain', () => {
    assert.equal(parseArgs(['--tui']).tui, true);
    assert.equal(parseArgs(['--plain']).plainConsole, true);
  });

  it('mergeConfig applies --plain', () => {
    const cfg = mergeConfig({ cli: { plainConsole: true } });
    assert.equal(cfg.console_ui.mode, 'plain');
  });

  it('keeps terminal-native text selection enabled by default', () => {
    const cfg = mergeConfig({ cli: {} });
    assert.equal(cfg.console_ui.mouse, false);
  });

  it('resolveConsoleUiMode respects quiet', () => {
    assert.equal(resolveConsoleUiMode('auto', true), 'plain');
  });

  it('Windows auto stays plain; explicit tui is not blocked by platform default', () => {
    if (process.platform !== 'win32') {
      return;
    }
    assert.equal(resolveConsoleUiMode('auto', false), 'plain');
    // Explicit tui: only TTY/CI gate remains. In non-TTY test runners → plain is OK;
    // when stdout/stderr are TTYs, must open tui (not the old win32 hard ban).
    const mode = resolveConsoleUiMode('tui', false);
    if (process.stdout.isTTY && process.stderr.isTTY && process.env.CI !== 'true' && process.env.CI !== '1') {
      assert.equal(mode, 'tui');
    } else {
      assert.equal(mode, 'plain');
    }
  });

  it('GBX_TUI=0 forces plain even for mode=tui', () => {
    const prev = process.env.GBX_TUI;
    process.env.GBX_TUI = '0';
    try {
      assert.equal(resolveConsoleUiMode('tui', false), 'plain');
    } finally {
      if (prev === undefined) delete process.env.GBX_TUI;
      else process.env.GBX_TUI = prev;
    }
  });

  it('handleUiPipeLine forwards activity to plain writer', () => {
    const lines = [];
    const ui = createPlainWriter();
    const orig = console.error;
    console.error = (t) => lines.push(t);
    try {
      handleUiPipeLine(
        `GBX\t${JSON.stringify({ kind: 'activity', role: 'fixer', label: 'fixer:T1', text: '编辑 foo.ts' })}`,
        ui,
      );
    } finally {
      console.error = orig;
    }
    assert.equal(lines.length, 0);
  });
});

describe('TUI visible layout', () => {
  it('reserves border rows in header and status bar heights', () => {
    assert.ok(TUI_LAYOUT.headerHeight - 2 >= TUI_LAYOUT.headerContentLines);
    assert.ok(TUI_LAYOUT.statusHeight - 2 >= TUI_LAYOUT.statusContentLines);
  });

  it('uses high-contrast tags instead of near-black gray-fg', () => {
    const value = tag('white', 'status', { dim: true });
    assert.doesNotMatch(value, /dim-fg/);
    assert.doesNotMatch(value, /gray-fg/);
    assert.match(value, /cyan-fg/);
  });

  it('formats heartbeat as a visible log line', () => {
    const line = formatHeartbeatLine({
      label: 'executor:T1',
      elapsed: 30,
      text: '读取 foo.ts',
    });
    assert.match(line, /executor:T1 仍在运行/);
    assert.match(line, /30s/);
    assert.match(line, /读取 foo\.ts/);
  });
});

describe('TUI startup splash', () => {
  it('trims the checked-in GBX artwork padding', () => {
    const artFile = path.join(__dirname, '..', 'image', 'ascii-art.txt');
    const art = loadSplashArt(artFile);
    const lines = art.split('\n');
    assert.ok(lines.length > 0 && lines.length < 30);
    assert.ok(lines[0].trim());
    assert.ok(lines.at(-1).trim());
    assert.equal(art, normalizeSplashArt(fs.readFileSync(artFile, 'utf8')));
  });

  it('fits artwork inside narrow terminal dimensions', () => {
    const artFile = path.join(__dirname, '..', 'image', 'ascii-art.txt');
    const fitted = fitSplashArt(loadSplashArt(artFile), 80, 16);
    const lines = fitted.split('\n');
    assert.ok(lines.length <= 16);
    assert.ok(lines.every((line) => Array.from(line).length <= 80));
    assert.equal(
      new Set(lines.map((line) => Array.from(line).length)).size,
      1,
      'all rows must stay equally wide so centered art does not shear',
    );
  });
});

describe('terminal dismiss', () => {
  it('builds success and blocked dismiss messages', () => {
    const ok = buildTerminalDismissMessage({
      status: STATUSES.READY_FOR_MANUAL_QA,
      exFile: '/tmp/项目第三步计划执行索引.md',
    });
    assert.match(ok, /已经完成 项目第三步计划执行索引\.md 的所有内容/);
    assert.match(ok, /按任意键退出/);

    const blocked = buildTerminalDismissMessage({
      status: STATUSES.BLOCKED,
      exFile: '/tmp/index.md',
      blockedReason: 'verify failed',
    });
    assert.match(blocked, /任务已阻断：verify failed/);
    assert.match(blocked, /按任意键退出/);
  });

  it('proxy awaitDismiss blocks until renderer acknowledges', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tui-dismiss-'));
    const probeFile = path.join(tmp, 'dismiss.log');
    const hostFile = path.join(__dirname, 'fixtures', 'tui-renderer-probe.js');
    const ui = createTuiProcessProxy({ probeFile }, { hostFile });

    try {
      ui.awaitDismiss({
        status: STATUSES.READY_FOR_MANUAL_QA,
        message: '已经完成 demo.md 的所有内容，按任意键退出...',
      });
      const output = fs.readFileSync(probeFile, 'utf8');
      assert.match(output, /dismiss:已经完成 demo\.md 的所有内容/);
    } finally {
      ui.destroy();
    }
  });
});

describe('TUI renderer process', () => {
  it('file transport returns as soon as a done event is observed', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tui-done-'));
    const eventsFile = path.join(tmp, 'events.ndjson');
    fs.writeFileSync(
      eventsFile,
      `GBX\t${JSON.stringify({
        kind: 'done',
        role: 'verify',
        label: 'verify:npm test',
        exitCode: 0,
        elapsed: 37,
      })}\n`,
    );
    let cleared = 0;
    let resetAfterDone = 0;
    const ui = {
      mode: 'tui',
      onTeeEvent(ev) {
        if (ev.kind === 'done') cleared += 1;
      },
      setAgent() {
        resetAfterDone += 1;
      },
      clearAgent() {
        cleared += 1;
      },
      render() {},
    };
    const child = {
      stdout: { fd: -1 },
      on() {},
      kill() {
        throw new Error('done event should finish without timeout kill');
      },
    };

    assert.equal(runTeeWithUi(child, ui, 2_000, { eventsFile }), 0);
    assert.equal(resetAfterDone, 0);
    assert.equal(cleared, 2);
  });

  it('file transport fails promptly when tee child dies without done', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tui-dead-'));
    const eventsFile = path.join(tmp, 'events.ndjson');
    fs.writeFileSync(eventsFile, '');
    const ui = {
      mode: 'tui',
      onTeeEvent() {},
      setAgent() {},
      clearAgent() {},
      render() {},
    };
    const child = {
      pid: 2147483647,
      stdout: { fd: -1 },
      on() {},
      kill() {
        throw new Error('dead child should not need killing');
      },
    };
    const started = Date.now();

    assert.equal(runTeeWithUi(child, ui, 2_000, { eventsFile }), 1);
    assert.ok(Date.now() - started < 500, 'dead child detection should not wait for timeout');
  });

  it('file wait fails promptly when renderer is no longer alive', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tui-wait-dead-'));
    const missing = path.join(tmp, 'never-created');
    const started = Date.now();

    assert.throws(
      () => waitUntilFileContent(missing, 'READY', {
        timeoutMs: 2_000,
        isAlive: () => false,
      }),
      /renderer exited/,
    );
    assert.ok(Date.now() - started < 500, 'renderer death should not wait for file timeout');
  });

  it('file renderer destroy waits for acknowledgement', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tui-destroy-'));
    const probeFile = path.join(tmp, 'destroy.log');
    const hostFile = path.join(__dirname, 'fixtures', 'tui-renderer-probe.js');
    const ui = createTuiProcessProxy({ probeFile }, { hostFile });
    const started = Date.now();

    ui.destroy();
    assert.ok(Date.now() - started < 1_000, 'destroy acknowledgement should be prompt');
  });

  it('file renderer exposes cancellation request to synchronous parent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tui-cancel-'));
    const probeFile = path.join(tmp, 'cancel.log');
    const hostFile = path.join(__dirname, 'fixtures', 'tui-renderer-probe.js');
    const ui = createTuiProcessProxy({ probeFile, cancelOnReady: true }, { hostFile });

    try {
      assert.equal(ui.isCancelRequested(), true);
    } finally {
      ui.destroy();
    }
  });

  it('TUI cancellation terminates the orchestrator with exit 130', () => {
    const fixture = path.join(__dirname, 'fixtures', 'run-ui-cancel-smoke.js');
    const result = spawnSync(process.execPath, [fixture], {
      encoding: 'utf8',
      timeout: 5_000,
    });

    assert.equal(result.status, 130);
    assert.match(result.stderr, /cancelled from TUI/);
  });

  it('renders independently while the orchestrator thread is blocked', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tui-probe-'));
    const probeFile = path.join(tmp, 'renders.log');
    const hostFile = path.join(__dirname, 'fixtures', 'tui-renderer-probe.js');
    const ui = createTuiProcessProxy({ probeFile }, { hostFile });

    try {
      ui.setAgent({ label: 'executor:T1', role: 'executor' });
      spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 250)']);
      const renders = fs.readFileSync(probeFile, 'utf8').trim().split('\n');
      assert.ok(renders.length >= 2, `expected independent renders, got ${renders.length}`);
    } finally {
      ui.destroy();
    }
  });

  it('forwards activity emitted while the orchestrator thread is blocked', {
    // runTeeWithUi uses readSync on pipe fd; Windows often exposes fd=-1 for Pipe wrappers.
    skip: process.platform === 'win32' ? 'runTeeWithUi sync pipe fd unreliable on Windows' : false,
  }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tui-events-'));
    const probeFile = path.join(tmp, 'events.log');
    const hostFile = path.join(__dirname, 'fixtures', 'tui-renderer-probe.js');
    const ui = createTuiProcessProxy({ probeFile }, { hostFile });
    const eventLine = `GBX\t${JSON.stringify({
      kind: 'activity',
      role: 'executor',
      label: 'executor:T1',
      text: '读取 foo.ts',
    })}\n`;
    const doneLine = `GBX\t${JSON.stringify({
      kind: 'done',
      role: 'executor',
      label: 'executor:T1',
      exitCode: 0,
      elapsed: 1,
    })}\n`;
    const source = spawn(
      process.execPath,
      [
        '-e',
        `setTimeout(() => process.stdout.write(${JSON.stringify(eventLine)}), 40);
         setTimeout(() => process.stdout.write(${JSON.stringify(doneLine)}), 120);
         setTimeout(() => process.exit(0), 180);`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    try {
      assert.equal(runTeeWithUi(source, ui, 2_000), 0);
      spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 80)']);
      assert.match(fs.readFileSync(probeFile, 'utf8'), /event:activity/);
    } finally {
      ui.destroy();
    }
  });
});
