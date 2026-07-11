import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { updateState } from '../src/state.mjs';
import { takeSnapshot, readSnapshot, compareToSnapshot, isRegression } from '../src/snapshot.mjs';

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-snap-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  return dir;
}
const res = (over = {}) => ({ sensor: 'lint', status: 'success', score: 0, detail: '', findings: [], ranAt: new Date().toISOString(), durationMs: 1, ...over });
const cfg = (over = {}) => ({ name: 'lint', threshold: null, direction: 'lower', ...over });

describe('snapshot', () => {
  it('takes snapshot from current state and compares', () => {
    const dir = tmp();
    updateState(dir, [res()]);
    takeSnapshot(dir);
    const snap = readSnapshot(dir);
    expect(compareToSnapshot(snap, res())).toBe('Same as snapshot');
    expect(compareToSnapshot(snap, res({ status: 'failure', score: 2 }))).toBe('Changed since snapshot (0 → 2)');
    expect(compareToSnapshot(snap, res({ sensor: 'new' }))).toBe('No snapshot');
  });
});

describe('isRegression', () => {
  const dir = tmp();
  updateState(dir, [res(), res({ sensor: 'cov', score: 80 })]);
  takeSnapshot(dir);
  const snap = readSnapshot(dir);

  it('status flip success→failure is regression', () => {
    expect(isRegression(snap, res({ status: 'failure', score: 1 }), cfg())).toBe(true);
  });
  it('score worsening without threshold is regression', () => {
    expect(isRegression(snap, res({ status: 'success', score: 3 }), cfg())).toBe(true);
  });
  it('coverage drop above threshold is NOT regression', () => {
    expect(isRegression(snap, res({ sensor: 'cov', score: 79 }), cfg({ name: 'cov', direction: 'higher', threshold: 70 }))).toBe(false);
  });
  it('coverage drop below threshold IS regression', () => {
    expect(isRegression(snap, res({ sensor: 'cov', score: 65 }), cfg({ name: 'cov', direction: 'higher', threshold: 70 }))).toBe(true);
  });
  it('no snapshot entry → not a regression', () => {
    expect(isRegression(snap, res({ sensor: 'ghost', status: 'failure' }), cfg({ name: 'ghost' }))).toBe(false);
  });
  it('error status never counts as regression (fail-open)', () => {
    expect(isRegression(snap, res({ status: 'error', score: 10 }), cfg())).toBe(false);
  });
});
