#!/usr/bin/env node
import { createRequire } from 'node:module';

const VALUE_FLAGS = new Set(['level', 'changed']);

export function parseArgs(argv) {
  const [cmd = null, ...rest] = argv;
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
  if (cmd === null || flags.has('help')) {
    console.log('Usage: sensors <init|check|snapshot|status|history|trigger> [flags]');
    return;
  }
  if (flags.has('version')) {
    const require = createRequire(import.meta.url);
    console.log(require('../package.json').version);
    return;
  }
  console.error(`Unknown command: ${cmd}`); // commands wired in later tasks
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
