# claude-sensors

Maintainability sensors for coding agents — an implementation of
[Sensors for Coding Agents](https://martinfowler.com/articles/sensors-for-coding-agents.html)
(Birgitta Böckeler, martinfowler.com) as a **Claude Code plugin** with a
standalone **CLI** underneath.

Sensors (lint, typecheck, tests, coverage, ...) run automatically after every
edit and before the agent finishes its turn. Findings are fed back into the
agent's context as guidance for self-correction. If the full check regresses
against a saved baseline, the Stop hook blocks the turn and asks the agent to
fix it — with a built-in anti-loop guard so it never blocks forever.

## Install as a Claude Code plugin

```
/plugin marketplace add guhcostan/claude-sensors
/plugin install claude-sensors
```

Then in any project:

```
/claude-sensors:init
```

This detects your stack (TS/JS, Python — more coming) and writes
`.sensors/sensors.yaml`. From then on:

- **After every `Edit`/`Write`**: fast sensors (lint, typecheck) run on the
  touched file. Clean → silence. Dirty → the agent sees findings + guidance
  inline, no extra command needed.
- **Before the agent ends its turn**: the full sensor set runs (tests,
  coverage, ...). If something regressed since the last snapshot, the turn
  is blocked (up to 2 attempts) until it's fixed.

Other commands: `/claude-sensors:status`, `/claude-sensors:mutation`,
`/claude-sensors:deps`, `/claude-sensors:review`.

## Use the CLI standalone (no Claude Code)

```bash
npx claude-sensors init
npx claude-sensors check --all --agent
```

### Commands

| Command | Purpose |
|---|---|
| `sensors init` | detect stack, generate `.sensors/sensors.yaml` |
| `sensors check [--all\|--level fast\|--changed <file>] [--agent] [--json] [--strict]` | run sensors, print summary |
| `sensors snapshot` | save the current results as the comparison baseline |
| `sensors status [--line]` | last known results (no re-run) |
| `sensors history [sensor]` | trend events per run |
| `sensors trigger <name>` | run an on-demand (`interval: trigger`) sensor |

### Config (`.sensors/sensors.yaml`)

Any command can be a sensor. See the generated file for examples; fields:
`name`, `parser` (`eslint|tsc|vitest|coverage|ruff|pytest|default`), `command`
(`{file}` placeholder supported), `interval` (ms or `trigger`), `level`
(`fast|full`), `score`, `prompt`, `result_file`, `timeout`, `threshold`,
`direction` (`lower|higher`), `enabled`.

## How it works

- Sensors run as plain shell commands; a parser normalizes each tool's
  output into `{status, score, detail, findings}`.
- Results and trend history live in `.sensors/` (gitignored); the config
  itself is committed.
- Every result is **fail-open**: a sensor that times out or crashes is
  reported as `error` and never blocks anything.
- No network calls, no telemetry — everything runs locally against your
  existing tools.

## Status

CLI engine (detection, parsers, runner, snapshots, hooks wiring) is done and
tested (92 tests). A watch-mode daemon, a human TUI (`sensors view`), and
more parsers (jest, mypy, mutmut, dependency-cruiser, stryker, semgrep,
gitleaks, Go, Rust) are natural next steps — contributions welcome.
