'use strict';

/**
 * Module: loadExFile
 * Purpose: Load execution index: frontmatter YAML + body + tasks.
 */

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { detectAndParse } = require('./adapters/detect');
const { mergeConfig } = require('./mergeConfig');
const { validateConfig, validateExecutionIndex } = require('./validation/config');

function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) {
    const err = new Error('Execution index must start with YAML frontmatter (---)');
    err.code = 'EXFILE_NO_FRONTMATTER';
    throw err;
  }
  const end = raw.indexOf('\n---', 3);
  if (end < 0) {
    const err = new Error('Execution index frontmatter is not closed with ---');
    err.code = 'EXFILE_BAD_FRONTMATTER';
    throw err;
  }
  const yamlText = raw.slice(3, end).replace(/^\r?\n/, '');
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  let frontmatter;
  try {
    frontmatter = YAML.parse(yamlText) || {};
  } catch (e) {
    const err = new Error(`Frontmatter YAML parse error: ${e.message}`);
    err.code = 'EXFILE_BAD_YAML';
    throw err;
  }
  if (typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    const err = new Error('Frontmatter must be a YAML mapping');
    err.code = 'EXFILE_BAD_YAML';
    throw err;
  }
  return { frontmatter, body };
}

function loadProjectConfig(configPath, workdir) {
  if (!configPath) {
    return {};
  }
  const abs = path.resolve(workdir, configPath);
  if (!fs.existsSync(abs)) {
    const err = new Error(`--config not found: ${abs}`);
    err.code = 'CONFIG_MISSING';
    throw err;
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const parsed = YAML.parse(raw) || {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('--config YAML root must be a mapping');
    err.code = 'CONFIG_BAD_YAML';
    throw err;
  }
  return parsed;
}

/**
 * @param {object} options
 * @param {string} options.exFile
 * @param {string} options.workdir
 * @param {string|null} options.configPath
 * @param {object} options.cli
 */
function loadExFile({ exFile, workdir, configPath = null, cli = {} }) {
  const exAbs = path.resolve(workdir, exFile);
  if (!fs.existsSync(exAbs)) {
    const err = new Error(`--exFile not found: ${exAbs}`);
    err.code = 'EXFILE_MISSING';
    throw err;
  }
  const raw = fs.readFileSync(exAbs, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  const projectConfig = loadProjectConfig(configPath, workdir);
  const config = mergeConfig({ projectConfig, frontmatter, cli });
  const { adapter, tasks } = detectAndParse(body, config.adapter);
  validateConfig(config, workdir);
  validateExecutionIndex(tasks);

  const readFirstStatus = (config.read_first || []).map((rel) => {
    const abs = path.resolve(workdir, rel);
    return { path: rel, abs, exists: fs.existsSync(abs) };
  });

  return {
    exAbs,
    exRel: exFile,
    raw,
    body,
    frontmatter,
    config,
    adapter,
    tasks,
    readFirstStatus,
  };
}

module.exports = { loadExFile, splitFrontmatter, loadProjectConfig };
