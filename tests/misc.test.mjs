import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runSnapshot, runStatus, runHistory } from '../src/commands/misc.mjs';
import { updateState, appendHistory } from '../src/state.mjs';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-misc-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  fs.writeFileSync(path.join(dir, '.sensors/sensors.yaml'), `
version: 1
sensors:
  - name: lint
    command: "true"
    interval: 1000
`);
  return dir;
}
const res = { sensor: 'lint', status: 'failure', score: 2, detail: '2 problems', findings: [], ranAt: new Date().toISOString(), durationMs: 5 };

describe('misc commands', () => {
  it('snapshot then status reads stored state', () => {
    const dir = project();
    updateState(dir, [res]);
    runSnapshot(dir);
    const out = runStatus(dir, {});
    expect(out).toContain('lint: FAILURE (2 problems)');
    expect(out).toContain('Same as snapshot');
  });
  it('status --line is one line', () => {
    const dir = project();
    updateState(dir, [res]);
    expect(runStatus(dir, { line: true })).toBe('●! lint:✗2');
  });
  it('status with no data', () => {
    expect(runStatus(project(), { line: true })).toBe('sensors: no data');
  });
  it('history lists events', () => {
    const dir = project();
    appendHistory(dir, res, 'initial');
    appendHistory(dir, { ...res, score: 0, status: 'success' }, 'recovery');
    const out = runHistory(dir, 'lint');
    expect(out.split('\n').length).toBe(2);
    expect(out).toContain('recovery');
  });
});
