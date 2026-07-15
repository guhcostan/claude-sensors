export default function ruffParser({ stdout = '', exitCode }) {
  let items;
  try {
    items = JSON.parse(stdout.trim() || '[]');
  } catch {
    return { status: 'error', detail: `could not parse ruff JSON output (exit ${exitCode})` };
  }
  // Hardening: ensure parsed value is an array
  if (!Array.isArray(items)) {
    return { status: 'error', detail: 'could not parse ruff JSON output' };
  }
  const findings = items.map((v) => ({
    file: v.filename,
    line: v.location?.row ?? 0,
    message: `${v.code}: ${v.message}`,
  }));
  const score = findings.length;
  return {
    status: score === 0 ? 'success' : 'failure',
    score,
    detail: score === 0 ? 'No issues' : `${score} issue${score === 1 ? '' : 's'}`,
    findings,
  };
}
