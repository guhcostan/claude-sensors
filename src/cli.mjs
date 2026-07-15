#!/usr/bin/env node
import { createRequire } from 'node:module';

const VALUE_FLAGS = new Set(['level', 'changed']);

export function parseArgs(argv) {
  let cmd = null;
  let rest = argv;

  // If argv[0] starts with --, treat it as a flag, not a command
  if (argv.length > 0 && !argv[0].startsWith('--')) {
    cmd = argv[0];
    rest = argv.slice(1);
  }

  const flags = new Map();
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (VALUE_FLAGS.has(name) && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) {
        flags.set(name, rest[++i]);
      } else {
        flags.set(name, true);
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd, flags, positional };
}

async function main() {
  const { cmd, flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.has('version')) {
    const require = createRequire(import.meta.url);
    console.log(require('../package.json').version);
    return;
  }
  if (cmd === null || flags.has('help')) {
    console.log('Usage: sensors <init|check|snapshot|status|history|trigger> [flags]');
    return;
  }
  const cwd = process.cwd();
  if (cmd === 'init') {
    const { runInit } = await import('./commands/init.mjs');
    const { created, sensors } = runInit(cwd);
    console.log(created ? `Created .sensors/sensors.yaml (sensors: ${sensors.join(', ') || 'none detected'})` : '.sensors/sensors.yaml already exists — not overwriting');
    return;
  }
  if (cmd === 'check') {
    const { runCheck } = await import('./commands/check.mjs');
    const { results, regressions, output } = await runCheck(cwd, {
      all: flags.has('all'),
      level: flags.get('level') ?? null,
      changed: flags.get('changed') ?? null,
      agent: flags.has('agent'),
      json: flags.has('json'),
    });
    console.log(output);
    if (flags.has('strict') && (regressions.length > 0 || results.some((r) => r.status === 'failure'))) {
      process.exitCode = 1;
    }
    return;
  }
  if (cmd === 'trigger') {
    const { runTrigger } = await import('./commands/check.mjs');
    const r = await runTrigger(cwd, positional[0]);
    console.log(`${r.sensor}: ${r.status.toUpperCase()} (${r.detail})`);
    return;
  }
  if (cmd === 'snapshot') {
    const { runSnapshot } = await import('./commands/misc.mjs');
    console.log(`Snapshot taken at ${runSnapshot(cwd).takenAt}`);
    return;
  }
  if (cmd === 'status') {
    const { runStatus } = await import('./commands/misc.mjs');
    console.log(runStatus(cwd, { line: flags.has('line') }));
    return;
  }
  if (cmd === 'history') {
    const { runHistory } = await import('./commands/misc.mjs');
    console.log(runHistory(cwd, positional[0] ?? null) || 'no history');
    return;
  }
  console.error(`Unknown command: ${cmd}`); // commands wired in later tasks
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
