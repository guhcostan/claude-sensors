import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCheck, runTrigger } from '../src/commands/check.mjs';
import { takeSnapshot } from '../src/snapshot.mjs';
import { readHistory } from '../src/state.mjs';

function project(yamlText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-check-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  fs.writeFileSync(path.join(dir, '.sensors/sensors.yaml'), yamlText);
  return dir;
}

const YAML_OK_FAIL = `
version: 1
sensors:
  - name: ok
    command: node -e "process.exit(0)"
    interval: 1000
    level: fast
  - name: broken
    command: node -e "console.log('oops'); process.exit(1)"
    interval: 1000
    level: full
  - name: manual
    command: node -e "process.exit(0)"
    interval: trigger
`;

describe('runCheck', () => {
  it('runs non-trigger sensors, writes state and history', async () => {
    const dir = project(YAML_OK_FAIL);
    const { results, output } = await runCheck(dir, { all: true, agent: true });
    expect(results.map((r) => r.sensor).sort()).toEqual(['broken', 'ok']); // manual (trigger) excluded
    expect(output).toContain('SENSORS STATUS');
    expect(output).toContain('broken: FAILURE');
    expect(readHistory(dir).length).toBe(2);
  });
  it('level fast selects only fast sensors', async () => {
    const dir = project(YAML_OK_FAIL);
    const { results } = await runCheck(dir, { level: 'fast' });
    expect(results.map((r) => r.sensor)).toEqual(['ok']);
  });
  it('detects regressions vs snapshot', async () => {
    const flakyYaml = [
      'version: 1',
      'sensors:',
      '  - name: flaky',
      `    command: node -e "process.exit(require('node:fs').existsSync('fail.flag')?1:0)"`,
      '    interval: 1000',
      '    level: full',
    ].join('\n');
    const dir = project(flakyYaml);
    await runCheck(dir, { all: true });
    takeSnapshot(dir);
    fs.writeFileSync(path.join(dir, 'fail.flag'), '1'); // now the sensor fails
    const { regressions } = await runCheck(dir, { all: true });
    expect(regressions).toEqual(['flaky']);
  });
});

describe('runTrigger', () => {
  it('runs a trigger sensor by name', async () => {
    const dir = project(YAML_OK_FAIL);
    const r = await runTrigger(dir, 'manual');
    expect(r.status).toBe('success');
  });
  it('throws for unknown sensor', async () => {
    const dir = project(YAML_OK_FAIL);
    await expect(runTrigger(dir, 'ghost')).rejects.toThrow(/not found/);
  });
});
