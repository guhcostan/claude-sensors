import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = fileURLToPath(new URL('../../hooks/', import.meta.url));

function runHook(name, payload) {
  try {
    const out = execFileSync('node', [path.join(HOOKS_DIR, name)], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
    return { stdout: out, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? '', exitCode: err.status };
  }
}

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-hooks-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  fs.writeFileSync(path.join(dir, '.sensors/sensors.yaml'), `
version: 1
sensors:
  - name: gate
    command: node -e "process.exit(require('node:fs').existsSync('fail.flag')?1:0)"
    interval: 1000
    level: fast
`);
  return dir;
}

describe('session-start.mjs', () => {
  it('suggests init when no config exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-hooks-noconf-'));
    const { stdout } = runHook('session-start.mjs', { cwd: dir });
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('sensors init');
  });
  it('lists active sensors when config exists', () => {
    const dir = project();
    const { stdout } = runHook('session-start.mjs', { cwd: dir });
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('gate');
  });
});

describe('post-tool-use.mjs', () => {
  it('stays silent when the sensor is clean', () => {
    const dir = project();
    const { stdout } = runHook('post-tool-use.mjs', { cwd: dir, tool_input: { file_path: 'a.txt' } });
    expect(stdout.trim()).toBe('');
  });
  it('emits additionalContext when the sensor fails', () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, 'fail.flag'), '1');
    const { stdout } = runHook('post-tool-use.mjs', { cwd: dir, tool_input: { file_path: 'a.txt' } });
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('gate: FAILURE');
  });
  it('exits silently with no config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-hooks-noconf2-'));
    const { stdout } = runHook('post-tool-use.mjs', { cwd: dir, tool_input: { file_path: 'a.txt' } });
    expect(stdout.trim()).toBe('');
  });
});

describe('stop.mjs', () => {
  it('blocks on regression, then releases after the anti-loop limit, then clears on fix', () => {
    const dir = project();
    execFileSync('node', [fileURLToPath(new URL('../../src/cli.mjs', import.meta.url)), 'check', '--all'], { cwd: dir });
    execFileSync('node', [fileURLToPath(new URL('../../src/cli.mjs', import.meta.url)), 'snapshot'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'fail.flag'), '1');

    const first = JSON.parse(runHook('stop.mjs', { cwd: dir, session_id: 's1' }).stdout);
    expect(first.decision).toBe('block');

    const second = JSON.parse(runHook('stop.mjs', { cwd: dir, session_id: 's1' }).stdout);
    expect(second.decision).toBe('block');

    const third = JSON.parse(runHook('stop.mjs', { cwd: dir, session_id: 's1' }).stdout);
    expect(third.decision).toBeUndefined();
    expect(third.hookSpecificOutput.additionalContext).toContain('letting the turn end');

    fs.rmSync(path.join(dir, 'fail.flag'));
    const fourth = JSON.parse(runHook('stop.mjs', { cwd: dir, session_id: 's1' }).stdout);
    expect(fourth.decision).toBeUndefined();
    expect(fs.existsSync(path.join(dir, '.sensors', '.stop-block-s1'))).toBe(false);
  });

  it('does not block when there is no regression', () => {
    const dir = project();
    const { stdout } = runHook('stop.mjs', { cwd: dir, session_id: 's2' });
    const parsed = JSON.parse(stdout);
    expect(parsed.decision).toBeUndefined();
    expect(parsed.hookSpecificOutput.additionalContext).toContain('SENSORS STATUS');
  });

  it('exits silently with no config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-hooks-noconf3-'));
    const { stdout } = runHook('stop.mjs', { cwd: dir, session_id: 's3' });
    expect(stdout.trim()).toBe('');
  });
});
