export function violation(ruleId, file, message, suggestion, options = {}) {
  return {
    ruleId,
    file,
    line: options.line ?? 1,
    column: options.column ?? 1,
    severity: options.severity ?? "error",
    current: options.current,
    allowed: options.allowed,
    message,
    suggestion,
  };
}

export function splitBySeverity(violations) {
  return {
    errors: violations.filter((item) => item.severity !== "warn"),
    warnings: violations.filter((item) => item.severity === "warn"),
  };
}

export function formatViolation(item) {
  const current = item.current === undefined ? "-" : String(item.current);
  const allowed = item.allowed === undefined ? "-" : String(item.allowed);
  return `${item.ruleId}  ${item.file}:${item.line}:${item.column}  当前=${current}  允许=${allowed}  ${item.message}  ${item.suggestion}`;
}

export function printGateResult(label, result) {
  for (const warning of result.warnings) {
    console.warn(`WARN ${formatViolation(warning)}`);
  }
  for (const error of result.errors) {
    console.error(formatViolation(error));
  }
  console.log(`${label} checked=${result.filesChecked ?? 0} errors=${result.errors.length} warnings=${result.warnings.length}`);
}

