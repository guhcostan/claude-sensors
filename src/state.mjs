import fs from 'node:fs';
import path from 'node:path';

export function stateDir(cwd) {
  return path.join(cwd, '.sensors');
}

export function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function readState(cwd) {
  const f = path.join(stateDir(cwd), 'state.json');
  if (!fs.existsSync(f)) return { updatedAt: null, results: {} };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function updateState(cwd, results) {
  const state = readState(cwd);
  for (const r of results) state.results[r.sensor] = r;
  state.updatedAt = new Date().toISOString();
  writeAtomic(path.join(stateDir(cwd), 'state.json'), JSON.stringify(state, null, 2));
  return state;
}

export function computeEvent(prev, curr, { threshold = null, direction = 'lower' } = {}) {
  if (!prev) return 'initial';
  if (prev.status === 'success' && curr.status === 'failure') return 'regression';
  if (prev.status === 'failure' && curr.status === 'success') return 'recovery';
  if (prev.score == null || curr.score == null || prev.score === curr.score) {
    return isBelowThreshold(curr, threshold, direction) ? 'below_threshold' : 'steady';
  }
  const improved = direction === 'lower' ? curr.score < prev.score : curr.score > prev.score;
  return improved ? 'improvement' : 'worsening';
}

function isBelowThreshold(curr, threshold, direction) {
  if (threshold == null || curr.score == null) return false;
  return direction === 'higher' ? curr.score < threshold : curr.score > threshold;
}

export function appendHistory(cwd, result, event) {
  const entry = { sensor: result.sensor, ts: result.ranAt, status: result.status, score: result.score, event, elapsed: result.durationMs };
  fs.appendFileSync(path.join(stateDir(cwd), 'history.jsonl'), `${JSON.stringify(entry)}\n`);
}

export function readHistory(cwd, sensorName = null) {
  const f = path.join(stateDir(cwd), 'history.jsonl');
  if (!fs.existsSync(f)) return [];
  const entries = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return sensorName ? entries.filter((e) => e.sensor === sensorName) : entries;
}
