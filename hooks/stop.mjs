#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readStdinJson, hasConfig } from './lib.mjs';
import { runCheck } from '../src/commands/check.mjs';

const MAX_CONSECUTIVE_BLOCKS = 2;

const data = await readStdinJson();
const cwd = data.cwd || process.cwd();
const sessionId = data.session_id || 'default';

if (!hasConfig(cwd)) process.exit(0);

let result;
try {
  result = await runCheck(cwd, { all: true });
} catch {
  process.exit(0); // fail-open: hook errors never block the agent
}

const counterFile = path.join(cwd, '.sensors', `.stop-block-${sessionId.replace(/[^a-zA-Z0-9-]/g, '')}`);

if (result.regressions.length === 0) {
  if (fs.existsSync(counterFile)) fs.rmSync(counterFile, { force: true });
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: result.output } }));
  process.exit(0);
}

let count = 0;
if (fs.existsSync(counterFile)) count = Number(fs.readFileSync(counterFile, 'utf8')) || 0;
count += 1;

if (count > MAX_CONSECUTIVE_BLOCKS) {
  // anti-loop guard: stop insisting after repeated blocks, let the turn end with a warning
  fs.rmSync(counterFile, { force: true });
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: `${result.output}\n\nclaude-sensors: regressions remain after ${MAX_CONSECUTIVE_BLOCKS} attempts — letting the turn end. Please address these before the next commit.`,
    },
  }));
  process.exit(0);
}

fs.writeFileSync(counterFile, String(count));
console.log(JSON.stringify({ decision: 'block', reason: result.output }));
