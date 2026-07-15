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
