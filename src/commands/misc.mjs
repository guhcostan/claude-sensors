import { loadConfig } from '../config.mjs';
import { readState, readHistory } from '../state.mjs';
import { takeSnapshot, readSnapshot } from '../snapshot.mjs';
import { formatAgent, formatLine } from '../summary.mjs';

export function runSnapshot(cwd) {
  return takeSnapshot(cwd);
}

export function runStatus(cwd, { line = false } = {}) {
  const state = readState(cwd);
  const results = Object.values(state.results);
  if (line) return formatLine(results);
  if (results.length === 0) return 'sensors: no data (run `sensors check` first)';
  const config = loadConfig(cwd);
  return formatAgent(results, { config, snapshot: readSnapshot(cwd) });
}

export function runHistory(cwd, sensorName = null) {
  const entries = readHistory(cwd, sensorName);
  return entries
    .map((e, i) => `#${i + 1} ${e.ts} ${e.event} ${e.status} score=${e.score ?? '-'} (${e.elapsed}ms)`)
    .join('\n');
}
