import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectSensors } from '../src/detect.mjs';
import { runInit } from '../src/commands/init.mjs';
import { loadConfig } from '../src/config.mjs';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-detect-')); }

describe('detectSensors', () => {
  it('detects TS/JS tools from package.json', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      devDependencies: { eslint: '^9.0.0', typescript: '^5.0.0', vitest: '^3.0.0' },
    }));
    const names = detectSensors(dir).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['lint', 'typecheck', 'tests', 'coverage']));
  });
  it('detects Python tools from pyproject.toml', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n[tool.pytest.ini_options]\n');
    const names = detectSensors(dir).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['lint', 'tests']));
  });
  it('empty repo detects nothing', () => {
    expect(detectSensors(tmp())).toEqual([]);
  });
});

describe('runInit', () => {
  it('writes loadable config plus gitignore', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^9.0.0' } }));
    const { created, sensors } = runInit(dir);
    expect(created).toBe(true);
    expect(sensors).toContain('lint');
    const cfg = loadConfig(dir); // must round-trip through the real loader
    expect(cfg.sensors.find((s) => s.name === 'lint').parser).toBe('eslint');
    expect(fs.readFileSync(path.join(dir, '.sensors/.gitignore'), 'utf8')).toContain('state.json');
  });
  it('does not overwrite existing config', () => {
    const dir = tmp();
    runInit(dir);
    expect(runInit(dir).created).toBe(false);
  });
  it('empty repo gets commented example', () => {
    const dir = tmp();
    runInit(dir);
    const text = fs.readFileSync(path.join(dir, '.sensors/sensors.yaml'), 'utf8');
    expect(text).toContain('# - name: my-sensor');
  });
});
