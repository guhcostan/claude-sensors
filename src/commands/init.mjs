import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_PATH } from '../config.mjs';
import { detectSensors } from '../detect.mjs';

const GITIGNORE = 'state.json\nhistory.jsonl\nsnapshot.json\ndaemon.pid\n*.tmp-*\n';
const EMPTY_EXAMPLE = `
# No known tools detected. Any command can be a sensor — example:
# - name: my-sensor
#   parser: default
#   command: ./scripts/my-check.sh
#   interval: 20000
#   level: full
#   score: "Number of violations (lower is better)"
`;

export function runInit(cwd) {
  const file = path.join(cwd, CONFIG_PATH);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), GITIGNORE);
  if (fs.existsSync(file)) {
    return { created: false, sensors: [] };
  }
  const sensors = detectSensors(cwd);
  const doc = { version: 1, scouting_rule: true, daemon: { enabled: false }, sensors };
  let text = YAML.stringify(doc);
  if (sensors.length === 0) text += EMPTY_EXAMPLE;
  fs.writeFileSync(file, text);
  return { created: true, sensors: sensors.map((s) => s.name) };
}
