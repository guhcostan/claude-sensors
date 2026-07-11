import defaultParser from './default.mjs';
import eslintParser from './eslint.mjs';
import tscParser from './tsc.mjs';
import vitestParser from './vitest.mjs';
import coverageParser from './coverage.mjs';

const registry = new Map([['default', defaultParser]]);
registry.set('eslint', eslintParser);
registry.set('tsc', tscParser);
registry.set('vitest', vitestParser);
registry.set('coverage', coverageParser);

export function registerParser(name, fn) {
  registry.set(name, fn);
}

export function getParser(name) {
  const p = registry.get(name);
  if (!p) throw new Error(`Unknown parser: ${name}`);
  return p;
}
