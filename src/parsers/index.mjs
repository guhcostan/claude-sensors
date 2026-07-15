import defaultParser from './default.mjs';
import eslintParser from './eslint.mjs';
import tscParser from './tsc.mjs';
import vitestParser from './vitest.mjs';
import coverageParser from './coverage.mjs';
import ruffParser from './ruff.mjs';
import pytestParser from './pytest.mjs';

const registry = new Map([['default', defaultParser]]);
registry.set('eslint', eslintParser);
registry.set('tsc', tscParser);
registry.set('vitest', vitestParser);
registry.set('coverage', coverageParser);
registry.set('ruff', ruffParser);
registry.set('pytest', pytestParser);

export function registerParser(name, fn) {
  registry.set(name, fn);
}

export function getParser(name) {
  const p = registry.get(name);
  if (!p) throw new Error(`Unknown parser: ${name}`);
  return p;
}
