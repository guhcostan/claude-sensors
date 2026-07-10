# claude-sensors — Design Spec

**Date:** 2026-07-10
**Status:** Approved for planning
**Reference:** [Sensors for Coding Agents (martinfowler.com, Birgitta Böckeler)](https://martinfowler.com/articles/sensors-for-coding-agents.html)

## 1. Vision

Final, distributable product: a Claude Code plugin + `sensors` CLI (the article's "sidecar"). Maintainability sensors give the agent continuous feedback during the coding session, enabling self-correction before human review. The CLI is the generic engine (config-first, serves any harness); the plugin wires the engine into the Claude Code loop via hooks, skills, and statusline.

**Principles:**
- Config-first: any command can become a sensor. Auto-detection only generates the initial config.
- Fail-open: a broken/timed-out sensor never blocks the user's turn.
- Graceful degradation: works 100% without the daemon; the daemon is a latency upgrade.
- Local-only: no network, no telemetry.

## 2. Architecture

```
┌─ Claude Code (plugin) ─────────────────────────────────┐
│ SessionStart ─→ detect + offer to start daemon         │
│ PostToolUse  ─→ sensors check --changed <file>         │
│ Stop         ─→ sensors check --all  (blocks on        │
│                 regression vs snapshot)                │
│ /sensors:*   ─→ skills (init, review, mutation, deps)  │
│ statusline   ─→ sensors status --line                  │
└────────────────────────────────────────────────────────┘
                        │
                  `sensors` CLI (Node.js ≥ 20, no heavy deps)
                        │
      ┌─────────────────┼──────────────────────┐
   detect            runner                 daemon (optional)
   (generates        (orchestrates +        (watch, per-sensor
    config)           parsers)               interval)
                        │
   .sensors/  config: sensors.yaml (committed)
              state:  state.json, history.jsonl, snapshot.json (gitignored)
```

**Graceful degradation:** hook requests a result → daemon running and result fresh (< sensor staleness) → read `state.json` (instant); otherwise run sync with timeout. No fatal race: state written atomically (write-to-temp + rename).

## 3. Config — `sensors.yaml`

Source of truth, committed to the user's repo. Format faithful to the article:

```yaml
version: 1
scouting_rule: true          # injects the scouting rule into the agent summary
daemon:
  enabled: false             # default: no daemon; hooks run sync
sensors:
  - name: tests
    parser: vitest           # dedicated parser
    command: npx vitest --run --reporter=json
    interval: 10000          # ms, used by the daemon
    score: "Number of failing tests (lower is better)"
    prompt: "We expect the number of tests to go up if we added functionality."
    level: full              # fast = PostToolUse, full = Stop
  - name: lint
    parser: eslint
    command: npm run lint -- --format json
    interval: 14000
    level: fast
  - name: layers
    parser: default          # any command: exit code + simple JSON on stdout
    command: npm run lint:deps
    interval: 20000
    level: full
  - name: mutation
    parser: stryker
    command: npx stryker run
    interval: trigger        # only runs on demand (/sensors:mutation)
    result_file: reports/mutation/mutation.json
```

Per-sensor fields: `name`, `parser`, `command`, `interval` (ms | `trigger`), `level` (`fast` | `full`), `score` (textual description), `prompt` (optional guidance for the agent), `result_file` (when the tool writes to a file instead of stdout), `timeout` (default 30s fast / 120s full), `enabled`, `threshold` (optional; e.g. `cov` with `threshold: 80` marks `below_threshold` and only counts as a regression on Stop if it drops below the threshold or worsens while below it).

**`default` parser:** accepts (a) exit code + stderr/stdout line count as score, or (b) JSON already in the schema format (section 5) if the command emits it. Covers any tool without a dedicated parser.

## 4. Stack detection (`sensors init`)

Sniffs manifests and **generates** `sensors.yaml` with sensors whose tools exist in the repo (present in devDependencies/config files). Never runs hidden magic afterwards — the generated config is the contract.

| Stack | fast (PostToolUse) | full (Stop) | trigger |
|---|---|---|---|
| TS/JS (`package.json`) | eslint (file), tsc `--noEmit` incremental | vitest/jest + coverage, dependency-cruiser, knip | stryker |
| Python (`pyproject.toml`) | ruff (file), mypy | pytest + coverage | mutmut |
| Go (`go.mod`) | go vet / golangci-lint (package) | go test -cover | — |
| Rust (`Cargo.toml`) | clippy | cargo test | — |
| Any | semgrep (if installed), gitleaks (if installed) | same | — |

Security (semgrep, gitleaks) joins the session as in the article, when the tools are available.

## 5. Result schema (parser contract)

Every parser normalizes to:

```json
{
  "sensor": "lint",
  "status": "success | failure | error",
  "score": 1,
  "detail": "1 warning",
  "findings": [
    { "file": "server/index.ts", "line": 19, "message": "no-console: Use `logger` from server/logger.ts", "guidance": "..." }
  ],
  "ranAt": "2026-07-10T14:00:00Z",
  "durationMs": 8000
}
```

`error` = sensor could not run (missing tool, timeout) — reported, never blocks (fail-open).

Dedicated parsers v1: `eslint`, `tsc`, `vitest`, `jest`, `coverage` (coverage-final.json / coverage.xml), `dependency-cruiser`, `stryker`, `ruff`, `mypy`, `pytest`, `mutmut`, `govet`, `gotest`, `clippy`, `cargotest`, `semgrep`, `gitleaks`, `default`.

## 6. History, trend, and snapshot

- **`history.jsonl`**: one line per run `{sensor, ts, status, score, event, elapsed}`.
- **Events** (computed vs previous run): `initial`, `steady`, `regression` (success→failure), `worsening` (score worsens), `improvement` (score improves), `recovery` (failure→success), `below_threshold` when applicable.
- **`snapshot.json`**: taken explicitly (`sensors snapshot`, S key in the TUI, or automatically at SessionStart if none exists). The agent summary compares against it: `Same as snapshot` / deltas.

## 7. CLI commands

| Command | Purpose |
|---|---|
| `sensors init` | detects stack, generates `sensors.yaml`, creates `.sensors/` + gitignore |
| `sensors check [--all\|--level fast\|--changed <file>] [--agent]` | runs sensors, prints summary; `--agent` = compact format from the article |
| `sensors start` / `sensors stop` | watch daemon (per-sensor interval, debounce on file change); PID lockfile, orphan auto-kill |
| `sensors view` | human TUI: sensor/when/status/trend/last-run/details table; keys 1-9 re-run, S snapshot, C clear, Q quit |
| `sensors status [--line]` | latest state; `--line` = single line for the statusline |
| `sensors snapshot` | writes the reference snapshot |
| `sensors trigger <name>` | runs a `trigger` sensor (e.g. mutation) |
| `sensors history [sensor]` | events/trend |

**`--agent` format** (faithful to the article's figure):

```
SENSORS STATUS  Updated: 2026-07-10T14:00:03 (0s ago)

Follow scouting rule: if sensors are reporting issues you didn't cause
with a change, consider to leave the code better than you found it, if
it's a small change.

lint: FAILURE (1 warning) [ran 8s ago] | Same as snapshot
  cmd: `npm run lint`, score: Number of lint issues (lower is better)
  ./server/index.ts:19:3 WARN no-console Use `logger` from `server/logger.ts`
tests: SUCCESS (326 passed) [ran 7s ago] | Same as snapshot
  prompt: We expect the number of tests to go up if we added functionality.
```

## 8. Claude Code integration (plugin)

**Hooks:**
- **SessionStart**: if `.sensors/` is missing, injects a suggestion to run `/sensors:init`. If present: kills orphan daemon, takes an initial snapshot if none exists, injects context "active sensors: lint, tests, tsc...". If `daemon.enabled`, starts the daemon.
- **PostToolUse** (matcher Edit|Write): `sensors check --changed <file> --agent` (fast level, 10s timeout). Findings → returned as the hook's additionalContext. Clean → silence (zero noise).
- **Stop**: `sensors check --all --agent`. Regression vs snapshot (test broke, score worsened beyond threshold) → hook returns `decision: block` with the summary, forcing the agent to fix before ending the turn. No regression → informational summary only. Anti-loop guard: max 2 consecutive blocks per turn, then lets it pass with a warning.

**Skills / commands:**
- `/sensors:init` — guided onboarding (runs `sensors init`, shows what it detected, asks for adjustments).
- `/sensors:review` — inferential sensor: subagent reads coupling metrics (fan-in/out from imports, generated by the CLI as JSON) + code and performs a modularity review. On-demand by default; configurable to run on Stop (`inferential: on_stop` in the yaml).
- `/sensors:mutation` — `sensors trigger mutation` + queries hotspots (survivors per file, query_stryker style).
- `/sensors:deps` — dependency age/activity + upgrade recommendations.
- `/sensors:status` — current state, formatted.

**Statusline (optional):** `sensors status --line` → `● 326✓ 78%cov 1lint`.

## 9. Errors and edge cases

- Sensor timeout/crash → `status: error`, warning in the summary, never blocks (fail-open).
- Tool uninstalled after init → `error` with guidance "run /sensors:init again".
- Dead/orphan daemon → SessionStart cleans up via PID lockfile; hooks fall back to sync mode.
- Repo without a recognized manifest → `sensors init` generates an empty config with a commented `default` parser example.
- Monorepo → v1: config at the root; `--changed` resolves the touched file's package when possible. Full support = v2.
- Concurrency: hooks and daemon write `state.json` via write-temp+rename; the daemon is the sole writer when active.

## 10. Testing

- **Parsers**: unit tests with fixtures of real outputs (eslint JSON, vitest JSON, coverage-final.json, stryker mutation.json, ruff, pytest, semgrep...). This is where everything breaks.
- **Runner/events**: unit tests for trend/event computation and snapshot comparison.
- **E2E**: two fixture repos (TS with vitest+eslint; Python with ruff+pytest) — actually run `sensors init` + `sensors check` and validate the summary.
- **Hooks**: contract tests for the hooks' JSON output (additionalContext, decision block).

## 11. Distribution

- GitHub repo with `.claude-plugin/plugin.json` + `marketplace.json` → install via `/plugin marketplace add`.
- CLI published to npm (`npx claude-sensors`) for standalone/CI use — the same sensors run in the pipeline (session/CI parity, as in the article).
- README with quickstart, TUI GIF, and supported-sensors table.

## 12. Out of scope (v2+)

- Coupling web dashboard (graph, DSM matrix, fan-in/fan-out scatter) — v1 covers the agent's case via textual `/sensors:review`.
- Production runtime feedback (outscoped in the article itself).
- Full monorepo support (per-package configs).
- Automated data handling review.
