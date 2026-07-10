# claude-sensors CLI Engine Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `sensors` CLI engine — config loading, stack detection, sensor runner with parsers, history/events, snapshot comparison, and the agent-facing summary — per the approved spec at `docs/superpowers/specs/2026-07-10-claude-sensors-design.md`.

**Architecture:** Node.js ESM CLI. `sensors.yaml` in `.sensors/` is the source of truth; a runner spawns each sensor command with a timeout, a parser normalizes output into a shared result schema, state/history/snapshot live as JSON files in `.sensors/`. Commands: `init`, `check`, `snapshot`, `status`, `history`, `trigger`.

**Tech Stack:** Node.js ≥ 20 (ESM, `node:` builtins), `yaml` (only runtime dep), `vitest` (dev dep).

**Scope note:** This is Plan 1 of 3. Plan 2 = daemon + TUI + remaining parsers (jest, mypy, mutmut, govet, gotest, clippy, cargotest, stryker, dependency-cruiser, semgrep, gitleaks). Plan 3 = Claude Code plugin (hooks, skills, statusline, marketplace). This plan alone delivers a working, testable CLI.

## Global Constraints

- Node.js ≥ 20, `"type": "module"`, imports use `node:` prefix for builtins.
- Only runtime dependency: `yaml`. Dev dependency: `vitest`.
- Fail-open: a sensor that cannot run yields `status: "error"` and never throws out of the runner.
- All state writes are atomic: write to temp file, then `fs.renameSync`.
- No network calls, no telemetry.
- Config file path: `.sensors/sensors.yaml` (committed). State files (gitignored): `.sensors/state.json`, `.sensors/history.jsonl`, `.sensors/snapshot.json`.
- Result statuses: exactly `success | failure | error`.
- Timeout defaults: `fast` = 30000 ms, `full` = 120000 ms.
- Agent summary format must match spec section 7 (`SENSORS STATUS`, scouting rule, `name: STATUS (detail) [ran Xs ago] | Same as snapshot`).

## File Structure

```
package.json                  — name claude-sensors, bin "sensors"
src/cli.mjs                   — argv dispatch + flag parsing
src/config.mjs                — load/normalize .sensors/sensors.yaml
src/schema.mjs                — makeResult (result contract)
src/runner.mjs                — runSensor/runSensors (spawn, timeout, result_file)
src/parsers/index.mjs         — parser registry
src/parsers/default.mjs       — generic parser
src/parsers/eslint.mjs        — + tsc.mjs, vitest.mjs, coverage.mjs, ruff.mjs, pytest.mjs
src/state.mjs                 — state.json, history.jsonl, computeEvent
src/snapshot.mjs              — snapshot.json, compareToSnapshot, isRegression
src/summary.mjs               — formatAgent, formatLine
src/detect.mjs                — stack detection + config generation
src/commands/init.mjs         — thin command wrappers
src/commands/check.mjs
src/commands/misc.mjs         — snapshot/status/history/trigger
tests/*.test.mjs              — mirrors src/
tests/fixtures/               — real tool outputs + fixture repos
```

---

### Task 1: Package scaffold + CLI entry

**Files:**
- Create: `package.json`, `src/cli.mjs`, `tests/cli.test.mjs`, `.gitignore`

**Interfaces:**
- Produces: `sensors --version` prints version; `parseArgs(argv)` → `{ cmd, flags: Map, positional: [] }` exported from `src/cli.mjs` for tests.

- [ ] **Step 1: Create package.json and .gitignore**

```json
{
  "name": "claude-sensors",
  "version": "0.1.0",
  "description": "Maintainability sensors sidecar for coding agents",
  "type": "module",
  "bin": { "sensors": "./src/cli.mjs" },
  "scripts": { "test": "vitest run" },
  "engines": { "node": ">=20" },
  "license": "MIT",
  "dependencies": { "yaml": "^2.4.0" },
  "devDependencies": { "vitest": "^3.0.0" }
}
```

`.gitignore`:

```
node_modules/
```

- [ ] **Step 2: Write the failing test**

`tests/cli.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli.mjs';

describe('parseArgs', () => {
  it('splits command, flags and positionals', () => {
    const { cmd, flags, positional } = parseArgs(['check', '--level', 'fast', '--agent', 'extra']);
    expect(cmd).toBe('check');
    expect(flags.get('level')).toBe('fast');
    expect(flags.get('agent')).toBe(true);
    expect(positional).toEqual(['extra']);
  });
  it('handles empty argv', () => {
    expect(parseArgs([]).cmd).toBe(null);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm install && npx vitest run tests/cli.test.mjs`
Expected: FAIL (cannot find `../src/cli.mjs`)

- [ ] **Step 4: Implement src/cli.mjs**

```js
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
```

- [ ] **Step 5: Run tests, verify pass, commit**

Run: `npx vitest run tests/cli.test.mjs` → PASS

```bash
git add package.json package-lock.json .gitignore src/cli.mjs tests/cli.test.mjs
git commit -m "feat: scaffold sensors CLI package with argv parsing"
```

---

### Task 2: Result schema

**Files:**
- Create: `src/schema.mjs`, `tests/schema.test.mjs`

**Interfaces:**
- Produces: `makeResult(sensorName, partial, { ranAt?, durationMs? })` → `{ sensor, status, score, detail, findings: [{file, line, message, guidance}], ranAt, durationMs }`. Unknown status coerces to `"error"`; non-finite score → `null`.

- [ ] **Step 1: Write the failing test**

`tests/schema.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { makeResult } from '../src/schema.mjs';

describe('makeResult', () => {
  it('fills all fields with defaults', () => {
    const r = makeResult('lint', { status: 'failure', score: 2, detail: '2 warnings' });
    expect(r.sensor).toBe('lint');
    expect(r.status).toBe('failure');
    expect(r.score).toBe(2);
    expect(r.findings).toEqual([]);
    expect(typeof r.ranAt).toBe('string');
    expect(r.durationMs).toBe(0);
  });
  it('coerces bad status to error and bad score to null', () => {
    const r = makeResult('x', { status: 'weird', score: NaN });
    expect(r.status).toBe('error');
    expect(r.score).toBe(null);
  });
  it('normalizes findings', () => {
    const r = makeResult('lint', { status: 'failure', findings: [{ file: 'a.ts', message: 'no-console' }] });
    expect(r.findings[0]).toEqual({ file: 'a.ts', line: 0, message: 'no-console', guidance: '' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/schema.test.mjs` → FAIL (module not found)

- [ ] **Step 3: Implement src/schema.mjs**

```js
const STATUSES = new Set(['success', 'failure', 'error']);

export function makeResult(sensorName, partial, { ranAt = new Date().toISOString(), durationMs = 0 } = {}) {
  return {
    sensor: sensorName,
    status: STATUSES.has(partial.status) ? partial.status : 'error',
    score: Number.isFinite(partial.score) ? partial.score : null,
    detail: partial.detail ?? '',
    findings: (partial.findings ?? []).map((f) => ({
      file: f.file ?? '',
      line: f.line ?? 0,
      message: f.message ?? '',
      guidance: f.guidance ?? '',
    })),
    ranAt,
    durationMs,
  };
}
```

- [ ] **Step 4: Run to verify pass, commit**

Run: `npx vitest run tests/schema.test.mjs` → PASS

```bash
git add src/schema.mjs tests/schema.test.mjs
git commit -m "feat: sensor result schema (makeResult)"
```

---

### Task 3: Config loader

**Files:**
- Create: `src/config.mjs`, `tests/config.test.mjs`

**Interfaces:**
- Produces: `loadConfig(cwd)` → `{ scoutingRule: bool, daemon: {enabled: bool}, sensors: Sensor[] }` where `Sensor = { name, parser, command, interval, level, score, prompt, resultFile, timeout, enabled, threshold, direction }`. Throws on missing file, wrong version, missing name/command, duplicate names. `CONFIG_PATH = '.sensors/sensors.yaml'` exported.

- [ ] **Step 1: Write the failing test**

`tests/config.test.mjs`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, CONFIG_PATH } from '../src/config.mjs';

function tmpProject(yamlText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  fs.writeFileSync(path.join(dir, CONFIG_PATH), yamlText);
  return dir;
}

describe('loadConfig', () => {
  it('normalizes sensors with defaults', () => {
    const dir = tmpProject(`
version: 1
sensors:
  - name: lint
    parser: eslint
    command: npx eslint . --format json
    level: fast
  - name: tests
    command: npx vitest run
`);
    const cfg = loadConfig(dir);
    expect(cfg.scoutingRule).toBe(true);
    expect(cfg.daemon.enabled).toBe(false);
    const lint = cfg.sensors[0];
    expect(lint.timeout).toBe(30000);           // fast default
    expect(lint.direction).toBe('lower');
    expect(lint.interval).toBe('trigger');       // default when unset
    const tests = cfg.sensors[1];
    expect(tests.parser).toBe('default');
    expect(tests.level).toBe('full');
    expect(tests.timeout).toBe(120000);          // full default
  });
  it('maps result_file to resultFile', () => {
    const dir = tmpProject(`
version: 1
sensors:
  - name: mutation
    command: npx stryker run
    result_file: reports/mutation.json
`);
    expect(loadConfig(dir).sensors[0].resultFile).toBe('reports/mutation.json');
  });
  it('throws on duplicate names', () => {
    const dir = tmpProject(`
version: 1
sensors:
  - { name: a, command: "true" }
  - { name: a, command: "true" }
`);
    expect(() => loadConfig(dir)).toThrow(/duplicate/);
  });
  it('throws when file is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-'));
    expect(() => loadConfig(dir)).toThrow(/sensors init/);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/config.test.mjs` → FAIL

- [ ] **Step 3: Implement src/config.mjs**

```js
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const CONFIG_PATH = path.join('.sensors', 'sensors.yaml');
const DEFAULT_TIMEOUTS = { fast: 30000, full: 120000 };

export function loadConfig(cwd) {
  const file = path.join(cwd, CONFIG_PATH);
  if (!fs.existsSync(file)) {
    throw new Error(`${CONFIG_PATH} not found. Run: sensors init`);
  }
  const raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || raw.version !== 1) throw new Error('sensors.yaml: expected `version: 1`');
  const sensors = (raw.sensors ?? []).map(normalizeSensor);
  const seen = new Set();
  for (const s of sensors) {
    if (seen.has(s.name)) throw new Error(`sensors.yaml: duplicate sensor name "${s.name}"`);
    seen.add(s.name);
  }
  return {
    scoutingRule: raw.scouting_rule !== false,
    daemon: { enabled: raw.daemon?.enabled === true },
    sensors,
  };
}

function normalizeSensor(s) {
  if (!s?.name || !s?.command) {
    throw new Error(`sensors.yaml: every sensor needs "name" and "command" (got: ${JSON.stringify(s)})`);
  }
  const level = s.level ?? 'full';
  return {
    name: s.name,
    parser: s.parser ?? 'default',
    command: s.command,
    interval: s.interval ?? 'trigger',
    level,
    score: s.score ?? '',
    prompt: s.prompt ?? '',
    resultFile: s.result_file ?? null,
    timeout: s.timeout ?? DEFAULT_TIMEOUTS[level] ?? DEFAULT_TIMEOUTS.full,
    enabled: s.enabled !== false,
    threshold: s.threshold ?? null,
    direction: s.direction ?? 'lower',
  };
}
```

- [ ] **Step 4: Run to verify pass, commit**

```bash
git add src/config.mjs tests/config.test.mjs
git commit -m "feat: sensors.yaml config loader with normalization"
```

---

### Task 4: Parser registry + default parser

**Files:**
- Create: `src/parsers/index.mjs`, `src/parsers/default.mjs`, `tests/parsers-default.test.mjs`

**Interfaces:**
- Produces: `getParser(name)` → parser fn or throws `Unknown parser`. Parser signature (all parsers): `({ stdout, stderr, exitCode, resultFileContent, sensor }) → { status, score, detail, findings? }` (partial result; runner wraps with `makeResult`). Registry exported as `registerParser(name, fn)` for later tasks.

- [ ] **Step 1: Write the failing test**

`tests/parsers-default.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { getParser } from '../src/parsers/index.mjs';

const parse = getParser('default');

describe('default parser', () => {
  it('success on exit 0', () => {
    expect(parse({ stdout: '', stderr: '', exitCode: 0 })).toEqual({ status: 'success', score: 0, detail: 'OK' });
  });
  it('failure on nonzero exit, score = output lines', () => {
    const r = parse({ stdout: 'bad thing\nother bad', stderr: '', exitCode: 1 });
    expect(r.status).toBe('failure');
    expect(r.score).toBe(2);
    expect(r.detail).toBe('bad thing');
  });
  it('passes through schema-shaped JSON on stdout', () => {
    const json = JSON.stringify({ status: 'failure', score: 7, detail: 'custom' });
    expect(parse({ stdout: json, stderr: '', exitCode: 1 }).score).toBe(7);
  });
  it('prefers resultFileContent over stdout', () => {
    const json = JSON.stringify({ status: 'success', score: 0, detail: 'from file' });
    expect(parse({ stdout: 'noise', stderr: '', exitCode: 0, resultFileContent: json }).detail).toBe('from file');
  });
  it('unknown parser name throws', () => {
    expect(() => getParser('nope')).toThrow(/Unknown parser/);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/parsers-default.test.mjs` → FAIL

- [ ] **Step 3: Implement**

`src/parsers/default.mjs`:

```js
export default function defaultParser({ stdout = '', stderr = '', exitCode, resultFileContent = null }) {
  const body = (resultFileContent ?? stdout).trim();
  if (body.startsWith('{')) {
    try {
      const j = JSON.parse(body);
      if (typeof j.status === 'string') {
        return { status: j.status, score: j.score ?? null, detail: j.detail ?? '', findings: j.findings ?? [] };
      }
    } catch { /* fall through to generic handling */ }
  }
  if (exitCode === 0) return { status: 'success', score: 0, detail: 'OK' };
  const lines = `${stdout}\n${stderr}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return { status: 'failure', score: lines.length, detail: lines[0]?.slice(0, 200) ?? `exit ${exitCode}` };
}
```

`src/parsers/index.mjs`:

```js
import defaultParser from './default.mjs';

const registry = new Map([['default', defaultParser]]);

export function registerParser(name, fn) {
  registry.set(name, fn);
}

export function getParser(name) {
  const p = registry.get(name);
  if (!p) throw new Error(`Unknown parser: ${name}`);
  return p;
}
```

- [ ] **Step 4: Run to verify pass, commit**

```bash
git add src/parsers tests/parsers-default.test.mjs
git commit -m "feat: parser registry and default parser"
```

---

### Task 5: eslint parser

**Files:**
- Create: `src/parsers/eslint.mjs`, `tests/fixtures/eslint.json`, `tests/parsers-eslint.test.mjs`
- Modify: `src/parsers/index.mjs`

**Interfaces:**
- Consumes: parser signature from Task 4.
- Produces: registered parser `eslint`. Score = total errors+warnings; findings carry `ruleId: message`.

- [ ] **Step 1: Create fixture** — `tests/fixtures/eslint.json` (real `eslint --format json` shape):

```json
[
  { "filePath": "/repo/server/index.ts", "messages": [
      { "ruleId": "no-console", "severity": 1, "message": "Unexpected console statement.", "line": 19, "column": 3 }
    ], "errorCount": 0, "warningCount": 1 },
  { "filePath": "/repo/server/ok.ts", "messages": [], "errorCount": 0, "warningCount": 0 }
]
```

- [ ] **Step 2: Write the failing test**

`tests/parsers-eslint.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getParser } from '../src/parsers/index.mjs';

const stdout = fs.readFileSync(new URL('./fixtures/eslint.json', import.meta.url), 'utf8');
const parse = getParser('eslint');

describe('eslint parser', () => {
  it('counts problems and extracts findings', () => {
    const r = parse({ stdout, stderr: '', exitCode: 1 });
    expect(r.status).toBe('failure');
    expect(r.score).toBe(1);
    expect(r.detail).toBe('1 problem');
    expect(r.findings[0]).toMatchObject({ file: '/repo/server/index.ts', line: 19, message: 'no-console: Unexpected console statement.' });
  });
  it('success when clean', () => {
    const r = parse({ stdout: '[]', stderr: '', exitCode: 0 });
    expect(r).toMatchObject({ status: 'success', score: 0 });
  });
  it('error on unparseable output', () => {
    expect(parse({ stdout: 'not json', stderr: '', exitCode: 2 }).status).toBe('error');
  });
});
```

- [ ] **Step 3: Run to verify fail** — `npx vitest run tests/parsers-eslint.test.mjs` → FAIL

- [ ] **Step 4: Implement src/parsers/eslint.mjs and register**

```js
export default function eslintParser({ stdout = '', resultFileContent = null }) {
  let files;
  try {
    files = JSON.parse((resultFileContent ?? stdout).trim());
  } catch {
    return { status: 'error', detail: 'could not parse eslint JSON output' };
  }
  const findings = files.flatMap((f) =>
    f.messages.map((m) => ({
      file: f.filePath,
      line: m.line ?? 0,
      message: `${m.ruleId ?? 'parse'}: ${m.message}`,
    })),
  );
  const score = findings.length;
  return {
    status: score === 0 ? 'success' : 'failure',
    score,
    detail: score === 0 ? 'No issues' : `${score} problem${score === 1 ? '' : 's'}`,
    findings,
  };
}
```

In `src/parsers/index.mjs` add:

```js
import eslintParser from './eslint.mjs';
// after registry creation:
registry.set('eslint', eslintParser);
```

- [ ] **Step 5: Run to verify pass, commit**

```bash
git add src/parsers tests/fixtures/eslint.json tests/parsers-eslint.test.mjs
git commit -m "feat: eslint parser"
```

---

### Task 6: tsc parser

**Files:**
- Create: `src/parsers/tsc.mjs`, `tests/parsers-tsc.test.mjs`
- Modify: `src/parsers/index.mjs`

**Interfaces:**
- Produces: registered parser `tsc`. Parses `path(line,col): error TSxxxx: msg` lines from stdout.

- [ ] **Step 1: Write the failing test**

`tests/parsers-tsc.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { getParser } from '../src/parsers/index.mjs';

const parse = getParser('tsc');
const out = `src/a.ts(10,5): error TS2304: Cannot find name 'foo'.
src/b.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.
Found 2 errors in 2 files.`;

describe('tsc parser', () => {
  it('counts type errors with locations', () => {
    const r = parse({ stdout: out, stderr: '', exitCode: 2 });
    expect(r).toMatchObject({ status: 'failure', score: 2, detail: '2 type errors' });
    expect(r.findings[0]).toMatchObject({ file: 'src/a.ts', line: 10, message: "TS2304: Cannot find name 'foo'." });
  });
  it('success on clean run', () => {
    expect(parse({ stdout: '', stderr: '', exitCode: 0 })).toMatchObject({ status: 'success', score: 0, detail: 'No errors' });
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/parsers-tsc.test.mjs` → FAIL

- [ ] **Step 3: Implement src/parsers/tsc.mjs and register**

```js
const LINE_RE = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/gm;

export default function tscParser({ stdout = '', exitCode }) {
  const findings = [...stdout.matchAll(LINE_RE)].map(([, file, line, code, msg]) => ({
    file,
    line: Number(line),
    message: `${code}: ${msg}`,
  }));
  if (findings.length === 0 && exitCode !== 0) {
    return { status: 'error', detail: `tsc exited ${exitCode} with no parseable errors` };
  }
  const score = findings.length;
  return {
    status: score === 0 ? 'success' : 'failure',
    score,
    detail: score === 0 ? 'No errors' : `${score} type error${score === 1 ? '' : 's'}`,
    findings,
  };
}
```

Register in `src/parsers/index.mjs`: `registry.set('tsc', tscParser);` (with import).

- [ ] **Step 4: Run to verify pass, commit**

```bash
git add src/parsers tests/parsers-tsc.test.mjs
git commit -m "feat: tsc parser"
```

---

### Task 7: vitest parser

**Files:**
- Create: `src/parsers/vitest.mjs`, `tests/fixtures/vitest.json`, `tests/parsers-vitest.test.mjs`
- Modify: `src/parsers/index.mjs`

**Interfaces:**
- Produces: registered parser `vitest`. Score = failed tests; detail `N passed` / `N failed, M passed`.

- [ ] **Step 1: Create fixture** — `tests/fixtures/vitest.json` (shape of `vitest run --reporter=json`):

```json
{
  "numTotalTests": 4, "numPassedTests": 3, "numFailedTests": 1, "success": false,
  "testResults": [
    { "name": "/repo/tests/math.test.ts", "status": "failed",
      "assertionResults": [
        { "status": "passed", "title": "adds" },
        { "status": "failed", "title": "divides", "failureMessages": ["expected 2 to be 3"] }
      ] }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`tests/parsers-vitest.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getParser } from '../src/parsers/index.mjs';

const stdout = fs.readFileSync(new URL('./fixtures/vitest.json', import.meta.url), 'utf8');
const parse = getParser('vitest');

describe('vitest parser', () => {
  it('reports failed count as score with findings', () => {
    const r = parse({ stdout, stderr: '', exitCode: 1 });
    expect(r).toMatchObject({ status: 'failure', score: 1, detail: '1 failed, 3 passed' });
    expect(r.findings[0]).toMatchObject({ file: '/repo/tests/math.test.ts', message: 'divides: expected 2 to be 3' });
  });
  it('success when all pass', () => {
    const clean = JSON.stringify({ numTotalTests: 5, numPassedTests: 5, numFailedTests: 0, success: true, testResults: [] });
    expect(parse({ stdout: clean, stderr: '', exitCode: 0 })).toMatchObject({ status: 'success', score: 0, detail: '5 passed' });
  });
});
```

- [ ] **Step 3: Run to verify fail** — `npx vitest run tests/parsers-vitest.test.mjs` → FAIL

- [ ] **Step 4: Implement src/parsers/vitest.mjs and register**

```js
export default function vitestParser({ stdout = '', resultFileContent = null }) {
  let j;
  try {
    // vitest may print non-JSON noise before the report; find first '{'
    const body = (resultFileContent ?? stdout);
    j = JSON.parse(body.slice(body.indexOf('{')));
  } catch {
    return { status: 'error', detail: 'could not parse vitest JSON output' };
  }
  const failed = j.numFailedTests ?? 0;
  const passed = j.numPassedTests ?? 0;
  const findings = (j.testResults ?? [])
    .flatMap((tr) => (tr.assertionResults ?? [])
      .filter((a) => a.status === 'failed')
      .map((a) => ({ file: tr.name ?? '', line: 0, message: `${a.title}: ${(a.failureMessages ?? [])[0] ?? 'failed'}` })));
  return {
    status: failed === 0 ? 'success' : 'failure',
    score: failed,
    detail: failed === 0 ? `${passed} passed` : `${failed} failed, ${passed} passed`,
    findings,
  };
}
```

Register: `registry.set('vitest', vitestParser);`

- [ ] **Step 5: Run to verify pass, commit**

```bash
git add src/parsers tests/fixtures/vitest.json tests/parsers-vitest.test.mjs
git commit -m "feat: vitest parser"
```

---

### Task 8: coverage parser

**Files:**
- Create: `src/parsers/coverage.mjs`, `tests/fixtures/coverage-final.json`, `tests/parsers-coverage.test.mjs`
- Modify: `src/parsers/index.mjs`

**Interfaces:**
- Produces: registered parser `coverage` (istanbul `coverage-final.json` via `result_file`). Score = statement coverage % (0–100, 2 decimals). Sensors using it must set `direction: higher` — `sensors init` does this.

- [ ] **Step 1: Create fixture** — `tests/fixtures/coverage-final.json` (istanbul shape, trimmed):

```json
{
  "/repo/src/a.ts": { "s": { "0": 1, "1": 1, "2": 0 } },
  "/repo/src/b.ts": { "s": { "0": 1 } }
}
```

- [ ] **Step 2: Write the failing test**

`tests/parsers-coverage.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getParser } from '../src/parsers/index.mjs';

const content = fs.readFileSync(new URL('./fixtures/coverage-final.json', import.meta.url), 'utf8');
const parse = getParser('coverage');

describe('coverage parser', () => {
  it('computes statement coverage percentage', () => {
    const r = parse({ stdout: '', stderr: '', exitCode: 0, resultFileContent: content });
    expect(r.status).toBe('success');
    expect(r.score).toBe(75); // 3 of 4 statements covered
    expect(r.detail).toBe('75% statements');
  });
  it('error when result file missing', () => {
    expect(parse({ stdout: '', stderr: '', exitCode: 0, resultFileContent: null }).status).toBe('error');
  });
});
```

- [ ] **Step 3: Run to verify fail** — `npx vitest run tests/parsers-coverage.test.mjs` → FAIL

- [ ] **Step 4: Implement src/parsers/coverage.mjs and register**

```js
export default function coverageParser({ resultFileContent = null }) {
  if (!resultFileContent) return { status: 'error', detail: 'coverage result file not found (set result_file)' };
  let files;
  try {
    files = JSON.parse(resultFileContent);
  } catch {
    return { status: 'error', detail: 'could not parse coverage-final.json' };
  }
  let total = 0;
  let covered = 0;
  for (const f of Object.values(files)) {
    for (const hits of Object.values(f.s ?? {})) {
      total += 1;
      if (hits > 0) covered += 1;
    }
  }
  const pct = total === 0 ? 0 : Math.round((covered / total) * 10000) / 100;
  return { status: 'success', score: pct, detail: `${pct}% statements` };
}
```

Register: `registry.set('coverage', coverageParser);`

- [ ] **Step 5: Run to verify pass, commit**

```bash
git add src/parsers tests/fixtures/coverage-final.json tests/parsers-coverage.test.mjs
git commit -m "feat: istanbul coverage parser"
```

---

### Task 9: ruff + pytest parsers

**Files:**
- Create: `src/parsers/ruff.mjs`, `src/parsers/pytest.mjs`, `tests/fixtures/ruff.json`, `tests/parsers-python.test.mjs`
- Modify: `src/parsers/index.mjs`

**Interfaces:**
- Produces: registered parsers `ruff` (JSON output of `ruff check --output-format json`) and `pytest` (summary-line regex on stdout; no plugin dependency).

- [ ] **Step 1: Create fixture** — `tests/fixtures/ruff.json`:

```json
[
  { "filename": "app/main.py", "code": "F401", "message": "`os` imported but unused", "location": { "row": 3, "column": 8 } }
]
```

- [ ] **Step 2: Write the failing test**

`tests/parsers-python.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getParser } from '../src/parsers/index.mjs';

const ruffOut = fs.readFileSync(new URL('./fixtures/ruff.json', import.meta.url), 'utf8');

describe('ruff parser', () => {
  const parse = getParser('ruff');
  it('extracts violations', () => {
    const r = parse({ stdout: ruffOut, stderr: '', exitCode: 1 });
    expect(r).toMatchObject({ status: 'failure', score: 1 });
    expect(r.findings[0]).toMatchObject({ file: 'app/main.py', line: 3, message: 'F401: `os` imported but unused' });
  });
  it('clean run', () => {
    expect(parse({ stdout: '[]', stderr: '', exitCode: 0 })).toMatchObject({ status: 'success', score: 0 });
  });
});

describe('pytest parser', () => {
  const parse = getParser('pytest');
  it('parses failed summary', () => {
    const out = 'FAILED tests/test_x.py::test_a - AssertionError\n========= 1 failed, 3 passed in 0.12s =========';
    expect(parse({ stdout: out, stderr: '', exitCode: 1 })).toMatchObject({ status: 'failure', score: 1, detail: '1 failed, 3 passed' });
  });
  it('parses all-passed summary', () => {
    const out = '========= 4 passed in 0.10s =========';
    expect(parse({ stdout: out, stderr: '', exitCode: 0 })).toMatchObject({ status: 'success', score: 0, detail: '4 passed' });
  });
  it('error when summary is missing', () => {
    expect(parse({ stdout: 'garbage', stderr: '', exitCode: 3 }).status).toBe('error');
  });
});
```

- [ ] **Step 3: Run to verify fail** — `npx vitest run tests/parsers-python.test.mjs` → FAIL

- [ ] **Step 4: Implement**

`src/parsers/ruff.mjs`:

```js
export default function ruffParser({ stdout = '', exitCode }) {
  let items;
  try {
    items = JSON.parse(stdout.trim() || '[]');
  } catch {
    return { status: 'error', detail: `could not parse ruff JSON output (exit ${exitCode})` };
  }
  const findings = items.map((v) => ({
    file: v.filename,
    line: v.location?.row ?? 0,
    message: `${v.code}: ${v.message}`,
  }));
  const score = findings.length;
  return {
    status: score === 0 ? 'success' : 'failure',
    score,
    detail: score === 0 ? 'No issues' : `${score} issue${score === 1 ? '' : 's'}`,
    findings,
  };
}
```

`src/parsers/pytest.mjs`:

```js
export default function pytestParser({ stdout = '', exitCode }) {
  const failed = Number(stdout.match(/(\d+) failed/)?.[1] ?? 0);
  const passed = Number(stdout.match(/(\d+) passed/)?.[1] ?? 0);
  if (failed === 0 && passed === 0) {
    return { status: 'error', detail: `no pytest summary found (exit ${exitCode})` };
  }
  const findings = [...stdout.matchAll(/^FAILED (\S+?)(?:\s+-\s+(.*))?$/gm)]
    .map(([, id, reason]) => ({ file: id.split('::')[0], line: 0, message: `${id}${reason ? `: ${reason}` : ''}` }));
  return {
    status: failed === 0 ? 'success' : 'failure',
    score: failed,
    detail: failed === 0 ? `${passed} passed` : `${failed} failed, ${passed} passed`,
    findings,
  };
}
```

Register both in `src/parsers/index.mjs`.

- [ ] **Step 5: Run to verify pass, commit**

```bash
git add src/parsers tests/fixtures/ruff.json tests/parsers-python.test.mjs
git commit -m "feat: ruff and pytest parsers"
```

---

### Task 10: Runner

**Files:**
- Create: `src/runner.mjs`, `tests/runner.test.mjs`

**Interfaces:**
- Consumes: `getParser` (Task 4), `makeResult` (Task 2), Sensor shape (Task 3).
- Produces: `runSensor(sensor, { cwd, file? })` → Promise<Result>; never rejects. `runSensors(sensors, opts)` → Promise<Result[]> (sequential). `{file}` placeholder in command replaced by changed file or `.`.

- [ ] **Step 1: Write the failing test**

`tests/runner.test.mjs` (uses `node -e` as a portable fake tool):

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runSensor } from '../src/runner.mjs';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-run-'));

function sensor(over = {}) {
  return {
    name: 't', parser: 'default', command: 'node -e "process.exit(0)"', interval: 1000,
    level: 'fast', score: '', prompt: '', resultFile: null, timeout: 5000,
    enabled: true, threshold: null, direction: 'lower', ...over,
  };
}

describe('runSensor', () => {
  it('success path fills schema fields', async () => {
    const r = await runSensor(sensor(), { cwd });
    expect(r).toMatchObject({ sensor: 't', status: 'success', score: 0 });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
  it('failure path captures output', async () => {
    const cmd = `node -e "console.log('boom'); process.exit(1)"`;
    const r = await runSensor(sensor({ command: cmd }), { cwd });
    expect(r.status).toBe('failure');
    expect(r.detail).toBe('boom');
  });
  it('timeout yields error, not throw', async () => {
    const r = await runSensor(sensor({ command: 'node -e "setTimeout(()=>{},10000)"', timeout: 300 }), { cwd });
    expect(r.status).toBe('error');
    expect(r.detail).toMatch(/timed out/);
  });
  it('replaces {file} placeholder', async () => {
    const cmd = `node -e "console.log(process.argv[1]); process.exit(1)" {file}`;
    const r = await runSensor(sensor({ command: cmd }), { cwd, file: 'src/x.ts' });
    expect(r.detail).toBe('src/x.ts');
  });
  it('reads result_file when configured', async () => {
    fs.writeFileSync(path.join(cwd, 'out.json'), JSON.stringify({ status: 'failure', score: 9, detail: 'from file' }));
    const r = await runSensor(sensor({ command: 'node -e "process.exit(0)"', resultFile: 'out.json' }), { cwd });
    expect(r).toMatchObject({ status: 'failure', score: 9 });
  });
  it('unknown parser is fail-open error', async () => {
    const r = await runSensor(sensor({ parser: 'nope' }), { cwd });
    expect(r.status).toBe('error');
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/runner.test.mjs` → FAIL

- [ ] **Step 3: Implement src/runner.mjs**

```js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getParser } from './parsers/index.mjs';
import { makeResult } from './schema.mjs';

export async function runSensor(sensorCfg, { cwd, file = null } = {}) {
  const started = Date.now();
  try {
    const parser = getParser(sensorCfg.parser);
    const command = sensorCfg.command.replaceAll('{file}', file ?? '.');
    const { stdout, stderr, exitCode, timedOut } = await execShell(command, cwd, sensorCfg.timeout);
    if (timedOut) {
      return makeResult(sensorCfg.name, { status: 'error', detail: `timed out after ${sensorCfg.timeout}ms` }, { durationMs: Date.now() - started });
    }
    let resultFileContent = null;
    if (sensorCfg.resultFile) {
      const p = path.join(cwd, sensorCfg.resultFile);
      resultFileContent = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    }
    const parsed = parser({ stdout, stderr, exitCode, resultFileContent, sensor: sensorCfg });
    return makeResult(sensorCfg.name, parsed, { durationMs: Date.now() - started });
  } catch (err) {
    return makeResult(sensorCfg.name, { status: 'error', detail: String(err?.message ?? err) }, { durationMs: Date.now() - started });
  }
}

export async function runSensors(sensors, opts) {
  const results = [];
  for (const s of sensors) results.push(await runSensor(s, opts)); // sequential: parallel runs skew durations and fight over CPU
  return results;
}

function execShell(command, cwd, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      resolve({ stdout, stderr, exitCode: null, timedOut: true });
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      if (settled) return;
      clearTimeout(timer);
      resolve({ stdout, stderr: String(err), exitCode: null, timedOut: false });
    });
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut: false });
    });
  });
}
```

- [ ] **Step 4: Run to verify pass, commit**

```bash
git add src/runner.mjs tests/runner.test.mjs
git commit -m "feat: sensor runner with timeout, result_file and fail-open"
```

---

### Task 11: State store, events, history

**Files:**
- Create: `src/state.mjs`, `tests/state.test.mjs`

**Interfaces:**
- Produces: `stateDir(cwd)`, `writeAtomic(file, content)`, `readState(cwd)` → `{updatedAt, results: {name: Result}}`, `updateState(cwd, results)` (merge + atomic write), `computeEvent(prev, curr, {threshold, direction})` → `initial|steady|regression|recovery|improvement|worsening|below_threshold`, `appendHistory(cwd, result, event)` → appends to `history.jsonl`, `readHistory(cwd, sensorName?)` → entries[].

- [ ] **Step 1: Write the failing test**

`tests/state.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readState, updateState, computeEvent, appendHistory, readHistory } from '../src/state.mjs';

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-state-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  return dir;
}
const res = (over = {}) => ({ sensor: 'lint', status: 'success', score: 0, detail: '', findings: [], ranAt: new Date().toISOString(), durationMs: 5, ...over });

describe('state', () => {
  it('round-trips results through state.json', () => {
    const dir = tmp();
    updateState(dir, [res()]);
    expect(readState(dir).results.lint.status).toBe('success');
  });
  it('merges per sensor', () => {
    const dir = tmp();
    updateState(dir, [res()]);
    updateState(dir, [res({ sensor: 'tests', status: 'failure', score: 1 })]);
    const s = readState(dir);
    expect(Object.keys(s.results).sort()).toEqual(['lint', 'tests']);
  });
});

describe('computeEvent', () => {
  const base = { threshold: null, direction: 'lower' };
  it('initial without previous', () => expect(computeEvent(null, res(), base)).toBe('initial'));
  it('regression success→failure', () =>
    expect(computeEvent(res(), res({ status: 'failure', score: 3 }), base)).toBe('regression'));
  it('recovery failure→success', () =>
    expect(computeEvent(res({ status: 'failure', score: 3 }), res(), base)).toBe('recovery'));
  it('worsening on higher score (direction lower)', () =>
    expect(computeEvent(res({ status: 'failure', score: 1 }), res({ status: 'failure', score: 4 }), base)).toBe('worsening'));
  it('improvement on lower score', () =>
    expect(computeEvent(res({ status: 'failure', score: 4 }), res({ status: 'failure', score: 1 }), base)).toBe('improvement'));
  it('steady when unchanged', () => expect(computeEvent(res(), res(), base)).toBe('steady'));
  it('below_threshold for direction higher under threshold', () =>
    expect(computeEvent(res({ score: 60 }), res({ score: 60 }), { threshold: 80, direction: 'higher' })).toBe('below_threshold'));
});

describe('history', () => {
  it('appends and reads back jsonl', () => {
    const dir = tmp();
    appendHistory(dir, res(), 'initial');
    appendHistory(dir, res({ sensor: 'tests' }), 'initial');
    expect(readHistory(dir).length).toBe(2);
    expect(readHistory(dir, 'lint').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/state.test.mjs` → FAIL

- [ ] **Step 3: Implement src/state.mjs**

```js
import fs from 'node:fs';
import path from 'node:path';

export function stateDir(cwd) {
  return path.join(cwd, '.sensors');
}

export function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function readState(cwd) {
  const f = path.join(stateDir(cwd), 'state.json');
  if (!fs.existsSync(f)) return { updatedAt: null, results: {} };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function updateState(cwd, results) {
  const state = readState(cwd);
  for (const r of results) state.results[r.sensor] = r;
  state.updatedAt = new Date().toISOString();
  writeAtomic(path.join(stateDir(cwd), 'state.json'), JSON.stringify(state, null, 2));
  return state;
}

export function computeEvent(prev, curr, { threshold = null, direction = 'lower' } = {}) {
  if (!prev) return 'initial';
  if (prev.status === 'success' && curr.status === 'failure') return 'regression';
  if (prev.status === 'failure' && curr.status === 'success') return 'recovery';
  if (prev.score == null || curr.score == null || prev.score === curr.score) {
    return isBelowThreshold(curr, threshold, direction) ? 'below_threshold' : 'steady';
  }
  const improved = direction === 'lower' ? curr.score < prev.score : curr.score > prev.score;
  return improved ? 'improvement' : 'worsening';
}

function isBelowThreshold(curr, threshold, direction) {
  if (threshold == null || curr.score == null) return false;
  return direction === 'higher' ? curr.score < threshold : curr.score > threshold;
}

export function appendHistory(cwd, result, event) {
  const entry = { sensor: result.sensor, ts: result.ranAt, status: result.status, score: result.score, event, elapsed: result.durationMs };
  fs.appendFileSync(path.join(stateDir(cwd), 'history.jsonl'), `${JSON.stringify(entry)}\n`);
}

export function readHistory(cwd, sensorName = null) {
  const f = path.join(stateDir(cwd), 'history.jsonl');
  if (!fs.existsSync(f)) return [];
  const entries = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return sensorName ? entries.filter((e) => e.sensor === sensorName) : entries;
}
```

- [ ] **Step 4: Run to verify pass, commit**

```bash
git add src/state.mjs tests/state.test.mjs
git commit -m "feat: state store, trend events and history log"
```

---

### Task 12: Snapshot + regression detection

**Files:**
- Create: `src/snapshot.mjs`, `tests/snapshot.test.mjs`

**Interfaces:**
- Consumes: `readState`, `writeAtomic`, `stateDir` (Task 11).
- Produces: `takeSnapshot(cwd)`, `readSnapshot(cwd)` → `{takenAt, results}|null`, `compareToSnapshot(snapshot, result)` → `"Same as snapshot" | "No snapshot" | "Changed since snapshot (a → b)"`, `isRegression(snapshot, result, sensorCfg)` → bool (threshold- and direction-aware per spec §3).

- [ ] **Step 1: Write the failing test**

`tests/snapshot.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { updateState } from '../src/state.mjs';
import { takeSnapshot, readSnapshot, compareToSnapshot, isRegression } from '../src/snapshot.mjs';

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-snap-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  return dir;
}
const res = (over = {}) => ({ sensor: 'lint', status: 'success', score: 0, detail: '', findings: [], ranAt: new Date().toISOString(), durationMs: 1, ...over });
const cfg = (over = {}) => ({ name: 'lint', threshold: null, direction: 'lower', ...over });

describe('snapshot', () => {
  it('takes snapshot from current state and compares', () => {
    const dir = tmp();
    updateState(dir, [res()]);
    takeSnapshot(dir);
    const snap = readSnapshot(dir);
    expect(compareToSnapshot(snap, res())).toBe('Same as snapshot');
    expect(compareToSnapshot(snap, res({ status: 'failure', score: 2 }))).toBe('Changed since snapshot (0 → 2)');
    expect(compareToSnapshot(snap, res({ sensor: 'new' }))).toBe('No snapshot');
  });
});

describe('isRegression', () => {
  const dir = tmp();
  updateState(dir, [res(), res({ sensor: 'cov', score: 80 })]);
  takeSnapshot(dir);
  const snap = readSnapshot(dir);

  it('status flip success→failure is regression', () => {
    expect(isRegression(snap, res({ status: 'failure', score: 1 }), cfg())).toBe(true);
  });
  it('score worsening without threshold is regression', () => {
    expect(isRegression(snap, res({ status: 'success', score: 3 }), cfg())).toBe(true);
  });
  it('coverage drop above threshold is NOT regression', () => {
    expect(isRegression(snap, res({ sensor: 'cov', score: 79 }), cfg({ name: 'cov', direction: 'higher', threshold: 70 }))).toBe(false);
  });
  it('coverage drop below threshold IS regression', () => {
    expect(isRegression(snap, res({ sensor: 'cov', score: 65 }), cfg({ name: 'cov', direction: 'higher', threshold: 70 }))).toBe(true);
  });
  it('no snapshot entry → not a regression', () => {
    expect(isRegression(snap, res({ sensor: 'ghost', status: 'failure' }), cfg({ name: 'ghost' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/snapshot.test.mjs` → FAIL

- [ ] **Step 3: Implement src/snapshot.mjs**

```js
import fs from 'node:fs';
import path from 'node:path';
import { stateDir, writeAtomic, readState } from './state.mjs';

export function takeSnapshot(cwd) {
  const state = readState(cwd);
  const snap = { takenAt: new Date().toISOString(), results: state.results };
  writeAtomic(path.join(stateDir(cwd), 'snapshot.json'), JSON.stringify(snap, null, 2));
  return snap;
}

export function readSnapshot(cwd) {
  const f = path.join(stateDir(cwd), 'snapshot.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

export function compareToSnapshot(snapshot, result) {
  const prev = snapshot?.results?.[result.sensor];
  if (!prev) return 'No snapshot';
  if (prev.status === result.status && prev.score === result.score) return 'Same as snapshot';
  const delta = prev.score != null && result.score != null ? ` (${prev.score} → ${result.score})` : '';
  return `Changed since snapshot${delta}`;
}

export function isRegression(snapshot, result, sensorCfg) {
  const prev = snapshot?.results?.[result.sensor];
  if (!prev) return false;
  if (prev.status === 'success' && result.status === 'failure') return true;
  if (prev.score == null || result.score == null) return false;
  const worse = sensorCfg.direction === 'higher' ? result.score < prev.score : result.score > prev.score;
  if (!worse) return false;
  if (sensorCfg.threshold == null) return true;
  // with a threshold, only breaching it counts as regression (spec §3)
  return sensorCfg.direction === 'higher' ? result.score < sensorCfg.threshold : result.score > sensorCfg.threshold;
}
```

- [ ] **Step 4: Run to verify pass, commit**

```bash
git add src/snapshot.mjs tests/snapshot.test.mjs
git commit -m "feat: snapshot comparison and regression detection"
```

---

### Task 13: Summary formatters

**Files:**
- Create: `src/summary.mjs`, `tests/summary.test.mjs`

**Interfaces:**
- Consumes: `compareToSnapshot` (Task 12), config shape (Task 3), Result (Task 2).
- Produces: `formatAgent(results, { config, snapshot, now? })` → string in spec §7 format; `formatLine(results)` → one-line statusline string. Findings capped at 20 per sensor.

- [ ] **Step 1: Write the failing test**

`tests/summary.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { formatAgent, formatLine } from '../src/summary.mjs';

const config = {
  scoutingRule: true,
  sensors: [
    { name: 'lint', command: 'npm run lint', score: 'Number of lint issues (lower is better)', prompt: '' },
    { name: 'tests', command: 'npx vitest run', score: '', prompt: 'We expect the number of tests to go up.' },
  ],
};
const now = Date.parse('2026-07-10T14:00:10Z');
const results = [
  { sensor: 'lint', status: 'failure', score: 1, detail: '1 problem', findings: [{ file: './server/index.ts', line: 19, message: 'no-console: Unexpected console statement.', guidance: 'Use logger instead.' }], ranAt: '2026-07-10T14:00:02Z', durationMs: 800 },
  { sensor: 'tests', status: 'success', score: 0, detail: '326 passed', findings: [], ranAt: '2026-07-10T14:00:03Z', durationMs: 700 },
];
const snapshot = { takenAt: '2026-07-10T13:00:00Z', results: { lint: { ...results[0] }, tests: { ...results[1] } } };

describe('formatAgent', () => {
  const out = formatAgent(results, { config, snapshot, now });
  it('has header, scouting rule and per-sensor lines', () => {
    expect(out).toMatch(/^SENSORS STATUS/);
    expect(out).toContain('Follow scouting rule');
    expect(out).toContain('lint: FAILURE (1 problem) [ran 8s ago] | Same as snapshot');
    expect(out).toContain('cmd: `npm run lint`, score: Number of lint issues (lower is better)');
    expect(out).toContain('./server/index.ts:19 no-console: Unexpected console statement. — Use logger instead.');
    expect(out).toContain('prompt: We expect the number of tests to go up.');
  });
  it('omits scouting rule when disabled', () => {
    expect(formatAgent(results, { config: { ...config, scoutingRule: false }, snapshot, now })).not.toContain('scouting');
  });
});

describe('formatLine', () => {
  it('summarizes one char per sensor', () => {
    expect(formatLine(results)).toBe('●! lint:✗1 tests:✓0');
  });
  it('handles empty', () => {
    expect(formatLine([])).toBe('sensors: no data');
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/summary.test.mjs` → FAIL

- [ ] **Step 3: Implement src/summary.mjs**

```js
import { compareToSnapshot } from './snapshot.mjs';

const SCOUTING_RULE =
  "Follow scouting rule: if sensors are reporting issues you didn't cause with a change, " +
  "consider to leave the code better than you found it, if it's a small change.";
const MAX_FINDINGS = 20;

export function formatAgent(results, { config, snapshot = null, now = Date.now() }) {
  const lines = [`SENSORS STATUS  Updated: ${new Date(now).toISOString()}`, ''];
  if (config.scoutingRule) lines.push(SCOUTING_RULE, '');
  for (const r of results) {
    const cfg = config.sensors.find((s) => s.name === r.sensor) ?? {};
    const ago = Math.max(0, Math.round((now - Date.parse(r.ranAt)) / 1000));
    lines.push(`${r.sensor}: ${r.status.toUpperCase()} (${r.detail}) [ran ${ago}s ago] | ${compareToSnapshot(snapshot, r)}`);
    if (cfg.command) lines.push(`  cmd: \`${cfg.command}\`${cfg.score ? `, score: ${cfg.score}` : ''}`);
    for (const f of r.findings.slice(0, MAX_FINDINGS)) {
      lines.push(`  ${f.file}:${f.line} ${f.message}${f.guidance ? ` — ${f.guidance}` : ''}`);
    }
    if (r.findings.length > MAX_FINDINGS) lines.push(`  … and ${r.findings.length - MAX_FINDINGS} more`);
    if (cfg.prompt) lines.push(`  prompt: ${cfg.prompt}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function formatLine(results) {
  if (results.length === 0) return 'sensors: no data';
  const anyFailure = results.some((r) => r.status === 'failure');
  const anyError = results.some((r) => r.status === 'error');
  const dot = anyFailure ? '●!' : anyError ? '●?' : '●';
  const parts = results.map((r) => {
    const mark = r.status === 'success' ? '✓' : r.status === 'failure' ? '✗' : '?';
    return `${r.sensor}:${mark}${r.score ?? ''}`;
  });
  return `${dot} ${parts.join(' ')}`;
}
```

- [ ] **Step 4: Run to verify pass, commit**

```bash
git add src/summary.mjs tests/summary.test.mjs
git commit -m "feat: agent summary and statusline formatters"
```

---

### Task 14: Stack detection + `sensors init`

**Files:**
- Create: `src/detect.mjs`, `src/commands/init.mjs`, `tests/detect.test.mjs`
- Modify: `src/cli.mjs` (wire `init`)

**Interfaces:**
- Consumes: `CONFIG_PATH` (Task 3).
- Produces: `detectSensors(cwd)` → sensor config objects (yaml-shaped, snake_case). `runInit(cwd)` → writes `.sensors/sensors.yaml` + `.sensors/.gitignore`, returns `{created: bool, sensors: string[]}`; refuses to overwrite existing config.

- [ ] **Step 1: Write the failing test**

`tests/detect.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectSensors } from '../src/detect.mjs';
import { runInit } from '../src/commands/init.mjs';
import { loadConfig } from '../src/config.mjs';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-detect-')); }

describe('detectSensors', () => {
  it('detects TS/JS tools from package.json', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      devDependencies: { eslint: '^9.0.0', typescript: '^5.0.0', vitest: '^3.0.0' },
    }));
    const names = detectSensors(dir).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['lint', 'typecheck', 'tests', 'coverage']));
  });
  it('detects Python tools from pyproject.toml', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n[tool.pytest.ini_options]\n');
    const names = detectSensors(dir).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['lint', 'tests']));
  });
  it('empty repo detects nothing', () => {
    expect(detectSensors(tmp())).toEqual([]);
  });
});

describe('runInit', () => {
  it('writes loadable config plus gitignore', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^9.0.0' } }));
    const { created, sensors } = runInit(dir);
    expect(created).toBe(true);
    expect(sensors).toContain('lint');
    const cfg = loadConfig(dir); // must round-trip through the real loader
    expect(cfg.sensors.find((s) => s.name === 'lint').parser).toBe('eslint');
    expect(fs.readFileSync(path.join(dir, '.sensors/.gitignore'), 'utf8')).toContain('state.json');
  });
  it('does not overwrite existing config', () => {
    const dir = tmp();
    runInit(dir);
    expect(runInit(dir).created).toBe(false);
  });
  it('empty repo gets commented example', () => {
    const dir = tmp();
    runInit(dir);
    const text = fs.readFileSync(path.join(dir, '.sensors/sensors.yaml'), 'utf8');
    expect(text).toContain('# - name: my-sensor');
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/detect.test.mjs` → FAIL

- [ ] **Step 3: Implement**

`src/detect.mjs`:

```js
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
```

`src/commands/init.mjs`:

```js
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
```

Wire in `src/cli.mjs` `main()` switch (replace the `Unknown command` fallback):

```js
  const cwd = process.cwd();
  if (cmd === 'init') {
    const { runInit } = await import('./commands/init.mjs');
    const { created, sensors } = runInit(cwd);
    console.log(created ? `Created .sensors/sensors.yaml (sensors: ${sensors.join(', ') || 'none detected'})` : '.sensors/sensors.yaml already exists — not overwriting');
    return;
  }
```

- [ ] **Step 4: Run to verify pass, commit**

```bash
git add src/detect.mjs src/commands/init.mjs src/cli.mjs tests/detect.test.mjs
git commit -m "feat: stack detection and sensors init command"
```

---

### Task 15: `sensors check` + `sensors trigger`

**Files:**
- Create: `src/commands/check.mjs`, `tests/check.test.mjs`
- Modify: `src/cli.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: `runCheck(cwd, { all, level, changed, agent, json })` → `{ results, regressions: string[], output: string }` (`--strict` exit code is handled by the CLI layer, not runCheck). Selection: default = non-trigger sensors; `level: 'fast'` filters fast; `changed: file` = fast sensors with `{file}` substitution; `all` = all non-trigger. Pipeline per run: run → computeEvent vs previous state → appendHistory → updateState → format. `runTrigger(cwd, name)` runs one sensor by name regardless of interval. Exit codes (strict mode): 1 if any failure or regression.

- [ ] **Step 1: Write the failing test**

`tests/check.test.mjs` (fixture project using portable `node -e` sensors + `default` parser):

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCheck, runTrigger } from '../src/commands/check.mjs';
import { takeSnapshot } from '../src/snapshot.mjs';
import { readHistory } from '../src/state.mjs';

function project(yamlText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-check-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  fs.writeFileSync(path.join(dir, '.sensors/sensors.yaml'), yamlText);
  return dir;
}

const YAML_OK_FAIL = `
version: 1
sensors:
  - name: ok
    command: node -e "process.exit(0)"
    interval: 1000
    level: fast
  - name: broken
    command: node -e "console.log('oops'); process.exit(1)"
    interval: 1000
    level: full
  - name: manual
    command: node -e "process.exit(0)"
    interval: trigger
`;

describe('runCheck', () => {
  it('runs non-trigger sensors, writes state and history', async () => {
    const dir = project(YAML_OK_FAIL);
    const { results, output } = await runCheck(dir, { all: true, agent: true });
    expect(results.map((r) => r.sensor).sort()).toEqual(['broken', 'ok']); // manual (trigger) excluded
    expect(output).toContain('SENSORS STATUS');
    expect(output).toContain('broken: FAILURE');
    expect(readHistory(dir).length).toBe(2);
  });
  it('level fast selects only fast sensors', async () => {
    const dir = project(YAML_OK_FAIL);
    const { results } = await runCheck(dir, { level: 'fast' });
    expect(results.map((r) => r.sensor)).toEqual(['ok']);
  });
  it('detects regressions vs snapshot', async () => {
    const flakyYaml = [
      'version: 1',
      'sensors:',
      '  - name: flaky',
      `    command: node -e "process.exit(require('node:fs').existsSync('fail.flag') ? 1 : 0)"`,
      '    interval: 1000',
      '    level: full',
    ].join('\n');
    const dir = project(flakyYaml);
    await runCheck(dir, { all: true });
    takeSnapshot(dir);
    fs.writeFileSync(path.join(dir, 'fail.flag'), '1'); // now the sensor fails
    const { regressions } = await runCheck(dir, { all: true });
    expect(regressions).toEqual(['flaky']);
  });
});

describe('runTrigger', () => {
  it('runs a trigger sensor by name', async () => {
    const dir = project(YAML_OK_FAIL);
    const r = await runTrigger(dir, 'manual');
    expect(r.status).toBe('success');
  });
  it('throws for unknown sensor', async () => {
    const dir = project(YAML_OK_FAIL);
    await expect(runTrigger(dir, 'ghost')).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/check.test.mjs` → FAIL

- [ ] **Step 3: Implement src/commands/check.mjs**

```js
import { loadConfig } from '../config.mjs';
import { runSensors, runSensor } from '../runner.mjs';
import { readState, updateState, computeEvent, appendHistory } from '../state.mjs';
import { readSnapshot, isRegression } from '../snapshot.mjs';
import { formatAgent } from '../summary.mjs';

export async function runCheck(cwd, { all = false, level = null, changed = null, agent = false, json = false } = {}) {
  const config = loadConfig(cwd);
  let sensors = config.sensors.filter((s) => s.enabled && s.interval !== 'trigger');
  if (changed) sensors = sensors.filter((s) => s.level === 'fast');
  else if (level) sensors = sensors.filter((s) => s.level === level);
  // `all` (and the no-flag default) keeps every non-trigger sensor

  const prev = readState(cwd).results;
  const results = await runSensors(sensors, { cwd, file: changed });
  for (const r of results) {
    const cfg = sensors.find((s) => s.name === r.sensor);
    const event = computeEvent(prev[r.sensor] ?? null, r, { threshold: cfg.threshold, direction: cfg.direction });
    appendHistory(cwd, r, event);
  }
  updateState(cwd, results);

  const snapshot = readSnapshot(cwd);
  const regressions = results
    .filter((r) => {
      const cfg = sensors.find((s) => s.name === r.sensor);
      return isRegression(snapshot, r, cfg);
    })
    .map((r) => r.sensor);

  const output = json
    ? JSON.stringify({ results, regressions }, null, 2)
    : formatAgent(results, { config, snapshot });
  return { results, regressions, output };
}

export async function runTrigger(cwd, name) {
  const config = loadConfig(cwd);
  const sensorCfg = config.sensors.find((s) => s.name === name);
  if (!sensorCfg) throw new Error(`sensor "${name}" not found in sensors.yaml`);
  const prev = readState(cwd).results;
  const result = await runSensor(sensorCfg, { cwd });
  const event = computeEvent(prev[name] ?? null, result, { threshold: sensorCfg.threshold, direction: sensorCfg.direction });
  appendHistory(cwd, result, event);
  updateState(cwd, [result]);
  return result;
}
```

Wire in `src/cli.mjs` `main()`:

```js
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
```

- [ ] **Step 4: Run to verify pass, commit**

```bash
git add src/commands/check.mjs src/cli.mjs tests/check.test.mjs
git commit -m "feat: sensors check and trigger commands"
```

---

### Task 16: `sensors snapshot`, `status`, `history` commands

**Files:**
- Create: `src/commands/misc.mjs`, `tests/misc.test.mjs`
- Modify: `src/cli.mjs`

**Interfaces:**
- Consumes: state/snapshot/summary modules.
- Produces: `runSnapshot(cwd)` → `{takenAt}`; `runStatus(cwd, {line})` → string (agent format from stored state, or `formatLine` for `--line`); `runHistory(cwd, sensorName?)` → formatted lines `#N ts event status score (elapsed)`.

- [ ] **Step 1: Write the failing test**

`tests/misc.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runSnapshot, runStatus, runHistory } from '../src/commands/misc.mjs';
import { updateState, appendHistory } from '../src/state.mjs';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-misc-'));
  fs.mkdirSync(path.join(dir, '.sensors'));
  fs.writeFileSync(path.join(dir, '.sensors/sensors.yaml'), `
version: 1
sensors:
  - name: lint
    command: "true"
    interval: 1000
`);
  return dir;
}
const res = { sensor: 'lint', status: 'failure', score: 2, detail: '2 problems', findings: [], ranAt: new Date().toISOString(), durationMs: 5 };

describe('misc commands', () => {
  it('snapshot then status reads stored state', () => {
    const dir = project();
    updateState(dir, [res]);
    runSnapshot(dir);
    const out = runStatus(dir, {});
    expect(out).toContain('lint: FAILURE (2 problems)');
    expect(out).toContain('Same as snapshot');
  });
  it('status --line is one line', () => {
    const dir = project();
    updateState(dir, [res]);
    expect(runStatus(dir, { line: true })).toBe('●! lint:✗2');
  });
  it('status with no data', () => {
    expect(runStatus(project(), { line: true })).toBe('sensors: no data');
  });
  it('history lists events', () => {
    const dir = project();
    appendHistory(dir, res, 'initial');
    appendHistory(dir, { ...res, score: 0, status: 'success' }, 'recovery');
    const out = runHistory(dir, 'lint');
    expect(out.split('\n').length).toBe(2);
    expect(out).toContain('recovery');
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/misc.test.mjs` → FAIL

- [ ] **Step 3: Implement src/commands/misc.mjs**

```js
import { loadConfig } from '../config.mjs';
import { readState, readHistory } from '../state.mjs';
import { takeSnapshot, readSnapshot } from '../snapshot.mjs';
import { formatAgent, formatLine } from '../summary.mjs';

export function runSnapshot(cwd) {
  return takeSnapshot(cwd);
}

export function runStatus(cwd, { line = false } = {}) {
  const state = readState(cwd);
  const results = Object.values(state.results);
  if (line) return formatLine(results);
  if (results.length === 0) return 'sensors: no data (run `sensors check` first)';
  const config = loadConfig(cwd);
  return formatAgent(results, { config, snapshot: readSnapshot(cwd) });
}

export function runHistory(cwd, sensorName = null) {
  const entries = readHistory(cwd, sensorName);
  return entries
    .map((e, i) => `#${i + 1} ${e.ts} ${e.event} ${e.status} score=${e.score ?? '-'} (${e.elapsed}ms)`)
    .join('\n');
}
```

Wire in `src/cli.mjs` `main()`:

```js
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
```

- [ ] **Step 4: Run full suite, commit**

Run: `npm test` → all files PASS

```bash
git add src/commands/misc.mjs src/cli.mjs tests/misc.test.mjs
git commit -m "feat: snapshot, status and history commands"
```

---

### Task 17: End-to-end test through the real CLI binary

**Files:**
- Create: `tests/e2e.test.mjs`

**Interfaces:**
- Consumes: the whole CLI via `node src/cli.mjs` subprocess.

Note: the spec asks for E2E fixtures with real eslint/vitest/ruff/pytest installs. Installing those in-test is slow and flaky; this E2E exercises the full binary path (init → check → snapshot → regression → status) with portable `node -e` sensors, and the parser fixtures in Tasks 5–9 cover real tool output. Running against a real repo is a manual verification step at the end.

- [ ] **Step 1: Write the E2E test**

`tests/e2e.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

function sensors(args, cwd) {
  return execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}

describe('e2e', () => {
  it('init → check → snapshot → regression → status', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-e2e-'));

    // init on an empty repo, then replace config with a controllable sensor
    expect(sensors(['init'], dir)).toContain('Created');
    fs.writeFileSync(path.join(dir, '.sensors/sensors.yaml'), `
version: 1
sensors:
  - name: gate
    command: node -e "process.exit(require('node:fs').existsSync('fail.flag') ? 1 : 0)"
    interval: 1000
    level: full
    score: "Number of gate failures (lower is better)"
`);

    const out1 = sensors(['check', '--all', '--agent'], dir);
    expect(out1).toContain('gate: SUCCESS');

    sensors(['snapshot'], dir);
    fs.writeFileSync(path.join(dir, 'fail.flag'), '1');

    let failed = false;
    try {
      sensors(['check', '--all', '--agent', '--strict'], dir);
    } catch (e) {
      failed = true;
      expect(String(e.stdout)).toContain('gate: FAILURE');
    }
    expect(failed).toBe(true); // --strict exits 1 on regression

    expect(sensors(['status', '--line'], dir)).toContain('gate:✗');
    expect(sensors(['history', 'gate'], dir)).toContain('regression');
  });
});
```

- [ ] **Step 2: Run to verify pass**

Run: `npx vitest run tests/e2e.test.mjs` → PASS (implementation already exists; this test validates wiring end to end — if it fails, fix the wiring, not the test)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e.test.mjs
git commit -m "test: end-to-end CLI flow (init, check, snapshot, regression, status)"
```

---

### Task 18: README + pack sanity + manual verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
# claude-sensors

Maintainability sensors sidecar for coding agents — an implementation of
[Sensors for Coding Agents](https://martinfowler.com/articles/sensors-for-coding-agents.html)
as a CLI (this package) plus a Claude Code plugin (coming in the repo).

## Quickstart

```bash
npx claude-sensors init     # detects your stack, writes .sensors/sensors.yaml
npx claude-sensors check --all --agent
```

## Commands

| Command | Purpose |
|---|---|
| `sensors init` | detect stack, generate `.sensors/sensors.yaml` |
| `sensors check [--all\|--level fast\|--changed <file>] [--agent] [--json] [--strict]` | run sensors, print summary |
| `sensors snapshot` | save the current results as the comparison baseline |
| `sensors status [--line]` | last known results (no re-run) |
| `sensors history [sensor]` | trend events per run |
| `sensors trigger <name>` | run an on-demand (`interval: trigger`) sensor |

## Config (`.sensors/sensors.yaml`)

Any command can be a sensor. See the generated file for examples; fields:
`name`, `parser` (`eslint|tsc|vitest|coverage|ruff|pytest|default`), `command`
(`{file}` placeholder supported), `interval` (ms or `trigger`), `level`
(`fast|full`), `score`, `prompt`, `result_file`, `timeout`, `threshold`,
`direction` (`lower|higher`), `enabled`.
```

- [ ] **Step 2: Pack sanity**

Run: `npm pack --dry-run`
Expected: tarball lists `src/`, `package.json`, `README.md`; no `tests/`, no `.sensors/`. If tests are included, add `"files": ["src", "README.md"]` to package.json.

- [ ] **Step 3: Manual verification on a real repo**

Run in any real TS repo with eslint+vitest installed:

```bash
node /Users/gustavo/PersonalProject/claude-sensors/src/cli.mjs init
node /Users/gustavo/PersonalProject/claude-sensors/src/cli.mjs check --all --agent
```

Expected: generated config lists lint/typecheck/tests/coverage; check output shows real eslint/vitest results in the spec §7 format.

- [ ] **Step 4: Full suite + commit**

Run: `npm test` → PASS

```bash
git add README.md package.json
git commit -m "docs: README with quickstart and command reference"
```

---

## Follow-up plans (not in this document)

- **Plan 2 — daemon + TUI + remaining parsers:** `sensors start/stop` (PID lockfile, per-sensor interval loop, debounce), `sensors view` TUI, parsers for jest, mypy, mutmut, dependency-cruiser, stryker, semgrep, gitleaks, govet, gotest, clippy, cargotest.
- **Plan 3 — Claude Code plugin:** `.claude-plugin/plugin.json`, marketplace.json, SessionStart/PostToolUse/Stop hooks (using `check --json` + `--changed`), skills (`/sensors:init`, `/sensors:review`, `/sensors:mutation`, `/sensors:deps`, `/sensors:status`), statusline command.
