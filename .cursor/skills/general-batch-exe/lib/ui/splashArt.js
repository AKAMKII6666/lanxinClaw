'use strict';

/**
 * Module: ui/splashArt
 * Purpose: Load, trim, and fit terminal artwork without ANSI assumptions.
 */

const fs = require('fs');

function normalizeSplashArt(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return '';

  const nonEmpty = lines.filter((line) => line.trim());
  const commonIndent = Math.min(
    ...nonEmpty.map((line) => line.match(/^\s*/u)?.[0].length || 0),
  );
  return lines
    .map((line) => line.slice(commonIndent).replace(/\s+$/u, ''))
    .join('\n');
}

function sampleLine(line, sourceWidth, targetWidth) {
  const chars = Array.from(line.padEnd(sourceWidth, ' '));
  // Keep every rendered row at the same width. blessed centers each line
  // independently, so trimming row tails would shear the artwork.
  if (sourceWidth <= targetWidth) return chars.join('');
  const sampled = [];
  for (let column = 0; column < targetWidth; column += 1) {
    sampled.push(chars[Math.floor((column * sourceWidth) / targetWidth)] || ' ');
  }
  return sampled.join('');
}

function sampleRows(lines, targetHeight) {
  if (lines.length <= targetHeight) return lines;
  const sampled = [];
  for (let row = 0; row < targetHeight; row += 1) {
    sampled.push(lines[Math.floor((row * lines.length) / targetHeight)]);
  }
  return sampled;
}

function fitSplashArt(text, maxWidth, maxHeight) {
  const normalized = normalizeSplashArt(text);
  if (!normalized) return '';
  const widthLimit = Math.max(1, Math.floor(maxWidth || 1));
  const heightLimit = Math.max(1, Math.floor(maxHeight || 1));
  const sourceLines = normalized.split('\n');
  const sourceWidth = Math.max(...sourceLines.map((line) => Array.from(line).length));
  return sampleRows(sourceLines, heightLimit)
    .map((line) => sampleLine(line, sourceWidth, widthLimit))
    .join('\n');
}

function loadSplashArt(filePath) {
  try {
    return normalizeSplashArt(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return '';
  }
}

module.exports = {
  normalizeSplashArt,
  fitSplashArt,
  loadSplashArt,
};
