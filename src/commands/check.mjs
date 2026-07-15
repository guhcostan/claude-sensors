import { loadConfig } from '../config.mjs';
import { runSensors, runSensor } from '../runner.mjs';
import { readState, updateState, computeEvent, appendHistory } from '../state.mjs';
import { readSnapshot, isRegression } from '../snapshot.mjs';
import { formatAgent } from '../summary.mjs';

export async function runCheck(cwd, { all = false, level = null, changed = null, agent = false, json = false } = {}) {
  const config = loadConfig(cwd);
  let sensors = config.sensors.filter((s) => s.enabled && s.interval !== 'trigger');
  if (changed) sensors = sensors.filter((s) => s.level === 'fast');
  else if (level) sensors = sensors.filter((s) => s.level === level);
  // `all` (and the no-flag default) keeps every non-trigger sensor

  const prev = readState(cwd).results;
  const results = await runSensors(sensors, { cwd, file: changed });
  for (const r of results) {
    const cfg = sensors.find((s) => s.name === r.sensor);
    const event = computeEvent(prev[r.sensor] ?? null, r, { threshold: cfg.threshold, direction: cfg.direction });
    appendHistory(cwd, r, event);
  }
  updateState(cwd, results);

  const snapshot = readSnapshot(cwd);
  const regressions = results
    .filter((r) => {
      const cfg = sensors.find((s) => s.name === r.sensor);
      return isRegression(snapshot, r, cfg);
    })
    .map((r) => r.sensor);

  const output = json
    ? JSON.stringify({ results, regressions }, null, 2)
    : formatAgent(results, { config, snapshot });
  return { results, regressions, output };
}

export async function runTrigger(cwd, name) {
  const config = loadConfig(cwd);
  const sensorCfg = config.sensors.find((s) => s.name === name);
  if (!sensorCfg) throw new Error(`sensor "${name}" not found in sensors.yaml`);
  const prev = readState(cwd).results;
  const result = await runSensor(sensorCfg, { cwd });
  const event = computeEvent(prev[name] ?? null, result, { threshold: sensorCfg.threshold, direction: sensorCfg.direction });
  appendHistory(cwd, result, event);
  updateState(cwd, [result]);
  return result;
}
