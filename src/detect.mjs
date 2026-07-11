import fs from 'node:fs';
import path from 'node:path';

export function detectSensors(cwd) {
  const sensors = [];
  const pkg = readJson(path.join(cwd, 'package.json'));
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.eslint) {
      sensors.push({ name: 'lint', parser: 'eslint', command: 'npx eslint {file} --format json', interval: 14000, level: 'fast', score: 'Number of lint issues (lower is better)' });
    }
    if (deps.typescript) {
      sensors.push({ name: 'typecheck', parser: 'tsc', command: 'npx tsc --noEmit', interval: 15000, level: 'fast', score: 'Number of type errors (lower is better)' });
    }
    if (deps.vitest) {
      sensors.push({ name: 'tests', parser: 'vitest', command: 'npx vitest run --reporter=json', interval: 10000, level: 'full', score: 'Number of failing tests (lower is better)' });
      sensors.push({ name: 'coverage', parser: 'coverage', command: 'npx vitest run --coverage --reporter=json', interval: 16000, level: 'full', result_file: 'coverage/coverage-final.json', score: 'Statement coverage percentage (higher is better)', direction: 'higher', threshold: 80 });
    }
  }
  const pyproject = readText(path.join(cwd, 'pyproject.toml'));
  if (pyproject) {
    if (pyproject.includes('ruff')) {
      sensors.push({ name: 'lint', parser: 'ruff', command: 'ruff check {file} --output-format json', interval: 14000, level: 'fast', score: 'Number of lint issues (lower is better)' });
    }
    if (pyproject.includes('pytest')) {
      sensors.push({ name: 'tests', parser: 'pytest', command: 'pytest --tb=no -q', interval: 10000, level: 'full', score: 'Number of failing tests (lower is better)' });
    }
  }
  // dedupe by name, first wins (a repo with both stacks keeps the JS names)
  const seen = new Set();
  return sensors.filter((s) => (seen.has(s.name) ? false : seen.add(s.name)));
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
