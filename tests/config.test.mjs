import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, CONFIG_PATH } from '../src/config.mjs';

function tmpProject(yamlText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  fs.writeFileSync(path.join(dir, CONFIG_PATH), yamlText);
  return dir;
}

describe('loadConfig', () => {
  it('normalizes sensors with defaults', () => {
    const dir = tmpProject(`
version: 1
sensors:
  - name: lint
    parser: eslint
    command: npx eslint . --format json
    level: fast
  - name: tests
    command: npx vitest run
`);
    const cfg = loadConfig(dir);
    expect(cfg.scoutingRule).toBe(true);
    expect(cfg.daemon.enabled).toBe(false);
    const lint = cfg.sensors[0];
    expect(lint.timeout).toBe(30000);           // fast default
    expect(lint.direction).toBe('lower');
    expect(lint.interval).toBe('trigger');       // default when unset
    const tests = cfg.sensors[1];
    expect(tests.parser).toBe('default');
    expect(tests.level).toBe('full');
    expect(tests.timeout).toBe(120000);          // full default
  });
  it('maps result_file to resultFile', () => {
    const dir = tmpProject(`
version: 1
sensors:
  - name: mutation
    command: npx stryker run
    result_file: reports/mutation.json
`);
    expect(loadConfig(dir).sensors[0].resultFile).toBe('reports/mutation.json');
  });
  it('throws on duplicate names', () => {
    const dir = tmpProject(`
version: 1
sensors:
  - { name: a, command: "true" }
  - { name: a, command: "true" }
`);
    expect(() => loadConfig(dir)).toThrow(/duplicate/);
  });
  it('throws when file is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-'));
    expect(() => loadConfig(dir)).toThrow(/sensors init/);
  });
});
