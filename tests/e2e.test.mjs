import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

function sensors(args, cwd) {
  return execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}

describe('e2e', () => {
  it('init → check → snapshot → regression → status', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-e2e-'));

    // init on an empty repo, then replace config with a controllable sensor
    expect(sensors(['init'], dir)).toContain('Created');
    fs.writeFileSync(path.join(dir, '.sensors/sensors.yaml'), `
version: 1
sensors:
  - name: gate
    command: node -e "process.exit(require('node:fs').existsSync('fail.flag')?1:0)"
    interval: 1000
    level: full
    score: "Number of gate failures (lower is better)"
`);

    const out1 = sensors(['check', '--all', '--agent'], dir);
    expect(out1).toContain('gate: SUCCESS');

    sensors(['snapshot'], dir);
    fs.writeFileSync(path.join(dir, 'fail.flag'), '1');

    let failed = false;
    try {
      sensors(['check', '--all', '--agent', '--strict'], dir);
    } catch (e) {
      failed = true;
      expect(String(e.stdout)).toContain('gate: FAILURE');
    }
    expect(failed).toBe(true); // --strict exits 1 on regression

    expect(sensors(['status', '--line'], dir)).toContain('gate:✗');
    expect(sensors(['history', 'gate'], dir)).toContain('regression');
  });
});
