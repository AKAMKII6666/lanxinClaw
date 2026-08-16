'use strict';

/**
 * Module: validation/reviewReport
 * Purpose: Bind reviewer output to the current run and validate its decision fields.
 */

const crypto = require('crypto');
const fs = require('fs');

function createReviewRunId(role, batchId) {
  return `${role}-${batchId}-${crypto.randomUUID()}`;
}

function clearLatestReview(latestPath) {
  if (fs.existsSync(latestPath)) {
    fs.unlinkSync(latestPath);
  }
}

function invalid(reason) {
  return { ok: false, reason };
}

function validateReviewReport(report, { role, batchId, reviewRunId }) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return invalid('review report is missing or invalid JSON');
  }
  if (report.schemaVersion !== 1) {
    return invalid('review report schemaVersion must be 1');
  }
  if (report.reviewRunId !== reviewRunId) {
    return invalid('review report does not belong to the current review run');
  }
  if (report.role !== role) {
    return invalid(`review report role must be ${role}`);
  }
  if (String(report.batchId) !== String(batchId)) {
    return invalid(`review report batchId must be ${batchId}`);
  }
  if (!['pass', 'fail', 'blocked'].includes(report.result)) {
    return invalid('review report result must be pass, fail, or blocked');
  }
  for (const key of ['blocker', 'critical', 'major', 'minor']) {
    if (!Number.isInteger(report[key]) || report[key] < 0) {
      return invalid(`review report ${key} must be a non-negative integer`);
    }
  }
  if (!Array.isArray(report.issues)) {
    return invalid('review report issues must be an array');
  }
  if (report.result === 'fail' && report.issues.length === 0) {
    return invalid('failed review report must contain at least one issue');
  }
  if (report.result === 'pass' && (report.blocker !== 0 || report.critical !== 0)) {
    return invalid('passing review report cannot contain blocker or critical findings');
  }
  return { ok: true, report };
}

module.exports = { createReviewRunId, clearLatestReview, validateReviewReport };
