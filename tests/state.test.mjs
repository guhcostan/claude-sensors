import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readState, updateState, computeEvent, appendHistory, readHistory } from '../src/state.mjs';

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-state-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  return dir;
}
const res = (over = {}) => ({ sensor: 'lint', status: 'success', score: 0, detail: '', findings: [], ranAt: new Date().toISOString(), durationMs: 5, ...over });

describe('state', () => {
  it('round-trips results through state.json', () => {
    const dir = tmp();
    updateState(dir, [res()]);
    expect(readState(dir).results.lint.status).toBe('success');
  });
  it('merges per sensor', () => {
    const dir = tmp();
    updateState(dir, [res()]);
    updateState(dir, [res({ sensor: 'tests', status: 'failure', score: 1 })]);
    const s = readState(dir);
    expect(Object.keys(s.results).sort()).toEqual(['lint', 'tests']);
  });
});

describe('computeEvent', () => {
  const base = { threshold: null, direction: 'lower' };
  it('initial without previous', () => expect(computeEvent(null, res(), base)).toBe('initial'));
  it('regression success→failure', () =>
    expect(computeEvent(res(), res({ status: 'failure', score: 3 }), base)).toBe('regression'));
  it('recovery failure→success', () =>
    expect(computeEvent(res({ status: 'failure', score: 3 }), res(), base)).toBe('recovery'));
  it('worsening on higher score (direction lower)', () =>
    expect(computeEvent(res({ status: 'failure', score: 1 }), res({ status: 'failure', score: 4 }), base)).toBe('worsening'));
  it('improvement on lower score', () =>
    expect(computeEvent(res({ status: 'failure', score: 4 }), res({ status: 'failure', score: 1 }), base)).toBe('improvement'));
  it('steady when unchanged', () => expect(computeEvent(res(), res(), base)).toBe('steady'));
  it('below_threshold for direction higher under threshold', () =>
    expect(computeEvent(res({ score: 60 }), res({ score: 60 }), { threshold: 80, direction: 'higher' })).toBe('below_threshold'));
});

describe('history', () => {
  it('appends and reads back jsonl', () => {
    const dir = tmp();
    appendHistory(dir, res(), 'initial');
    appendHistory(dir, res({ sensor: 'tests' }), 'initial');
    expect(readHistory(dir).length).toBe(2);
    expect(readHistory(dir, 'lint').length).toBe(1);
  });
});
