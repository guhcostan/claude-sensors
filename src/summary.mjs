import { compareToSnapshot } from './snapshot.mjs';

const SCOUTING_RULE =
  "Follow scouting rule: if sensors are reporting issues you didn't cause with a change, " +
  "consider to leave the code better than you found it, if it's a small change.";
const MAX_FINDINGS = 20;

export function formatAgent(results, { config, snapshot = null, now = Date.now() }) {
  const lines = [`SENSORS STATUS  Updated: ${new Date(now).toISOString()}`, ''];
  if (config.scoutingRule) lines.push(SCOUTING_RULE, '');
  for (const r of results) {
    const cfg = config.sensors.find((s) => s.name === r.sensor) ?? {};
    const ago = Math.max(0, Math.round((now - Date.parse(r.ranAt)) / 1000));
    lines.push(`${r.sensor}: ${r.status.toUpperCase()} (${r.detail}) [ran ${ago}s ago] | ${compareToSnapshot(snapshot, r)}`);
    if (cfg.command) lines.push(`  cmd: \`${cfg.command}\`${cfg.score ? `, score: ${cfg.score}` : ''}`);
    for (const f of r.findings.slice(0, MAX_FINDINGS)) {
      lines.push(`  ${f.file}:${f.line} ${f.message}${f.guidance ? ` — ${f.guidance}` : ''}`);
    }
    if (r.findings.length > MAX_FINDINGS) lines.push(`  … and ${r.findings.length - MAX_FINDINGS} more`);
    if (cfg.prompt) lines.push(`  prompt: ${cfg.prompt}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function formatLine(results) {
  if (results.length === 0) return 'sensors: no data';
  const anyFailure = results.some((r) => r.status === 'failure');
  const anyError = results.some((r) => r.status === 'error');
  const dot = anyFailure ? '●!' : anyError ? '●?' : '●';
  const parts = results.map((r) => {
    const mark = r.status === 'success' ? '✓' : r.status === 'failure' ? '✗' : '?';
    return `${r.sensor}:${mark}${r.score ?? ''}`;
  });
  return `${dot} ${parts.join(' ')}`;
}
