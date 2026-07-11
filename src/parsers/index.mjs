import defaultParser from './default.mjs';
import eslintParser from './eslint.mjs';
import tscParser from './tsc.mjs';

const registry = new Map([['default', defaultParser]]);
registry.set('eslint', eslintParser);
registry.set('tsc', tscParser);

export function registerParser(name, fn) {
  registry.set(name, fn);
}

export function getParser(name) {
  const p = registry.get(name);
  if (!p) throw new Error(`Unknown parser: ${name}`);
  return p;
}
