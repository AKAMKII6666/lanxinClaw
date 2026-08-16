'use strict';

/**
 * Module: orchestrator
 * Purpose: Main FSM loop for general-batch-exe (Scheme B).
 */

const path = require('path');
const fs = require('fs');
const { loadExFile, splitFrontmatter } = require('./loadExFile');
const { mergeConfig } = require('./mergeConfig');
const {
  selectBatch,
  collectVerifyCommands,
  collectFullVerifyCommands,
  assertBatchChecked,
  todoTasks,
} = require('./tasks');
const {
  workflowPaths,
  loadOrInitState,
  patchState,
  appendLog,
  ensureWorkflowDirs,
  readState,
} = require('./stateStore');
const { STATUSES, isTerminal, exitCodeForStatus } = require('./fsm');
const {
  readLatestReview,
  decideAfterReview,
  decideAfterVerify,
} = require('./reviewDecision');
const { runVerifyCommands } = require('./verify');
const {
  loadLatestVerify,
  formatBlockedVerifyReport,
  buildVerifyExcerptForPrompt,
  summarizeVerify,
} = require('./verifyReport');
const { checkHardStop } = require('./hardStop');
const {
  archiveLatestReview,
  resolveClearBlockedNext,
} = require('./clearBlocked');
const { checkCheckpointPreflight, createCheckpoint } = require('./gitCheckpoint');
const { buildPrompt } = require('./prompts');
const { runCursorAgent, commandExists, resolveAgentPermissions } = require('./agent/runner');
const { runMockAgent } = require('./agent/mockRunner');
const { truncate } = require('./util/truncate');
const {
  createRecoveryRunId,
  readJson,
  clearFile,
  evaluateBlockAnalysis,
  captureProjectSnapshot,
  changedPaths,
  evaluateRepairChanges,
} = require('./blockRecovery');
const { createReviewRunId,
  clearLatestReview,
  validateReviewReport,
} = require('./validation/reviewReport');
const { createTheme, printBlockRecovery } = require('./consoleTheme');
const { createConsoleWriter } = require('./ui/createConsoleWriter');
const { gbxLog, gbxErr, gbxMultiline } = require('./ui/emit');
const { buildTerminalDismissMessage } = require('./ui/terminalDismiss');

/** Cross-platform no-op success command for mock verify. */
const MOCK_OK_CMD = 'node -e "process.exit(0)"';
const SKILL_ROOT = path.resolve(__dirname, '..');

function isRecoveryStatus(status) {
  return (
    status === STATUSES.BLOCK_ANALYZE ||
    status === STATUSES.BLOCK_REPAIR ||
    status === STATUSES.BLOCK_VERIFY
  );
}

function assertReadFirst(loaded) {
  const missing = loaded.readFirstStatus.filter((r) => !r.exists);
  if (missing.length) {
    const list = missing.map((r) => r.path).join(', ');
    const err = new Error(`read_first missing under --workdir: ${list}`);
    err.code = 'READ_FIRST_MISSING';
    throw err;
  }
}

function assertHasVerify(loaded) {
  if (!loaded.config.verify_default.length && !loaded.tasks.some((t) => t.verify)) {
    const err = new Error('no verify_default and no task-level verify');
    err.code = 'VERIFY_MISSING';
    throw err;
  }
}

function printDryRun(loaded, workdir) {
  const batch = selectBatch(loaded.tasks, {
    batchSize: loaded.config.batch_size,
    group: loaded.config.group,
  });
  const verify = collectVerifyCommands(batch, loaded.config.verify_default);
  console.log('[gbx] dry-run parse OK');
  console.log(`  exFile: ${loaded.exAbs}`);
  console.log(`  workdir: ${workdir}`);
  console.log(`  adapter: ${loaded.adapter}`);
  console.log(`  tasks: ${loaded.tasks.length} (todo=${todoTasks(loaded.tasks).length})`);
  console.log(`  batch_size: ${loaded.config.batch_size}`);
  console.log(`  next batch IDs: ${batch.map((t) => t.id).join(', ') || '(none)'}`);
  console.log(`  verify: ${verify.join(' | ') || '(none)'}`);
  console.log(`  workflow_dir: ${loaded.config.workflow_dir}`);
  console.log(`  enable_checkpoint: ${Boolean(loaded.config.enable_checkpoint)}`);
  console.log('  read_first:');
  for (const r of loaded.readFirstStatus) {
    console.log(`    ${r.exists ? 'OK' : 'MISSING'}  ${r.path}`);
  }
  try {
    assertReadFirst(loaded);
    assertHasVerify(loaded);
  } catch (e) {
    console.error(`[gbx] dry-run error: ${e.message}`);
    return 1;
  }
  if (todoTasks(loaded.tasks).length === 0) {
    console.log('[gbx] dry-run note: no todo tasks (would go to FULL_REVIEW if run)');
  }
  return 0;
}

function runAgent(role, { mock, config, promptCtx, paths, state, workdir, theme }) {
  const fixTrigger = state && state.fixTrigger ? state.fixTrigger : null;
  const latestVerify = loadLatestVerify(paths);
  const needsVerifyExcerpt =
    !fixTrigger || String(fixTrigger).includes('verify') || role === 'fixer' || role === 'final-fixer';
  const enrichedCtx = {
    ...promptCtx,
    fixTrigger,
    latestVerifyPath: paths.latestVerify,
    verifyExcerpt: needsVerifyExcerpt
      ? buildVerifyExcerptForPrompt(latestVerify)
      : '(not injected)',
  };

  if (mock || config.mock_agent) {
    if (!config.quiet) {
      console.error(
        `[gbx] mock agent role=${role} batch=${(enrichedCtx.batchIds || []).join(',') || '-'} trigger=${fixTrigger || '-'}`,
      );
    }
    return runMockAgent({ role, ctx: enrichedCtx, paths, state });
  }
  const prompt = buildPrompt(role, enrichedCtx);
  const promptDir = path.join(paths.root, 'prompts');
  const batchIds = enrichedCtx.batchIds || [];
  const activeTheme = theme || paths._theme;
  const themeOpts = {
    enabled: config.console_theme?.enabled !== false,
    color: config.console_theme?.color !== false,
  };
  if (activeTheme && activeTheme.color === false) {
    themeOpts.color = false;
  }
  return runCursorAgent({
    command: config.agent.command,
    printFlag: config.agent.print_flag || '-p',
    outputFormat: config.agent.output_format || 'stream-json',
    streamPartialOutput: Boolean(config.agent.stream_partial_output),
    agentPermissions: resolveAgentPermissions(config.agent),
    prompt,
    workdir,
    promptDir,
    quiet: Boolean(config.quiet),
    heartbeatMs: config.heartbeat_ms == null ? 15_000 : config.heartbeat_ms,
    label: `${role}${batchIds.length ? `:${batchIds.join('+')}` : ''}`,
    role,
    themeOptions: themeOpts,
    consoleTheme: config.console_theme,
    uiWriter: paths._ui || null,
    bannerCtx: {
      batchIds,
      taskIds: batchIds,
      fixTrigger,
      recoveryAttempt: state?.recoveryAttempts,
      recoveryMax: config.block_recovery?.max_attempts,
      recoveryKind: enrichedCtx.recoveryKind || state?.recoveryKind,
      approvedPaths:
        enrichedCtx.recoveryApprovedPaths || state?.recoveryApprovedPaths || [],
      workdir,
    },
  });
}

function emitBlockedVerify(paths, state, blockedReason) {
  const report = loadLatestVerify(paths);
  const text = formatBlockedVerifyReport({
    blockedReason,
    state,
    report,
    latestVerifyPath: paths.latestVerify,
    latestReviewPath: paths.latestReview,
  });
  gbxMultiline(paths, text, 'log');
  appendLog(paths, text.replace(/\n/g, ' | '));
}

function clearFixBookkeepingPartial() {
  return {
    fixTrigger: null,
    ineffectiveFixStreak: 0,
  };
}

function clearRecoveryBookkeepingPartial() {
  return {
    recoveryOriginStatus: null,
    recoveryResumeState: null,
    recoveryOriginReason: null,
    recoveryKind: null,
    recoveryAnalysisRunId: null,
    recoveryAnalysisReportPath: null,
    recoveryApprovedPaths: [],
  };
}

function beginRecovery(paths, state, cfg, { reason, originStatus, resumeState }) {
  const recovery = cfg.block_recovery || {};
  const attempts = state.recoveryAttempts || 0;
  if (recovery.enabled !== true || attempts >= recovery.max_attempts) {
    const suffix =
      recovery.enabled === true
        ? `; block recovery budget exhausted (${attempts}/${recovery.max_attempts})`
        : '; automatic block recovery disabled';
    return patchState(paths, {
      status: STATUSES.BLOCKED,
      blockedReason: `${reason}${suffix}`,
    });
  }
  if (paths._theme && !cfg.quiet) {
    const verify = loadLatestVerify(paths);
    printBlockRecovery(paths._theme, 'analyze-start', {
      reason,
      fingerprint:
        verify?.failedCommand ||
        (verify?.errorLocations && verify.errorLocations[0]) ||
        verify?.reason ||
        reason,
      attempt: attempts,
      maxAttempts: recovery.max_attempts,
      workdir: paths._workdir,
    }, paths);
  }
  appendLog(
    paths,
    `block recovery scheduled origin=${originStatus} resume=${resumeState} attempts=${attempts}/${recovery.max_attempts}: ${reason}`,
  );
  return patchState(paths, {
    status: STATUSES.BLOCK_ANALYZE,
    blockedReason: null,
    recoveryOriginStatus: originStatus,
    recoveryResumeState: resumeState,
    recoveryOriginReason: reason,
    recoveryKind: null,
    recoveryAnalysisRunId: null,
    recoveryAnalysisReportPath: null,
    recoveryApprovedPaths: [],
    skipHardStopOnce: true,
  });
}

function validateRepairReport(report, repairRunId) {
  if (!report || typeof report !== 'object') {
    return { ok: false, reason: '阻断修复报告缺失或不是有效 JSON' };
  }
  if (
    report.schemaVersion !== 1 ||
    report.role !== 'block-resolver' ||
    report.repairRunId !== repairRunId
  ) {
    return { ok: false, reason: '阻断修复报告不是当前恢复轮次生成' };
  }
  if (report.result !== 'repaired' && report.result !== 'needs_human') {
    return { ok: false, reason: '阻断修复报告 result 无效' };
  }
  if (
    typeof report.summary !== 'string' ||
    !Array.isArray(report.changedPaths) ||
    report.changedPaths.some(
      (candidate) => typeof candidate !== 'string' || candidate.trim() === '',
    ) ||
    !['none', 'install_declared'].includes(report.dependencyAction)
  ) {
    return { ok: false, reason: '阻断修复报告字段缺失或类型无效' };
  }
  return { ok: true, report };
}

/**
 * After VERIFY_*: update STATE fields, apply ineffective-fix melt, set fixTrigger when looping to FIX.
 * @param {{ checkboxMissing?: boolean, missingIds?: string[] }} [extra]
 */
function patchAfterVerifyFailure(state, cfg, { v, decision, phase, checkboxMissing, missingIds }) {
  if (checkboxMissing) {
    const goingToFix =
      decision.next === STATUSES.FIX_BATCH || decision.next === STATUSES.FULL_FIX;
    return {
      lastVerifyOk: true,
      lastVerifySummary: `verify ok; checkbox missing: ${(missingIds || []).join(',') || '(none)'}`,
      lastVerifyFingerprint: null,
      lastVerifyReportPath: null,
      ineffectiveFixStreak: 0,
      status: decision.next,
      blockedReason: decision.next === STATUSES.BLOCKED ? decision.reason : null,
      fixTrigger:
        goingToFix || decision.next === STATUSES.BLOCKED
          ? 'checkbox_missing'
          : state.fixTrigger || null,
    };
  }

  const report = v.report || null;
  const fingerprint = v.fingerprint || null;
  let streak = state.ineffectiveFixStreak || 0;

  if (
    fingerprint &&
    state.lastVerifyFingerprint &&
    fingerprint === state.lastVerifyFingerprint &&
    ((state.batchFixAttempts || 0) > 0 || (state.fullFixAttempts || 0) > 0)
  ) {
    streak += 1;
  } else if (fingerprint && fingerprint !== state.lastVerifyFingerprint) {
    streak = 0;
  }

  const maxIneffective = cfg.max_ineffective_fixes != null ? cfg.max_ineffective_fixes : 2;
  let next = decision.next;
  let reason = decision.reason;
  if (
    !v.ok &&
    streak >= maxIneffective &&
    (next === STATUSES.FIX_BATCH || next === STATUSES.FULL_FIX || next === STATUSES.BLOCKED)
  ) {
    next = STATUSES.BLOCKED;
    reason = `ineffective fix loop; verify still failing with same fingerprint (${streak}/${maxIneffective})`;
  }

  const trigger = phase === 'full' ? 'full_verify_fail' : 'verify_fail';
  const goingToFix = next === STATUSES.FIX_BATCH || next === STATUSES.FULL_FIX;

  return {
    lastVerifyOk: false,
    lastVerifySummary: summarizeVerify(report),
    lastVerifyFingerprint: fingerprint,
    lastVerifyReportPath: null, // filled by caller with paths.latestVerify
    ineffectiveFixStreak: streak,
    status: next,
    blockedReason: next === STATUSES.BLOCKED ? reason : null,
    fixTrigger: goingToFix ? trigger : next === STATUSES.BLOCKED ? state.fixTrigger || trigger : null,
  };
}

function applyAgentPersist(paths, agentResult) {
  if (agentResult && agentResult.persist) {
    return patchState(paths, agentResult.persist);
  }
  return null;
}

function reload(exRel, workdir, configPath, cli) {
  return loadExFile({ exFile: exRel, workdir, configPath, cli });
}

function resetWorkflowState(paths) {
  if (fs.existsSync(paths.state)) {
    fs.unlinkSync(paths.state);
  }
}

function workflowExcludePaths(workdir, paths) {
  return [path.relative(workdir, paths.root)];
}

function blockForAgentFailure(paths, state, role, result, cfg, resumeState) {
  appendLog(paths, `${role} failed exit=${result.exitCode}`);
  const withOutput = patchState(paths, {
    lastAgentStdout: truncate(result.stdout),
    lastAgentStderr: truncate(result.stderr),
  });
  return beginRecovery(paths, withOutput, cfg, {
    reason: `${role} failed (exit ${result.exitCode}${result.error ? `: ${result.error}` : ''})`,
    originStatus: state.status,
    resumeState,
  });
}

function mockVerifyCmds(cmds, cli) {
  if (cli.mockAgent && process.env.GBX_MOCK_REAL_VERIFY !== '1') {
    return cmds.length ? [MOCK_OK_CMD] : [];
  }
  return cmds;
}

function attemptPreflightIndexRecovery({ cli, workdir, loadError }) {
  const exAbs = path.resolve(workdir, cli.exFile);
  if (!fs.existsSync(exAbs)) return { ok: false, reason: loadError.message };
  try {
    const parsed = splitFrontmatter(fs.readFileSync(exAbs, 'utf8'));
    if (
      parsed.frontmatter.block_recovery &&
      parsed.frontmatter.block_recovery.enabled === false
    ) {
      return {
        ok: false,
        reason: 'execution index explicitly disables block_recovery',
      };
    }
  } catch {
    // Broken YAML/frontmatter is itself a supported preflight recovery target.
  }

  const config = mergeConfig({
    cli,
    frontmatter: {
      workflow_dir: '.ai-workflow-preflight',
      block_recovery: {
        enabled: true,
        max_attempts: 1,
        require_declared_scope: false,
      },
    },
  });
  if (!cli.mockAgent && !config.mock_agent && !commandExists(config.agent.command)) {
    if (config.agent.command === 'cursor-agent' && commandExists('agent')) {
      config.agent.command = 'agent';
    } else if (config.agent.command === 'agent' && commandExists('cursor-agent')) {
      config.agent.command = 'cursor-agent';
    } else {
      return {
        ok: false,
        reason: `${loadError.message}; preflight recovery agent command not found: ${config.agent.command}`,
      };
    }
  }

  const paths = workflowPaths(workdir, config.workflow_dir);
  ensureWorkflowDirs(paths);
  const exRelative = path.relative(workdir, exAbs).split(path.sep).join('/');
  const analysisRunId = createRecoveryRunId('preflight-analysis');
  clearFile(paths.latestBlockAnalysis);
  const promptCtx = {
    exAbs,
    workdir,
    workflowDir: config.workflow_dir,
    batchIds: [],
    batchNumber: 0,
    config,
    readFirstStatus: [],
    analysisRunId,
    recoveryOriginStatus: 'PREFLIGHT',
    recoveryOriginReason: `execution index load failed (${loadError.code || 'ERROR'}): ${loadError.message}`,
    latestVerifyPath: paths.latestVerify,
    latestBlockAnalysisPath: paths.latestBlockAnalysis,
    preflightIndexRecovery: true,
  };
  const analysisResult = runAgent('block-analyzer', {
    mock: cli.mockAgent,
    config,
    promptCtx,
    paths,
    state: { fixTrigger: null, activeTaskIds: [] },
    workdir,
  });
  if (!analysisResult.ok) {
    return { ok: false, reason: 'execution index preflight analyzer failed' };
  }
  const report = readJson(paths.latestBlockAnalysis);
  const policy = evaluateBlockAnalysis({
    report,
    analysisRunId,
    config,
    workdir,
    activeTaskIds: [],
    skillRoot: SKILL_ROOT,
  });
  if (
    !policy.ok ||
    policy.report.kind !== 'INDEX_SCHEMA_CORRUPTION' ||
    policy.report.requiredPaths.length !== 1 ||
    policy.report.requiredPaths[0] !== exRelative
  ) {
    return {
      ok: false,
      reason: policy.reason || 'execution index preflight repair scope was not exactly --exFile',
    };
  }

  const repairRunId = createRecoveryRunId('preflight-repair');
  clearFile(paths.latestBlockRepair);
  const before = captureProjectSnapshot(workdir, [`${config.workflow_dir}/**`]);
  const repairResult = runAgent('block-resolver', {
    mock: cli.mockAgent,
    config,
    promptCtx: {
      ...promptCtx,
      repairRunId,
      latestBlockRepairPath: paths.latestBlockRepair,
      recoveryRootCause: policy.report.rootCause,
      recoveryKind: policy.report.kind,
      recoveryApprovedPaths: policy.report.requiredPaths,
      recoveryRecommendedAction: policy.report.recommendedAction,
    },
    paths,
    state: { fixTrigger: null, activeTaskIds: [] },
    workdir,
  });
  const after = captureProjectSnapshot(workdir, [`${config.workflow_dir}/**`]);
  const scopeCheck = evaluateRepairChanges({
    changed: changedPaths(before, after),
    approvedPaths: policy.report.requiredPaths,
    workflowDir: config.workflow_dir,
  });
  if (!scopeCheck.ok) {
    return { ok: false, reason: scopeCheck.reason };
  }
  if (!repairResult.ok) {
    return { ok: false, reason: 'execution index preflight resolver failed' };
  }
  const repairReport = validateRepairReport(
    readJson(paths.latestBlockRepair),
    repairRunId,
  );
  if (!repairReport.ok || repairReport.report.result !== 'repaired') {
    return {
      ok: false,
      reason: repairReport.reason || repairReport.report.summary || 'preflight repair declined',
    };
  }
  appendLog(paths, `preflight execution index recovery completed: ${exRelative}`);
  return { ok: true, reason: 'execution index repaired' };
}

function runOrchestrator(cli) {
  const workdir = path.resolve(cli.workdir || process.cwd());
  if (!cli.exFile) {
    console.error('error: --exFile is required');
    return 1;
  }

  let loaded;
  try {
    loaded = loadExFile({
      exFile: cli.exFile,
      workdir,
      configPath: cli.config,
      cli,
    });
  } catch (e) {
    if (cli.dryRun) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    const preflight = attemptPreflightIndexRecovery({
      cli,
      workdir,
      loadError: e,
    });
    if (!preflight.ok) {
      console.error(`error: ${e.message}`);
      console.error(`[gbx] preflight block recovery declined: ${preflight.reason}`);
      return 1;
    }
    console.error('[gbx] execution index repaired by preflight block recovery; reloading');
    try {
      loaded = loadExFile({
        exFile: cli.exFile,
        workdir,
        configPath: cli.config,
        cli,
      });
    } catch (retryError) {
      console.error(`error: execution index still invalid after recovery: ${retryError.message}`);
      return 1;
    }
  }

  if (cli.dryRun) {
    return printDryRun(loaded, workdir);
  }

  try {
    assertReadFirst(loaded);
    assertHasVerify(loaded);
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 1;
  }

  if (!cli.mockAgent && !loaded.config.mock_agent) {
    let cmd = loaded.config.agent.command;
    if (!commandExists(cmd)) {
      if (cmd === 'cursor-agent' && commandExists('agent')) {
        cmd = 'agent';
        loaded.config.agent.command = 'agent';
        console.error('[gbx] agent command: cursor-agent missing; using `agent`');
      } else if (cmd === 'agent' && commandExists('cursor-agent')) {
        cmd = 'cursor-agent';
        loaded.config.agent.command = 'cursor-agent';
        console.error('[gbx] agent command: agent missing; using `cursor-agent`');
      } else {
        console.error(
          `error: agent command not found: ${cmd}. Install Cursor CLI, set GBX_AGENT_CMD, or use --mock-agent.`,
        );
        return 1;
      }
    }
  }

  const paths = workflowPaths(workdir, loaded.config.workflow_dir);
  ensureWorkflowDirs(paths);
  const theme = createTheme({
    enabled: loaded.config.console_theme?.enabled !== false,
    color: !cli.noColor && loaded.config.console_theme?.color !== false,
  });
  paths._theme = theme;
  paths._workdir = workdir;

  const quietMode = Boolean(loaded.config.quiet);
  const uiMode =
    cli.consoleUi ||
    loaded.config.console_ui?.mode ||
    (cli.plainConsole ? 'plain' : 'auto');
  paths._ui = createConsoleWriter({
    mode: uiMode,
    quiet: quietMode,
    title: `gbx v${require(path.join(SKILL_ROOT, 'package.json')).version}`,
    exFile: loaded.exAbs,
    workflow: paths.root,
    mouse: loaded.config.console_ui?.mouse !== false,
    showShortcuts: loaded.config.console_ui?.show_shortcuts !== false,
  });
  paths._ui.setHeader({
    title: `gbx`,
    exFile: loaded.exAbs,
    workflow: paths.root,
  });
  paths._ui.setFsm({
    reportPaths: {
      latestVerify: paths.latestVerify,
      latestBlockRepair: paths.latestBlockRepair,
      latestBlockAnalysis: paths.latestBlockAnalysis,
    },
  });

  if (cli.resetState) {
    resetWorkflowState(paths);
    appendLog(paths, 'reset-state: removed STATE.json');
    console.log('[gbx] --reset-state: cleared STATE.json');
  }

  let state;
  try {
    state = loadOrInitState(paths, { exFile: loaded.exAbs });
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 1;
  }

  if (cli.clearBlocked) {
    if (state.status !== STATUSES.BLOCKED) {
      console.error(
        `error: --clear-blocked requires STATUS=BLOCKED (current=${state.status}). Use --reset-state for a full restart.`,
      );
      return 1;
    }
    loaded = reload(cli.exFile, workdir, cli.config, cli);
    const priorActive = Array.isArray(state.activeTaskIds) ? [...state.activeTaskIds] : [];
    const priorFixTrigger = state.fixTrigger || null;
    const archived = archiveLatestReview(paths.latestReview, paths.reviews);
    if (archived) {
      console.error(`[gbx] --clear-blocked: archived stale review → ${archived}`);
    }
    const resolved = resolveClearBlockedNext({
      tasks: loaded.tasks,
      activeTaskIds: priorActive,
      fixTrigger: priorFixTrigger,
      afterManual: Boolean(cli.afterManual),
    });
    state = patchState(paths, {
      status: resolved.next,
      blockedReason: null,
      lastAgentStdout: '',
      lastAgentStderr: '',
      activeTaskIds: resolved.activeTaskIds,
      // Keep fixTrigger when resuming FIX_BATCH so Fixer prompt still knows why.
      fixTrigger:
        resolved.next === STATUSES.FIX_BATCH || resolved.next === STATUSES.FULL_FIX
          ? resolved.fixTrigger || priorFixTrigger
          : null,
      batchFixAttempts: 0,
      fullFixAttempts: 0,
      checkboxFixAttempts: 0,
      ineffectiveFixStreak: 0,
      recoveryAttempts: 0,
      ...clearRecoveryBookkeepingPartial(),
      skipHardStopOnce: true,
    });
    appendLog(
      paths,
      `clear-blocked afterManual=${Boolean(cli.afterManual)} → ${resolved.next} (${resolved.reason})`,
    );
    console.error(
      `[gbx] --clear-blocked${cli.afterManual ? ' --after-manual' : ''}: was BLOCKED; now ${resolved.next}`,
    );
    console.error(`[gbx]   reason: ${resolved.reason}`);
    console.error(
      `[gbx]   todos=${todoTasks(loaded.tasks).length}; activeTaskIds=${resolved.activeTaskIds.join(',') || '-'}; stdout+latest.json cleared/archived`,
    );
  }

  if (
    !cli.clearBlocked &&
    state.status === STATUSES.BLOCKED &&
    loaded.config.block_recovery.enabled === true &&
    !state.recoveryAnalysisRunId &&
    /verify|fix attempts|fix budget|checkbox_missing|hard_stop/i.test(
      String(state.blockedReason || ''),
    )
  ) {
    const isFull = String(state.fixTrigger || '').startsWith('full_');
    state = beginRecovery(paths, state, loaded.config, {
      reason: state.blockedReason,
      originStatus: STATUSES.BLOCKED,
      resumeState: isFull ? STATUSES.FULL_VERIFY : STATUSES.VERIFY_BATCH,
    });
    console.error(
      `[gbx] existing recoverable BLOCKED state reopened → ${state.status}`,
    );
  }

  const checkpointOptions = {
    enabled: Boolean(loaded.config.enable_checkpoint),
    requireClean: loaded.config.checkpoint_require_clean !== false,
    excludePaths: workflowExcludePaths(workdir, paths),
  };
  const checkpointPreflight = checkCheckpointPreflight(workdir, checkpointOptions);
  appendLog(
    paths,
    `checkpoint preflight skipped=${checkpointPreflight.skipped} ${checkpointPreflight.reason || ''}`,
  );
  if (checkpointPreflight.error) {
    state = patchState(paths, {
      status: STATUSES.BLOCKED,
      blockedReason: checkpointPreflight.reason,
    });
  }
  appendLog(paths, `start status=${state.status} mock=${Boolean(cli.mockAgent)}`);

  const maxIterations = loaded.config.max_rounds || 40;
  if (!quietMode) {
    gbxErr(
      paths,
      paths._ui.mode === 'tui'
        ? `[gbx] TUI dashboard ON. Use --plain for line console. workflow=${paths.root}`
        : `[gbx] live console ON (default). Use --quiet for capture-only. workflow=${paths.root}`,
    );
  }

  let exitResult = null;
  let terminalDismissContext = null;
  try {
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    state = patchState(paths, { iteration });
    appendLog(paths, `iter=${iteration} status=${state.status}`);
    paths._ui.setFsm({
      iteration,
      status: state.status,
      taskIds: state.activeTaskIds || [],
      batchIds: state.activeTaskIds || [],
      recovery:
        state.recoveryAttempts != null && loaded.config.block_recovery?.max_attempts
          ? {
              current: (state.recoveryAttempts || 0) + 1,
              max: loaded.config.block_recovery.max_attempts,
            }
          : null,
      recoveryKind: state.recoveryKind || null,
    });
    gbxLog(paths, `[gbx] Iteration=${iteration} Status=${state.status}`);
    if (!quietMode && state.activeTaskIds && state.activeTaskIds.length) {
      gbxErr(paths, `[gbx] activeTaskIds=${state.activeTaskIds.join(',')}`);
    }

    if (isTerminal(state.status)) {
      paths._ui.setFsm({
        terminalStatus: state.status,
        blockedReason: state.blockedReason || null,
      });
      gbxLog(paths, `[gbx] terminal: ${state.status}`);
      if (state.status === STATUSES.READY_FOR_MANUAL_QA) {
        gbxLog(paths, `[gbx] Manual QA required. workflow: ${paths.root}`);
      }
      if (state.blockedReason) {
        gbxLog(paths, `[gbx] blockedReason: ${state.blockedReason}`);
      }
      if (state.recoveryAnalysisReportPath) {
        gbxLog(
          paths,
          `[gbx] blockAnalysisReport: ${state.recoveryAnalysisReportPath}`,
        );
      }
      if (
        state.status === STATUSES.BLOCKED &&
        state.blockedReason &&
        /verify|ineffective fix/i.test(state.blockedReason)
      ) {
        emitBlockedVerify(paths, state, state.blockedReason);
      }
      terminalDismissContext = {
        status: state.status,
        exFile: loaded.exAbs,
        blockedReason: state.blockedReason || null,
        message: buildTerminalDismissMessage({
          status: state.status,
          exFile: loaded.exAbs,
          blockedReason: state.blockedReason,
        }),
      };
      exitResult = exitCodeForStatus(state.status);
      break;
    }

    const recoveryStatus = isRecoveryStatus(state.status);
    /*
     * v0.6.0 could recursively hard-stop inside BLOCK_REPAIR and overwrite the
     * original resume target with a recovery state. Heal persisted states so a
     * restart can finish the interrupted recovery instead of ending BLOCKED.
     */
    if (recoveryStatus && isRecoveryStatus(state.recoveryResumeState)) {
      const repairedResume = String(state.fixTrigger || '').startsWith('full_')
        ? STATUSES.FULL_VERIFY
        : STATUSES.VERIFY_BATCH;
      appendLog(
        paths,
        `repaired recursive recovery resume ${state.recoveryResumeState} → ${repairedResume}`,
      );
      state = patchState(paths, {
        recoveryResumeState: repairedResume,
        recoveryOriginStatus: state.recoveryOriginStatus || state.status,
      });
    }
    if (!recoveryStatus) {
      try {
        loaded = reload(cli.exFile, workdir, cli.config, cli);
      } catch (error) {
        state = beginRecovery(paths, state, loaded.config, {
          reason: `execution index reload failed (${error.code || 'ERROR'}): ${error.message}`,
          originStatus: state.status,
          resumeState: state.status,
        });
        continue;
      }
    }
    const cfg = loaded.config;

    const review = readLatestReview(paths.latestReview);
    /*
     * Recovery prompts and reports must quote the original block reason. Scanning
     * those states would treat that quotation as a fresh violation and bounce
     * BLOCK_REPAIR back to BLOCK_ANALYZE before the resolver can run.
     */
    if (recoveryStatus) {
      appendLog(paths, `hard_stop scan bypassed during ${state.status}`);
    } else if (state.skipHardStopOnce) {
      state = patchState(paths, { skipHardStopOnce: false });
      if (!quietMode) {
        console.error(
          '[gbx] hard_stop: skipped once while resuming a cleared/recovered block',
        );
      }
    } else {
      const hs = checkHardStop(
        [state.lastAgentStdout, state.lastAgentStderr, review ? JSON.stringify(review) : ''],
        cfg.hard_stop_patterns,
      );
      if (hs.hit) {
        const reason = `hard_stop matched ${hs.pattern}: ${hs.snippet}`;
        console.error(`[gbx] ${reason}`);
        if (hs.context) {
          console.error(`[gbx] hard_stop context: …${hs.context}…`);
        }
        console.error(
          '[gbx] hint: if this is a "we do NOT implement X" mention, patterns should use action verbs; or re-run with --clear-blocked [--after-manual] after fixing patterns.',
        );
        state = beginRecovery(paths, state, cfg, {
          reason,
          originStatus: state.status,
          resumeState: state.status,
        });
        continue;
      }
      if (hs.skippedNegations > 0 && !quietMode) {
        console.error(
          `[gbx] hard_stop: skipped ${hs.skippedNegations} negated mention(s) (out-of-scope wording)`,
        );
      }
    }

    const batch = selectBatch(loaded.tasks, {
      batchSize: cfg.batch_size,
      group: cfg.group,
    });
    const batchIds =
      state.activeTaskIds && state.activeTaskIds.length
        ? state.activeTaskIds
        : batch.map((t) => t.id);

    const promptCtx = {
      exAbs: loaded.exAbs,
      workdir,
      workflowDir: cfg.workflow_dir,
      batchIds,
      batchNumber: state.currentBatch,
      config: cfg,
      readFirstStatus: loaded.readFirstStatus,
    };

    switch (state.status) {
      case STATUSES.EXECUTE_BATCH: {
        if (todoTasks(loaded.tasks).length === 0) {
          state = patchState(paths, {
            status: STATUSES.FULL_REVIEW,
            activeTaskIds: [],
          });
          break;
        }
        const selected = selectBatch(loaded.tasks, {
          batchSize: cfg.batch_size,
          group: cfg.group,
        });
        const ids = selected.map((t) => t.id);

        state = patchState(paths, { activeTaskIds: ids });
        promptCtx.batchIds = ids;
        const execResult = runAgent('executor', {
          mock: cli.mockAgent,
          config: cfg,
          promptCtx,
          paths,
          state,
          workdir,
        });
        applyAgentPersist(paths, execResult);

        if (!execResult.ok && !cfg.continue_on_executor_fail) {
          appendLog(paths, `executor failed exit=${execResult.exitCode}`);
          const withOutput = patchState(paths, {
            lastAgentStdout: truncate(execResult.stdout),
            lastAgentStderr: truncate(execResult.stderr),
          });
          state = beginRecovery(paths, withOutput, cfg, {
            reason: `executor failed (exit ${execResult.exitCode}${execResult.error ? `: ${execResult.error}` : ''})`,
            originStatus: STATUSES.EXECUTE_BATCH,
            resumeState: STATUSES.EXECUTE_BATCH,
          });
          break;
        }

        state = patchState(paths, {
          lastAgentStdout: truncate(execResult.stdout),
          lastAgentStderr: truncate(execResult.stderr),
          status: STATUSES.BATCH_REVIEW,
        });
        if (!execResult.ok) {
          appendLog(paths, `executor exit ${execResult.exitCode} — continue_on_executor_fail`);
        }
        break;
      }

      case STATUSES.BATCH_REVIEW: {
        const reviewRunId = createReviewRunId('batch-reviewer', state.currentBatch);
        clearLatestReview(paths.latestReview);
        promptCtx.reviewRunId = reviewRunId;
        const revResult = runAgent('batch-reviewer', {
          mock: cli.mockAgent,
          config: cfg,
          promptCtx,
          paths,
          state,
          workdir,
        });
        applyAgentPersist(paths, revResult);
        if (!revResult.ok) {
          state = blockForAgentFailure(
            paths,
            state,
            'batch-reviewer',
            revResult,
            cfg,
            STATUSES.BATCH_REVIEW,
          );
          break;
        }
        state = patchState(paths, {
          lastAgentStdout: truncate(revResult.stdout),
          lastAgentStderr: truncate(revResult.stderr),
        });
        state = readState(paths) || state;
        const report = readLatestReview(paths.latestReview);
        const validation = validateReviewReport(report, {
          role: 'batch-reviewer',
          batchId: state.currentBatch,
          reviewRunId,
        });
        if (!validation.ok) {
          state = beginRecovery(paths, state, cfg, {
            reason: validation.reason,
            originStatus: STATUSES.BATCH_REVIEW,
            resumeState: STATUSES.BATCH_REVIEW,
          });
          break;
        }
        const decision = decideAfterReview(validation.report, {
          phase: 'batch',
          batchFixAttempts: state.batchFixAttempts,
          maxFixAttempts: cfg.max_fix_attempts,
          hasRemainingTodos: false,
        });
        appendLog(paths, `batch review → ${decision.next} (${decision.reason})`);
        if (decision.next === STATUSES.BLOCKED) {
          state = beginRecovery(paths, state, cfg, {
            reason: decision.reason,
            originStatus: STATUSES.BATCH_REVIEW,
            resumeState: STATUSES.VERIFY_BATCH,
          });
          break;
        }
        state = patchState(paths, {
          status: decision.next,
          blockedReason: null,
          fixTrigger: decision.next === STATUSES.FIX_BATCH ? 'review_fail' : state.fixTrigger,
        });
        break;
      }

      case STATUSES.FIX_BATCH: {
        const isCheckbox = state.fixTrigger === 'checkbox_missing';
        const maxCheckbox =
          cfg.max_checkbox_fix_attempts != null ? cfg.max_checkbox_fix_attempts : 2;
        if (isCheckbox) {
          if ((state.checkboxFixAttempts || 0) >= maxCheckbox) {
            const reason = `checkbox_missing; fix budget exhausted (${state.checkboxFixAttempts || 0}/${maxCheckbox})`;
            state = beginRecovery(paths, state, cfg, {
              reason,
              originStatus: STATUSES.FIX_BATCH,
              resumeState: STATUSES.VERIFY_BATCH,
            });
            break;
          }
        } else if (state.batchFixAttempts >= cfg.max_fix_attempts) {
          const reason = 'batch fix attempts exceeded';
          state = beginRecovery(paths, state, cfg, {
            reason,
            originStatus: STATUSES.FIX_BATCH,
            resumeState: STATUSES.VERIFY_BATCH,
          });
          break;
        }
        if (
          state.fixTrigger &&
          String(state.fixTrigger).includes('verify') &&
          state.fixTrigger !== 'checkbox_missing' &&
          !loadLatestVerify(paths)
        ) {
          const reason = 'fixTrigger is verify_* but reports/latest-verify.json is missing';
          state = beginRecovery(paths, state, cfg, {
            reason,
            originStatus: STATUSES.FIX_BATCH,
            resumeState: STATUSES.VERIFY_BATCH,
          });
          break;
        }
        if (isCheckbox) {
          state = patchState(paths, {
            checkboxFixAttempts: (state.checkboxFixAttempts || 0) + 1,
          });
        } else {
          state = patchState(paths, { batchFixAttempts: state.batchFixAttempts + 1 });
        }
        const fixResult = runAgent('fixer', {
          mock: cli.mockAgent,
          config: cfg,
          promptCtx,
          paths,
          state: readState(paths) || state,
          workdir,
        });
        applyAgentPersist(paths, fixResult);
        if (!fixResult.ok) {
          state = blockForAgentFailure(
            paths,
            state,
            'fixer',
            fixResult,
            cfg,
            STATUSES.VERIFY_BATCH,
          );
          break;
        }
        state = patchState(paths, {
          lastAgentStdout: truncate(fixResult.stdout),
          lastAgentStderr: truncate(fixResult.stderr),
          status: STATUSES.VERIFY_BATCH,
        });
        break;
      }

      case STATUSES.VERIFY_BATCH: {
        loaded = reload(cli.exFile, workdir, cli.config, cli);
        const ids = state.activeTaskIds || [];
        const check = assertBatchChecked(loaded.tasks, ids);
        const batchTasks = loaded.tasks.filter((t) => ids.includes(t.id));
        const cmds = mockVerifyCmds(
          collectVerifyCommands(batchTasks, cfg.verify_default),
          cli,
        );
        const v = runVerifyCommands(cmds, workdir, paths, `batch-${state.currentBatch}`, {
          quiet: Boolean(cfg.quiet),
          phase: 'batch',
          activeTaskIds: ids,
          maxBytes: cfg.verify_capture_max_bytes,
        });
        const verifyOk = v.ok;
        const checksOk = check.ok;
        if (!check.ok) {
          appendLog(paths, `checkbox missing: ${check.missing.join(',')}`);
        }
        const decision = decideAfterVerify({
          verifyOk,
          checksOk,
          phase: 'batch',
          hasRemainingTodos: todoTasks(loaded.tasks).length > 0,
          batchFixAttempts: state.batchFixAttempts,
          fullFixAttempts: state.fullFixAttempts,
          maxFixAttempts: cfg.max_fix_attempts,
          maxFullFixAttempts: cfg.max_full_fix_attempts,
          checkboxFixAttempts: state.checkboxFixAttempts || 0,
          maxCheckboxFixAttempts:
            cfg.max_checkbox_fix_attempts != null ? cfg.max_checkbox_fix_attempts : 2,
          missingTaskIds: check.missing || [],
        });

        if (verifyOk && checksOk) {
          const cp = createCheckpoint(workdir, state.currentBatch, {
            enabled: Boolean(cfg.enable_checkpoint),
            excludePaths: workflowExcludePaths(workdir, paths),
          });
          appendLog(paths, `checkpoint skipped=${cp.skipped} sha=${cp.sha} ${cp.reason || ''}`);
          if (cp.error) {
            state = patchState(paths, {
              status: STATUSES.BLOCKED,
              blockedReason: cp.reason,
            });
            break;
          }
          if (cp.sha) {
            state = patchState(paths, { lastSuccessfulCommit: cp.sha });
          }
        }
        appendLog(
          paths,
          `verify ok=${verifyOk} checks=${checksOk} → ${decision.next} (${decision.reason}) fingerprint=${v.fingerprint || '-'}`,
        );

        if (!verifyOk || !checksOk) {
          const checkboxMissing = Boolean(verifyOk && !checksOk);
          const failPatch = patchAfterVerifyFailure(state, cfg, {
            v,
            decision,
            phase: 'batch',
            checkboxMissing,
            missingIds: check.missing || [],
          });
          failPatch.lastVerifyReportPath = paths.latestVerify;
          if (checkboxMissing) {
            console.error(
              `[gbx] verify scripts OK but tasks not checked: ${(check.missing || []).join(',')}; fixTrigger=checkbox_missing`,
            );
          }
          state = patchState(paths, failPatch);
          if (state.status === STATUSES.BLOCKED) {
            state = beginRecovery(paths, state, cfg, {
              reason: state.blockedReason,
              originStatus: STATUSES.VERIFY_BATCH,
              resumeState: STATUSES.VERIFY_BATCH,
            });
          } else if (state.fixTrigger) {
            console.error(
              `[gbx] ${checkboxMissing ? 'checkbox gap' : 'verify failed'} → ${state.status}; fixTrigger=${state.fixTrigger}; ${state.lastVerifySummary || ''}`,
            );
          }
          break;
        }

        const patch = {
          status: decision.next,
          blockedReason: null,
          lastVerifyOk: true,
          lastVerifySummary: summarizeVerify(v.report),
          lastVerifyFingerprint: null,
          lastVerifyReportPath: paths.latestVerify,
          checkboxFixAttempts: 0,
          recoveryAttempts: 0,
          ...clearFixBookkeepingPartial(),
          ...clearRecoveryBookkeepingPartial(),
        };
        if (decision.next === STATUSES.EXECUTE_BATCH) {
          patch.currentBatch = state.currentBatch + 1;
          patch.batchFixAttempts = 0;
          patch.checkboxFixAttempts = 0;
          patch.activeTaskIds = [];
        }
        if (decision.next === STATUSES.FULL_REVIEW) {
          patch.activeTaskIds = [];
          patch.batchFixAttempts = 0;
          patch.checkboxFixAttempts = 0;
        }
        state = patchState(paths, patch);
        break;
      }

      case STATUSES.FULL_REVIEW: {
        const reviewRunId = createReviewRunId('final-reviewer', 'final');
        clearLatestReview(paths.latestReview);
        promptCtx.reviewRunId = reviewRunId;
        const fr = runAgent('final-reviewer', {
          mock: cli.mockAgent,
          config: cfg,
          promptCtx: { ...promptCtx, batchIds: [] },
          paths,
          state,
          workdir,
        });
        applyAgentPersist(paths, fr);
        if (!fr.ok) {
          state = blockForAgentFailure(
            paths,
            state,
            'final-reviewer',
            fr,
            cfg,
            STATUSES.FULL_REVIEW,
          );
          break;
        }
        state = patchState(paths, {
          lastAgentStdout: truncate(fr.stdout),
          lastAgentStderr: truncate(fr.stderr),
        });
        const report = readLatestReview(paths.latestReview);
        const validation = validateReviewReport(report, {
          role: 'final-reviewer',
          batchId: 'final',
          reviewRunId,
        });
        if (!validation.ok) {
          state = beginRecovery(paths, state, cfg, {
            reason: validation.reason,
            originStatus: STATUSES.FULL_REVIEW,
            resumeState: STATUSES.FULL_REVIEW,
          });
          break;
        }
        const decision = decideAfterReview(validation.report, {
          phase: 'full',
          fullFixAttempts: state.fullFixAttempts,
          maxFullFixAttempts: cfg.max_full_fix_attempts,
          batchFixAttempts: 0,
          maxFixAttempts: cfg.max_fix_attempts,
          hasRemainingTodos: false,
        });
        appendLog(paths, `full review → ${decision.next} (${decision.reason})`);
        if (decision.next === STATUSES.BLOCKED) {
          state = beginRecovery(paths, state, cfg, {
            reason: decision.reason,
            originStatus: STATUSES.FULL_REVIEW,
            resumeState: STATUSES.FULL_VERIFY,
          });
          break;
        }
        state = patchState(paths, {
          status: decision.next,
          blockedReason: null,
          manualQaRequired: decision.next === STATUSES.READY_FOR_MANUAL_QA,
          fixTrigger: decision.next === STATUSES.FULL_FIX ? 'full_review_fail' : state.fixTrigger,
        });
        break;
      }

      case STATUSES.FULL_FIX: {
        const isCheckbox = state.fixTrigger === 'checkbox_missing';
        const maxCheckbox =
          cfg.max_checkbox_fix_attempts != null ? cfg.max_checkbox_fix_attempts : 2;
        if (isCheckbox) {
          if ((state.checkboxFixAttempts || 0) >= maxCheckbox) {
            const reason = `checkbox_missing; fix budget exhausted (${state.checkboxFixAttempts || 0}/${maxCheckbox})`;
            state = beginRecovery(paths, state, cfg, {
              reason,
              originStatus: STATUSES.FULL_FIX,
              resumeState: STATUSES.FULL_VERIFY,
            });
            break;
          }
        } else if (state.fullFixAttempts >= cfg.max_full_fix_attempts) {
          const reason = 'full fix attempts exceeded';
          state = beginRecovery(paths, state, cfg, {
            reason,
            originStatus: STATUSES.FULL_FIX,
            resumeState: STATUSES.FULL_VERIFY,
          });
          break;
        }
        if (
          state.fixTrigger &&
          String(state.fixTrigger).includes('verify') &&
          state.fixTrigger !== 'checkbox_missing' &&
          !loadLatestVerify(paths)
        ) {
          const reason = 'fixTrigger is full_verify_* but reports/latest-verify.json is missing';
          state = beginRecovery(paths, state, cfg, {
            reason,
            originStatus: STATUSES.FULL_FIX,
            resumeState: STATUSES.FULL_VERIFY,
          });
          break;
        }
        if (isCheckbox) {
          state = patchState(paths, {
            checkboxFixAttempts: (state.checkboxFixAttempts || 0) + 1,
          });
        } else {
          state = patchState(paths, { fullFixAttempts: state.fullFixAttempts + 1 });
        }
        const ff = runAgent('final-fixer', {
          mock: cli.mockAgent,
          config: cfg,
          promptCtx,
          paths,
          state: readState(paths) || state,
          workdir,
        });
        applyAgentPersist(paths, ff);
        if (!ff.ok) {
          state = blockForAgentFailure(
            paths,
            state,
            'final-fixer',
            ff,
            cfg,
            STATUSES.FULL_VERIFY,
          );
          break;
        }
        state = patchState(paths, {
          lastAgentStdout: truncate(ff.stdout),
          lastAgentStderr: truncate(ff.stderr),
          status: STATUSES.FULL_VERIFY,
        });
        break;
      }

      case STATUSES.FULL_VERIFY: {
        loaded = reload(cli.exFile, workdir, cli.config, cli);
        const allTaskIds = loaded.tasks.map((task) => task.id);
        const check = assertBatchChecked(loaded.tasks, allTaskIds);
        let runCmds = collectFullVerifyCommands(loaded.tasks, cfg.verify_default);
        if (cli.mockAgent && process.env.GBX_MOCK_REAL_VERIFY !== '1') {
          runCmds = [MOCK_OK_CMD];
        }
        const v = runVerifyCommands(runCmds, workdir, paths, 'full', {
          quiet: Boolean(cfg.quiet),
          phase: 'full',
          activeTaskIds: allTaskIds,
          maxBytes: cfg.verify_capture_max_bytes,
        });
        const decision = decideAfterVerify({
          verifyOk: v.ok,
          checksOk: check.ok,
          phase: 'full',
          hasRemainingTodos: false,
          batchFixAttempts: state.batchFixAttempts,
          fullFixAttempts: state.fullFixAttempts,
          maxFixAttempts: cfg.max_fix_attempts,
          maxFullFixAttempts: cfg.max_full_fix_attempts,
          checkboxFixAttempts: state.checkboxFixAttempts || 0,
          maxCheckboxFixAttempts:
            cfg.max_checkbox_fix_attempts != null ? cfg.max_checkbox_fix_attempts : 2,
          missingTaskIds: check.missing || [],
        });
        if (v.ok && check.ok) {
          const cp = createCheckpoint(workdir, 'final', {
            enabled: Boolean(cfg.enable_checkpoint),
            excludePaths: workflowExcludePaths(workdir, paths),
          });
          appendLog(paths, `final checkpoint skipped=${cp.skipped} sha=${cp.sha} ${cp.reason || ''}`);
          if (cp.error) {
            state = patchState(paths, {
              status: STATUSES.BLOCKED,
              blockedReason: cp.reason,
            });
            break;
          }
          if (cp.sha) {
            state = patchState(paths, { lastSuccessfulCommit: cp.sha });
          }
          state = patchState(paths, {
            status: STATUSES.READY_FOR_MANUAL_QA,
            manualQaRequired: true,
            lastVerifyOk: true,
            lastVerifySummary: summarizeVerify(v.report),
            lastVerifyFingerprint: null,
            lastVerifyReportPath: paths.latestVerify,
            checkboxFixAttempts: 0,
            recoveryAttempts: 0,
            ...clearFixBookkeepingPartial(),
            ...clearRecoveryBookkeepingPartial(),
          });
          break;
        }

        appendLog(
          paths,
          `full verify ok=${v.ok} checks=${check.ok} → ${decision.next} (${decision.reason})`,
        );
        const checkboxMissing = Boolean(v.ok && !check.ok);
        const failPatch = patchAfterVerifyFailure(state, cfg, {
          v,
          decision,
          phase: 'full',
          checkboxMissing,
          missingIds: check.missing || [],
        });
        failPatch.lastVerifyReportPath = paths.latestVerify;
        if (decision.next === STATUSES.READY_FOR_MANUAL_QA) {
          failPatch.status = STATUSES.READY_FOR_MANUAL_QA;
          failPatch.manualQaRequired = true;
          failPatch.blockedReason = null;
        }
        state = patchState(paths, failPatch);
        if (state.status === STATUSES.BLOCKED) {
          state = beginRecovery(paths, state, cfg, {
            reason: state.blockedReason,
            originStatus: STATUSES.FULL_VERIFY,
            resumeState: STATUSES.FULL_VERIFY,
          });
        }
        break;
      }

      case STATUSES.BLOCK_ANALYZE: {
        const recovery = cfg.block_recovery || {};
        const attempts = state.recoveryAttempts || 0;
        if (attempts >= recovery.max_attempts) {
          state = patchState(paths, {
            status: STATUSES.BLOCKED,
            blockedReason: `${state.recoveryOriginReason || 'block recovery failed'}; block recovery budget exhausted (${attempts}/${recovery.max_attempts})`,
          });
          break;
        }

        const analysisRunId = createRecoveryRunId('block-analysis');
        clearFile(paths.latestBlockAnalysis);
        const analysisResult = runAgent('block-analyzer', {
          mock: cli.mockAgent,
          config: cfg,
          promptCtx: {
            ...promptCtx,
            analysisRunId,
            recoveryOriginStatus: state.recoveryOriginStatus,
            recoveryOriginReason: state.recoveryOriginReason,
            latestVerifyPath: paths.latestVerify,
            latestBlockAnalysisPath: paths.latestBlockAnalysis,
          },
          paths,
          state,
          workdir,
        });
        applyAgentPersist(paths, analysisResult);
        if (!analysisResult.ok) {
          state = patchState(paths, {
            lastAgentStdout: truncate(analysisResult.stdout),
            lastAgentStderr: truncate(analysisResult.stderr),
            status: STATUSES.BLOCKED,
            blockedReason: `无法解决block,阻断分析器执行失败（exit ${analysisResult.exitCode}），请人类评审`,
          });
          break;
        }

        const analysis = readJson(paths.latestBlockAnalysis);
        const policy = evaluateBlockAnalysis({
          report: analysis,
          analysisRunId,
          config: cfg,
          workdir,
          activeTaskIds: state.activeTaskIds || [],
          skillRoot: SKILL_ROOT,
        });
        appendLog(
          paths,
          `block analysis kind=${analysis && analysis.kind ? analysis.kind : '-'} policy=${policy.ok ? 'allow' : 'deny'} reason=${policy.reason || '-'}`,
        );
        if (!policy.ok) {
          if (paths._theme && !cfg.quiet) {
            printBlockRecovery(paths._theme, 'analysis-denied', { reason: policy.reason }, paths);
          }
          state = patchState(paths, {
            lastAgentStdout: truncate(analysisResult.stdout),
            lastAgentStderr: truncate(analysisResult.stderr),
            status: STATUSES.BLOCKED,
            blockedReason: policy.reason,
            recoveryAnalysisRunId: analysisRunId,
            recoveryAnalysisReportPath: paths.latestBlockAnalysis,
            recoveryKind: analysis && analysis.kind ? analysis.kind : 'UNKNOWN',
          });
          break;
        }

        if (paths._theme && !cfg.quiet) {
          printBlockRecovery(paths._theme, 'analysis-ok', {
            kind: policy.report.kind,
            confidence: analysis && analysis.confidence ? analysis.confidence : '-',
            approvedPaths: policy.report.requiredPaths,
            workdir,
          }, paths);
        }

        /*
         * The analyzer report now owns the root-cause evidence. Consume the stale
         * review so its quoted hard-stop wording cannot fire again after recovery.
         */
        clearLatestReview(paths.latestReview);
        appendLog(paths, 'block analysis accepted; consumed stale latest review');
        state = patchState(paths, {
          lastAgentStdout: truncate(analysisResult.stdout),
          lastAgentStderr: truncate(analysisResult.stderr),
          status: STATUSES.BLOCK_REPAIR,
          blockedReason: null,
          recoveryAnalysisRunId: analysisRunId,
          recoveryAnalysisReportPath: paths.latestBlockAnalysis,
          recoveryKind: policy.report.kind,
          recoveryApprovedPaths: policy.report.requiredPaths,
        });
        break;
      }

      case STATUSES.BLOCK_REPAIR: {
        const analysis = readJson(paths.latestBlockAnalysis);
        const policy = evaluateBlockAnalysis({
          report: analysis,
          analysisRunId: state.recoveryAnalysisRunId,
          config: cfg,
          workdir,
          activeTaskIds: state.activeTaskIds || [],
          skillRoot: SKILL_ROOT,
        });
        if (!policy.ok) {
          state = patchState(paths, {
            status: STATUSES.BLOCKED,
            blockedReason: policy.reason,
          });
          break;
        }

        const repairRunId = createRecoveryRunId('block-repair');
        clearFile(paths.latestBlockRepair);
        const ignored = [`${cfg.workflow_dir}/**`];
        const before = captureProjectSnapshot(workdir, ignored);
        const repairResult = runAgent('block-resolver', {
          mock: cli.mockAgent,
          config: cfg,
          promptCtx: {
            ...promptCtx,
            repairRunId,
            latestBlockRepairPath: paths.latestBlockRepair,
            recoveryRootCause: policy.report.rootCause,
            recoveryKind: policy.report.kind,
            recoveryApprovedPaths: policy.report.requiredPaths,
            recoveryRecommendedAction: policy.report.recommendedAction,
          },
          paths,
          state,
          workdir,
        });
        applyAgentPersist(paths, repairResult);
        const after = captureProjectSnapshot(workdir, ignored);
        const touched = changedPaths(before, after);
        const scopeCheck = evaluateRepairChanges({
          changed: touched,
          approvedPaths: policy.report.requiredPaths,
          workflowDir: cfg.workflow_dir,
        });
        if (!scopeCheck.ok) {
          state = patchState(paths, {
            lastAgentStdout: truncate(repairResult.stdout),
            lastAgentStderr: truncate(repairResult.stderr),
            status: STATUSES.BLOCKED,
            blockedReason: scopeCheck.reason,
          });
          break;
        }
        if (!repairResult.ok) {
          state = patchState(paths, {
            lastAgentStdout: truncate(repairResult.stdout),
            lastAgentStderr: truncate(repairResult.stderr),
            status: STATUSES.BLOCKED,
            blockedReason: `无法解决block,阻断解决器执行失败（exit ${repairResult.exitCode}），请人类评审`,
          });
          break;
        }

        const repairReport = validateRepairReport(
          readJson(paths.latestBlockRepair),
          repairRunId,
        );
        if (!repairReport.ok || repairReport.report.result === 'needs_human') {
          const summary = repairReport.report.summary || '未说明';
          const envDenied =
            repairReport.ok &&
            /拒绝|rejected|denied|File deletion rejected|Shell.*rejected/i.test(summary);
          state = patchState(paths, {
            lastAgentStdout: truncate(repairResult.stdout),
            lastAgentStderr: truncate(repairResult.stderr),
            status: STATUSES.BLOCKED,
            blockedReason: repairReport.ok
              ? envDenied
                ? `无法解决block,阻断解决器需人工介入（agent 权限或环境拒绝）：${summary}。可检查 gbx agent.force/trust 或重试 --no-agent-force 关闭自动批准`
                : `无法解决block,阻断解决器判断批准范围不足：${summary}，请人类评审`
              : repairReport.reason,
          });
          break;
        }

        state = patchState(paths, {
          lastAgentStdout: truncate(repairResult.stdout),
          lastAgentStderr: truncate(repairResult.stderr),
          status: STATUSES.BLOCK_VERIFY,
          blockedReason: null,
          recoveryAttempts: (state.recoveryAttempts || 0) + 1,
          recoveryLastChangedPaths: touched,
        });
        if (paths._theme && !cfg.quiet) {
          printBlockRecovery(paths._theme, 'repair-ok', {
            result: repairReport.report.result,
            changedCount: touched.length,
            changedPaths: touched,
            verifyHint: (collectVerifyCommands(
              selectBatch(loaded.tasks, { batchSize: cfg.batch_size, group: cfg.group }),
              cfg.verify_default,
            ) || [])[0],
            workdir,
          }, paths);
        }
        appendLog(
          paths,
          `block repair completed attempt=${(state.recoveryAttempts || 0) + 1}; changed=${touched.join(',') || '(none)'}`,
        );
        break;
      }

      case STATUSES.BLOCK_VERIFY: {
        const resume = state.recoveryResumeState;
        const validResume = new Set([
          STATUSES.EXECUTE_BATCH,
          STATUSES.BATCH_REVIEW,
          STATUSES.FIX_BATCH,
          STATUSES.VERIFY_BATCH,
          STATUSES.FULL_REVIEW,
          STATUSES.FULL_FIX,
          STATUSES.FULL_VERIFY,
        ]);
        if (!validResume.has(resume)) {
          state = patchState(paths, {
            status: STATUSES.BLOCKED,
            blockedReason: `无法解决block,恢复状态无效：${resume || '(missing)'}，请人类评审`,
          });
          break;
        }
        appendLog(paths, `block verify handoff → ${resume}`);
        if (paths._theme && !cfg.quiet) {
          printBlockRecovery(paths._theme, 'verify-handoff', { resumeStatus: resume }, paths);
        }
        state = patchState(paths, {
          status: resume,
          blockedReason: null,
          lastAgentStdout: '',
          lastAgentStderr: '',
          skipHardStopOnce: true,
        });
        break;
      }

      default: {
        gbxErr(paths, `[gbx] unknown status: ${state.status}`);
        exitResult = 4;
        break;
      }
    }
    if (exitResult !== 4) continue;
    break;
  }

  if (exitResult == null) {
    gbxErr(paths, '[gbx] Maximum iteration count reached.');
    appendLog(paths, 'max iterations');
    exitResult = 5;
  }
  } finally {
    if (
      terminalDismissContext &&
      paths._ui &&
      typeof paths._ui.awaitDismiss === 'function'
    ) {
      paths._ui.awaitDismiss(terminalDismissContext);
    }
    if (paths._ui && typeof paths._ui.destroy === 'function') {
      paths._ui.destroy();
    }
  }
  return exitResult;
}

module.exports = { runOrchestrator, printDryRun };
