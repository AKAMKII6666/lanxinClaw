'use strict';

/**
 * Module: validation/config
 * Purpose: Reject unsafe or nonsensical merged workflow configuration before any writes.
 */

const path = require('path');

const ADAPTERS = new Set([null, 'table', 'checkbox', 'batch-block', 'batchBlock']);
const GROUPS = new Set(['order', 'milestone']);
const RECOVERY_CONFIDENCE = new Set(['medium', 'high']);
const DEPENDENCY_POLICIES = new Set(['none', 'declared-only']);

function fail(message) {
  const error = new Error(`invalid workflow config: ${message}`);
  error.code = 'CONFIG_INVALID';
  throw error;
}

function assertInteger(config, key, { min }) {
  const value = config[key];
  if (!Number.isInteger(value) || value < min) {
    fail(`${key} must be an integer >= ${min}`);
  }
}

function assertBoolean(config, key) {
  if (typeof config[key] !== 'boolean') {
    fail(`${key} must be a boolean`);
  }
}

function assertStringArray(config, key, { allowEmpty = true } = {}) {
  const value = config[key];
  if (!Array.isArray(value)) {
    fail(`${key} must be an array of strings`);
  }
  if (!allowEmpty && value.length === 0) {
    fail(`${key} must not be empty`);
  }
  if (value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    fail(`${key} must contain only non-empty strings`);
  }
}

function assertString(config, key) {
  if (typeof config[key] !== 'string') {
    fail(`${key} must be a string`);
  }
}

function assertInsideWorkdir(workdir, configuredPath, key, { allowRoot = false } = {}) {
  const absolute = path.resolve(workdir, configuredPath);
  const relative = path.relative(workdir, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${key} must resolve inside --workdir`);
  }
  if (!allowRoot && relative === '') {
    fail(`${key} must resolve to a child path of --workdir`);
  }
}

function validateConfig(config, workdir) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    fail('root value must be a mapping');
  }

  assertInteger(config, 'batch_size', { min: 1 });
  assertInteger(config, 'max_rounds', { min: 1 });
  assertInteger(config, 'max_fix_attempts', { min: 0 });
  assertInteger(config, 'max_full_fix_attempts', { min: 0 });
  assertInteger(config, 'max_checkbox_fix_attempts', { min: 0 });
  assertBoolean(config, 'stop_on_fail');
  assertBoolean(config, 'enable_checkpoint');
  assertBoolean(config, 'checkpoint_require_clean');
  assertBoolean(config, 'continue_on_executor_fail');
  assertBoolean(config, 'quiet');
  assertInteger(config, 'heartbeat_ms', { min: 0 });
  assertInteger(config, 'max_ineffective_fixes', { min: 1 });
  assertInteger(config, 'verify_capture_max_bytes', { min: 4096 });
  assertStringArray(config, 'verify_default');
  assertStringArray(config, 'read_first');
  assertStringArray(config, 'hard_stop_patterns');
  for (const key of [
    'executor_extra',
    'reviewer_extra',
    'fixer_extra',
    'final_reviewer_extra',
  ]) {
    assertString(config, key);
  }
  if (config.mock_agent != null && typeof config.mock_agent !== 'boolean') {
    fail('mock_agent must be a boolean when configured');
  }
  if (config.enable_checkpoint && config.checkpoint_require_clean === false) {
    fail('checkpoint_require_clean=false is unsafe and unsupported when checkpoints are enabled');
  }

  if (!GROUPS.has(config.group)) {
    fail('group must be order or milestone');
  }
  if (!ADAPTERS.has(config.adapter)) {
    fail('adapter must be table, checkbox, or batch-block');
  }
  if (typeof config.workflow_dir !== 'string' || config.workflow_dir.trim() === '') {
    fail('workflow_dir must be a non-empty string');
  }
  assertInsideWorkdir(workdir, config.workflow_dir, 'workflow_dir');

  for (const readPath of config.read_first) {
    assertInsideWorkdir(workdir, readPath, 'read_first entry', { allowRoot: true });
  }
  for (const pattern of config.hard_stop_patterns) {
    try {
      new RegExp(pattern, 'i');
    } catch (error) {
      fail(`hard_stop_patterns contains invalid regex ${JSON.stringify(pattern)}: ${error.message}`);
    }
  }

  if (!config.agent || typeof config.agent !== 'object' || Array.isArray(config.agent)) {
    fail('agent must be a mapping');
  }
  if (typeof config.agent.command !== 'string' || config.agent.command.trim() === '') {
    fail('agent.command must be a non-empty string');
  }
  if (typeof config.agent.print_flag !== 'string' || config.agent.print_flag.trim() === '') {
    fail('agent.print_flag must be a non-empty string');
  }
  const outputFormats = new Set(['text', 'json', 'stream-json']);
  if (config.agent.output_format != null) {
    if (!outputFormats.has(config.agent.output_format)) {
      fail('agent.output_format must be text, json, or stream-json');
    }
  }
  if (
    config.agent.stream_partial_output != null &&
    typeof config.agent.stream_partial_output !== 'boolean'
  ) {
    fail('agent.stream_partial_output must be a boolean when configured');
  }
  if (config.agent.force != null && typeof config.agent.force !== 'boolean') {
    fail('agent.force must be a boolean when configured');
  }
  if (config.agent.trust != null && typeof config.agent.trust !== 'boolean') {
    fail('agent.trust must be a boolean when configured');
  }
  if (config.agent.approve_mcps != null && typeof config.agent.approve_mcps !== 'boolean') {
    fail('agent.approve_mcps must be a boolean when configured');
  }
  if (
    config.agent.sandbox != null &&
    config.agent.sandbox !== 'enabled' &&
    config.agent.sandbox !== 'disabled'
  ) {
    fail('agent.sandbox must be enabled, disabled, or omitted');
  }

  const theme = config.console_theme;
  if (theme != null) {
    if (typeof theme !== 'object' || Array.isArray(theme)) {
      fail('console_theme must be a mapping');
    }
    for (const key of ['enabled', 'color', 'show_role_banner', 'show_agent_events']) {
      if (theme[key] != null && typeof theme[key] !== 'boolean') {
        fail(`console_theme.${key} must be a boolean`);
      }
    }
  }

  const consoleUi = config.console_ui;
  if (consoleUi != null) {
    if (typeof consoleUi !== 'object' || Array.isArray(consoleUi)) {
      fail('console_ui must be a mapping');
    }
    if (
      consoleUi.mode != null &&
      !['auto', 'tui', 'plain'].includes(consoleUi.mode)
    ) {
      fail('console_ui.mode must be auto, tui, or plain');
    }
    for (const key of ['mouse', 'show_shortcuts']) {
      if (consoleUi[key] != null && typeof consoleUi[key] !== 'boolean') {
        fail(`console_ui.${key} must be a boolean`);
      }
    }
  }

  const recovery = config.block_recovery;
  if (!recovery || typeof recovery !== 'object' || Array.isArray(recovery)) {
    fail('block_recovery must be a mapping');
  }
  if (typeof recovery.enabled !== 'boolean') {
    fail('block_recovery.enabled must be a boolean');
  }
  if (!Number.isInteger(recovery.max_attempts) || recovery.max_attempts < 0) {
    fail('block_recovery.max_attempts must be an integer >= 0');
  }
  if (!RECOVERY_CONFIDENCE.has(recovery.min_confidence)) {
    fail('block_recovery.min_confidence must be medium or high');
  }
  if (typeof recovery.require_declared_scope !== 'boolean') {
    fail('block_recovery.require_declared_scope must be a boolean');
  }
  if (!DEPENDENCY_POLICIES.has(recovery.dependency_policy)) {
    fail('block_recovery.dependency_policy must be none or declared-only');
  }
  for (const key of ['allowed_kinds', 'deny_paths']) {
    if (
      !Array.isArray(recovery[key]) ||
      recovery[key].some((item) => typeof item !== 'string' || item.trim() === '')
    ) {
      fail(`block_recovery.${key} must be an array of non-empty strings`);
    }
  }
  for (const key of ['analyzer_extra', 'resolver_extra']) {
    if (typeof recovery[key] !== 'string') {
      fail(`block_recovery.${key} must be a string`);
    }
  }
  if (
    !recovery.task_scopes ||
    typeof recovery.task_scopes !== 'object' ||
    Array.isArray(recovery.task_scopes)
  ) {
    fail('block_recovery.task_scopes must be a mapping');
  }
  for (const [taskId, scope] of Object.entries(recovery.task_scopes)) {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
      fail(`block_recovery.task_scopes.${taskId} must be a mapping`);
    }
    for (const key of ['allowed_paths', 'related_paths']) {
      if (scope[key] == null) continue;
      if (
        !Array.isArray(scope[key]) ||
        scope[key].some((item) => typeof item !== 'string' || item.trim() === '')
      ) {
        fail(`block_recovery.task_scopes.${taskId}.${key} must be an array of paths`);
      }
      for (const configuredPath of scope[key]) {
        const prefix = configuredPath.split('*', 1)[0] || '.';
        assertInsideWorkdir(workdir, prefix, `block_recovery scope ${taskId}`, {
          allowRoot: true,
        });
      }
    }
  }
}

function validateExecutionIndex(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    fail('execution index must contain at least one parseable task');
  }
  const ids = new Set();
  for (const task of tasks) {
    if (!task || typeof task.id !== 'string' || task.id.trim() === '') {
      fail('every task must have a non-empty ID');
    }
    if (ids.has(task.id)) {
      fail(`task ID must be unique: ${task.id}`);
    }
    ids.add(task.id);
    if (task.status !== 'todo' && task.status !== 'done') {
      fail(`task ${task.id} has unsupported status: ${task.status}`);
    }
    if (task.verify != null && (typeof task.verify !== 'string' || task.verify.trim() === '')) {
      fail(`task ${task.id} verify must be a non-empty string when present`);
    }
  }
}

module.exports = { validateConfig, validateExecutionIndex };
