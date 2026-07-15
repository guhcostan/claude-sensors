#!/usr/bin/env node
import { readStdinJson, hasConfig, emit } from './lib.mjs';
import { loadConfig } from '../src/config.mjs';
import { readState } from '../src/state.mjs';
import { readSnapshot, takeSnapshot } from '../src/snapshot.mjs';

const data = await readStdinJson();
const cwd = data.cwd || process.cwd();

if (!hasConfig(cwd)) {
  emit('SessionStart', 'claude-sensors: no .sensors/sensors.yaml found. Run the sensors init command (/claude-sensors:init) to detect this project\'s stack and set up maintainability sensors.');
  process.exit(0);
}

let config;
try {
  config = loadConfig(cwd);
} catch (err) {
  emit('SessionStart', `claude-sensors: sensors.yaml failed to load (${err.message}).`);
  process.exit(0);
}

const state = readState(cwd);
const hasResults = Object.keys(state.results).length > 0;
if (hasResults && !readSnapshot(cwd)) takeSnapshot(cwd);

const names = config.sensors.filter((s) => s.enabled).map((s) => s.name).join(', ') || 'none';
emit('SessionStart', `claude-sensors active: ${names}. Fast sensors run after each edit; the full set runs before you finish your turn.`);
