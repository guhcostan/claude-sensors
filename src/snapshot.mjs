import fs from 'node:fs';
import path from 'node:path';
import { stateDir, writeAtomic, readState } from './state.mjs';

export function takeSnapshot(cwd) {
  const state = readState(cwd);
  const snap = { takenAt: new Date().toISOString(), results: state.results };
  writeAtomic(path.join(stateDir(cwd), 'snapshot.json'), JSON.stringify(snap, null, 2));
  return snap;
}

export function readSnapshot(cwd) {
  const f = path.join(stateDir(cwd), 'snapshot.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

export function compareToSnapshot(snapshot, result) {
  const prev = snapshot?.results?.[result.sensor];
  if (!prev) return 'No snapshot';
  if (prev.status === result.status && prev.score === result.score) return 'Same as snapshot';
  const delta = prev.score != null && result.score != null ? ` (${prev.score} → ${result.score})` : '';
  return `Changed since snapshot${delta}`;
}

export function isRegression(snapshot, result, sensorCfg) {
  const prev = snapshot?.results?.[result.sensor];
  if (!prev) return false;
  if (prev.status === 'success' && result.status === 'failure') return true;
  if (prev.score == null || result.score == null) return false;
  const worse = sensorCfg.direction === 'higher' ? result.score < prev.score : result.score > prev.score;
  if (!worse) return false;
  if (sensorCfg.threshold == null) return true;
  // with a threshold, only breaching it counts as regression (spec §3)
  return sensorCfg.direction === 'higher' ? result.score < sensorCfg.threshold : result.score > sensorCfg.threshold;
}
