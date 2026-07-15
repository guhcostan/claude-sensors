#!/usr/bin/env node
import { readStdinJson, hasConfig, emit } from './lib.mjs';
import { runCheck } from '../src/commands/check.mjs';

const data = await readStdinJson();
const cwd = data.cwd || process.cwd();
const filePath = data.tool_input?.file_path;

if (!filePath || !hasConfig(cwd)) process.exit(0);

let result;
try {
  result = await runCheck(cwd, { changed: filePath });
} catch {
  process.exit(0); // fail-open: hook errors never block the agent
}

const dirty = result.results.some((r) => r.status !== 'success');
if (!dirty) process.exit(0); // clean run: stay silent, zero noise

emit('PostToolUse', result.output);
