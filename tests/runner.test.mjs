import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runSensor } from '../src/runner.mjs';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-run-'));

function sensor(over = {}) {
  return {
    name: 't', parser: 'default', command: 'node -e "process.exit(0)"', interval: 1000,
    level: 'fast', score: '', prompt: '', resultFile: null, timeout: 5000,
    enabled: true, threshold: null, direction: 'lower', ...over,
  };
}

describe('runSensor', () => {
  it('success path fills schema fields', async () => {
    const r = await runSensor(sensor(), { cwd });
    expect(r).toMatchObject({ sensor: 't', status: 'success', score: 0 });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
  it('failure path captures output', async () => {
    const cmd = `node -e "console.log('boom'); process.exit(1)"`;
    const r = await runSensor(sensor({ command: cmd }), { cwd });
    expect(r.status).toBe('failure');
    expect(r.detail).toBe('boom');
  });
  it('timeout yields error, not throw', async () => {
    const r = await runSensor(sensor({ command: 'node -e "setTimeout(()=>{},10000)"', timeout: 300 }), { cwd });
    expect(r.status).toBe('error');
    expect(r.detail).toMatch(/timed out/);
  });
  it('replaces {file} placeholder', async () => {
    const cmd = `node -e "console.log(process.argv[1]); process.exit(1)" {file}`;
    const r = await runSensor(sensor({ command: cmd }), { cwd, file: 'src/x.ts' });
    expect(r.detail).toBe('src/x.ts');
  });
  it('reads result_file when configured', async () => {
    fs.writeFileSync(path.join(cwd, 'out.json'), JSON.stringify({ status: 'failure', score: 9, detail: 'from file' }));
    const r = await runSensor(sensor({ command: 'node -e "process.exit(0)"', resultFile: 'out.json' }), { cwd });
    expect(r).toMatchObject({ status: 'failure', score: 9 });
  });
  it('unknown parser is fail-open error', async () => {
    const r = await runSensor(sensor({ parser: 'nope' }), { cwd });
    expect(r.status).toBe('error');
  });
});
