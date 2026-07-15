import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const CONFIG_PATH = path.join('.sensors', 'sensors.yaml');
const DEFAULT_TIMEOUTS = { fast: 30000, full: 120000 };

export function loadConfig(cwd) {
  const file = path.join(cwd, CONFIG_PATH);
  if (!fs.existsSync(file)) {
    throw new Error(`${CONFIG_PATH} not found. Run: sensors init`);
  }
  const raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || raw.version !== 1) throw new Error('sensors.yaml: expected `version: 1`');
  const sensors = (raw.sensors ?? []).map(normalizeSensor);
  const seen = new Set();
  for (const s of sensors) {
    if (seen.has(s.name)) throw new Error(`sensors.yaml: duplicate sensor name "${s.name}"`);
    seen.add(s.name);
  }
  return {
    scoutingRule: raw.scouting_rule !== false,
    daemon: { enabled: raw.daemon?.enabled === true },
    sensors,
  };
}

function normalizeSensor(s) {
  if (!s?.name || !s?.command) {
    throw new Error(`sensors.yaml: every sensor needs "name" and "command" (got: ${JSON.stringify(s)})`);
  }
  const level = s.level ?? 'full';
  return {
    name: s.name,
    parser: s.parser ?? 'default',
    command: s.command,
    interval: s.interval ?? 'trigger',
    level,
    score: s.score ?? '',
    prompt: s.prompt ?? '',
    resultFile: s.result_file ?? null,
    timeout: s.timeout ?? DEFAULT_TIMEOUTS[level] ?? DEFAULT_TIMEOUTS.full,
    enabled: s.enabled !== false,
    threshold: s.threshold ?? null,
    direction: s.direction ?? 'lower',
  };
}
