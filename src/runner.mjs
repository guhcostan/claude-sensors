import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getParser } from './parsers/index.mjs';
import { makeResult } from './schema.mjs';

export async function runSensor(sensorCfg, { cwd, file = null } = {}) {
  const started = Date.now();
  try {
    const parser = getParser(sensorCfg.parser);
    const command = sensorCfg.command.replaceAll('{file}', file ?? '.');
    const { stdout, stderr, exitCode, timedOut } = await execShell(command, cwd, sensorCfg.timeout);
    if (timedOut) {
      return makeResult(sensorCfg.name, { status: 'error', detail: `timed out after ${sensorCfg.timeout}ms` }, { durationMs: Date.now() - started });
    }
    let resultFileContent = null;
    if (sensorCfg.resultFile) {
      const p = path.join(cwd, sensorCfg.resultFile);
      resultFileContent = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    }
    const parsed = parser({ stdout, stderr, exitCode, resultFileContent, sensor: sensorCfg });
    return makeResult(sensorCfg.name, parsed, { durationMs: Date.now() - started });
  } catch (err) {
    return makeResult(sensorCfg.name, { status: 'error', detail: String(err?.message ?? err) }, { durationMs: Date.now() - started });
  }
}

export async function runSensors(sensors, opts) {
  const results = [];
  for (const s of sensors) results.push(await runSensor(s, opts)); // sequential: parallel runs skew durations and fight over CPU
  return results;
}

function execShell(command, cwd, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const killTree = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree();
      resolve({ stdout, stderr, exitCode: null, timedOut: true });
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: String(err), exitCode: null, timedOut: false });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut: false });
    });
  });
}
