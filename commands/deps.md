---
description: Report dependency age/activity and flag upgrade candidates for this project.
---

1. Detect the package manager from the project root (`package.json` → npm/pnpm/yarn, `pyproject.toml` → pip/poetry, `go.mod` → go modules, `Cargo.toml` → cargo).
2. Run the matching read-only "outdated" command for that ecosystem (e.g. `npm outdated --json`, `pip list --outdated`, `go list -u -m all`, `cargo outdated`). Use whichever is available; if none apply, say so.
3. Summarize: which dependencies are outdated, how far behind (major/minor/patch), and which ones look worth prioritizing (major version behind, or a security-relevant package). Do not run any install/upgrade command — this is a report only.
