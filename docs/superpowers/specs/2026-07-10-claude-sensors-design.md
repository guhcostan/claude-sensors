# claude-sensors — Design Spec

**Data:** 2026-07-10
**Status:** Aprovado para planejamento
**Referência:** [Sensors for Coding Agents (martinfowler.com, Birgitta Böckeler)](https://martinfowler.com/articles/sensors-for-coding-agents.html)

## 1. Visão

Produto final, distribuível: plugin de Claude Code + CLI `sensors` (o "sidecar" do artigo). Sensores de manutenibilidade dão feedback contínuo ao agente durante a sessão de código, permitindo autocorreção antes do review humano. O CLI é o motor genérico (config-first, serve qualquer harness); o plugin liga o motor ao loop do Claude Code via hooks, skills e statusline.

**Princípios:**
- Config-first: qualquer comando vira sensor. Detecção automática apenas gera a config inicial.
- Fail-open: sensor quebrado/timeout nunca trava o turno do usuário.
- Degradação graciosa: funciona 100% sem daemon; daemon é upgrade de latência.
- Local-only: zero rede, zero telemetria.

## 2. Arquitetura

```
┌─ Claude Code (plugin) ─────────────────────────────────┐
│ SessionStart ─→ detect + oferta de iniciar daemon      │
│ PostToolUse  ─→ sensors check --changed <file>         │
│ Stop         ─→ sensors check --all  (bloqueia se      │
│                 regressão vs snapshot)                 │
│ /sensors:*   ─→ skills (init, review, mutation, deps)  │
│ statusline   ─→ sensors status --line                  │
└────────────────────────────────────────────────────────┘
                        │
                  CLI `sensors` (Node.js ≥ 20, sem deps pesadas)
                        │
      ┌─────────────────┼──────────────────────┐
   detect            runner                 daemon (opcional)
   (gera config)     (orquestra + parsers)  (watch, intervalo por sensor)
                        │
   .sensors/  config: sensors.yaml (versionado)
              estado: state.json, history.jsonl, snapshot.json (gitignored)
```

**Degradação graciosa:** hook pede resultado → daemon ativo e resultado fresco (< staleness do sensor) → lê `state.json` (instantâneo); senão roda sync com timeout. Sem race fatal: state escrito atomicamente (write-to-temp + rename).

## 3. Config — `sensors.yaml`

Fonte da verdade, versionada no repo do usuário. Formato fiel ao artigo:

```yaml
version: 1
scouting_rule: true          # injeta a scouting rule no resumo do agente
daemon:
  enabled: false             # default: sem daemon; hooks rodam sync
sensors:
  - name: tests
    parser: vitest           # parser específico
    command: npx vitest --run --reporter=json
    interval: 10000          # ms, usado pelo daemon
    score: "Number of failing tests (lower is better)"
    prompt: "We expect the number of tests to go up if we added functionality."
    level: full              # fast = PostToolUse, full = Stop
  - name: lint
    parser: eslint
    command: npm run lint -- --format json
    interval: 14000
    level: fast
  - name: layers
    parser: default          # qualquer comando: exit code + stdout JSON simples
    command: npm run lint:deps
    interval: 20000
    level: full
  - name: mutation
    parser: stryker
    command: npx stryker run
    interval: trigger        # só roda sob demanda (/sensors:mutation)
    result_file: reports/mutation/mutation.json
```

Campos por sensor: `name`, `parser`, `command`, `interval` (ms | `trigger`), `level` (`fast` | `full`), `score` (descrição textual), `prompt` (guidance opcional pro agente), `result_file` (quando a ferramenta escreve em arquivo em vez de stdout), `timeout` (default 30s fast / 120s full), `enabled`, `threshold` (opcional; ex: `cov` com `threshold: 80` marca `below_threshold` e conta como regressão no Stop apenas se cair abaixo dele ou piorar estando abaixo).

**Parser `default`:** aceita (a) exit code + contagem de linhas de stderr/stdout como score, ou (b) JSON no formato do schema (seção 5) se o comando já emitir. Cobre qualquer ferramenta sem parser dedicado.

## 4. Detecção de stack (`sensors init`)

Sniffa manifestos e **gera** `sensors.yaml` com os sensores cujas ferramentas existem no repo (presente em devDependencies/config file). Nunca roda mágica escondida depois — a config gerada é o contrato.

| Stack | fast (PostToolUse) | full (Stop) | trigger |
|---|---|---|---|
| TS/JS (`package.json`) | eslint (arquivo), tsc `--noEmit` incremental | vitest/jest + coverage, dependency-cruiser, knip | stryker |
| Python (`pyproject.toml`) | ruff (arquivo), mypy | pytest + coverage | mutmut |
| Go (`go.mod`) | go vet / golangci-lint (pacote) | go test -cover | — |
| Rust (`Cargo.toml`) | clippy | cargo test | — |
| Qualquer | semgrep (se instalado), gitleaks (se instalado) | idem | — |

Segurança (semgrep, gitleaks) entra na sessão como no artigo, se as ferramentas estiverem disponíveis.

## 5. Schema de resultado (contrato dos parsers)

Todo parser normaliza para:

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

`error` = sensor não conseguiu rodar (ferramenta ausente, timeout) — reportado, nunca bloqueia (fail-open).

Parsers dedicados v1: `eslint`, `tsc`, `vitest`, `jest`, `coverage` (coverage-final.json / coverage.xml), `dependency-cruiser`, `stryker`, `ruff`, `mypy`, `pytest`, `mutmut`, `govet`, `gotest`, `clippy`, `cargotest`, `semgrep`, `gitleaks`, `default`.

## 6. Histórico, tendência e snapshot

- **`history.jsonl`**: uma linha por execução `{sensor, ts, status, score, event, elapsed}`.
- **Eventos** (calculados vs execução anterior): `initial`, `steady`, `regression` (success→failure), `worsening` (score piora), `improvement` (score melhora), `recovery` (failure→success), `below_threshold` quando aplicável.
- **`snapshot.json`**: tirado explicitamente (`sensors snapshot`, tecla S na TUI, ou automático no SessionStart se não existir). Resumo do agente compara: `Same as snapshot` / deltas.

## 7. Comandos do CLI

| Comando | Função |
|---|---|
| `sensors init` | detecta stack, gera `sensors.yaml`, cria `.sensors/` + gitignore |
| `sensors check [--all\|--level fast\|--changed <file>] [--agent]` | roda sensores, imprime resumo; `--agent` = formato compacto do artigo |
| `sensors start` / `sensors stop` | daemon watch (intervalo por sensor, debounce em mudança de arquivo); PID lockfile, auto-kill de órfão |
| `sensors view` | TUI humana: tabela sensor/when/status/trend/last-run/details; teclas 1-9 re-run, S snapshot, C clear, Q quit |
| `sensors status [--line]` | último estado; `--line` = 1 linha pra statusline |
| `sensors snapshot` | grava snapshot de referência |
| `sensors trigger <name>` | roda sensor `trigger` (ex: mutation) |
| `sensors history [sensor]` | eventos/tendência |

**Formato `--agent`** (fiel à figura do artigo):

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

## 8. Integração com Claude Code (plugin)

**Hooks:**
- **SessionStart**: se `.sensors/` ausente, injeta sugestão de rodar `/sensors:init`. Se presente: mata daemon órfão, tira snapshot inicial se não houver, injeta contexto "sensores ativos: lint, tests, tsc...". Se `daemon.enabled`, inicia daemon.
- **PostToolUse** (matcher Edit|Write): `sensors check --changed <file> --agent` (nível fast, timeout 10s). Findings → devolvidos como additionalContext do hook. Limpo → silêncio (zero ruído).
- **Stop**: `sensors check --all --agent`. Regressão vs snapshot (teste quebrou, score piorou além de threshold) → hook retorna `decision: block` com o resumo, forçando o agente a corrigir antes de encerrar. Sem regressão → resumo informativo apenas. Guarda anti-loop: máx. 2 blocks consecutivos por turno, depois deixa passar com aviso.

**Skills / commands:**
- `/sensors:init` — onboarding guiado (roda `sensors init`, mostra o que detectou, pergunta ajustes).
- `/sensors:review` — sensor inferencial: subagente lê métricas de acoplamento (fan-in/out por imports, gerado pelo CLI em JSON) + código e faz review de modularidade. Sob demanda por default; configurável para rodar no Stop (`inferential: on_stop` no yaml).
- `/sensors:mutation` — `sensors trigger mutation` + consulta hotspots (survivors por arquivo, estilo query_stryker).
- `/sensors:deps` — idade/atividade das dependências + recomendações de upgrade.
- `/sensors:status` — estado atual formatado.

**Statusline (opcional):** `sensors status --line` → `● 326✓ 78%cov 1lint`.

## 9. Erros e edge cases

- Sensor timeout/crash → `status: error`, aviso no resumo, nunca bloqueia (fail-open).
- Ferramenta desinstalada após init → `error` com guidance "rode /sensors:init novamente".
- Daemon morto/órfão → SessionStart limpa via PID lockfile; hooks caem no modo sync.
- Repo sem manifesto reconhecido → `sensors init` gera config vazia com exemplo comentado do parser `default`.
- Monorepo → v1: config na raiz; `--changed` resolve o pacote do arquivo tocado quando possível. Suporte pleno = v2.
- Concorrência: hooks e daemon escrevem `state.json` com write-temp+rename; daemon é o único escritor quando ativo.

## 10. Testes

- **Parsers**: unit com fixtures de outputs reais (eslint JSON, vitest JSON, coverage-final.json, stryker mutation.json, ruff, pytest, semgrep...). É onde tudo quebra.
- **Runner/eventos**: unit para cálculo de trend/eventos e comparação com snapshot.
- **E2E**: dois repos fixture (TS com vitest+eslint; Python com ruff+pytest) — roda `sensors init` + `sensors check` de verdade e valida o resumo.
- **Hooks**: teste de contrato do JSON de saída dos hooks (additionalContext, decision block).

## 11. Distribuição

- Repo GitHub com `.claude-plugin/plugin.json` + `marketplace.json` → instala via `/plugin marketplace add`.
- CLI publicado no npm (`npx claude-sensors`) para uso standalone/CI — mesmos sensores rodam no pipeline (paridade sessão/CI, como no artigo).
- README com quickstart, GIF da TUI e tabela de sensores suportados.

## 12. Fora de escopo (v2+)

- Dashboard web de acoplamento (grafo, matriz DSM, scatter fan-in/fan-out) — v1 cobre o caso do agente via `/sensors:review` textual.
- Runtime feedback de produção (outscoped no próprio artigo).
- Monorepo pleno (configs por pacote).
- Data handling review automático.
