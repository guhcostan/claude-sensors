const STATUSES = new Set(['success', 'failure', 'error']);

export function makeResult(sensorName, partial, { ranAt = new Date().toISOString(), durationMs = 0 } = {}) {
  return {
    sensor: sensorName,
    status: STATUSES.has(partial.status) ? partial.status : 'error',
    score: Number.isFinite(partial.score) ? partial.score : null,
    detail: partial.detail ?? '',
    findings: (partial.findings ?? []).map((f) => ({
      file: f.file ?? '',
      line: f.line ?? 0,
      message: f.message ?? '',
      guidance: f.guidance ?? '',
    })),
    ranAt,
    durationMs,
  };
}
