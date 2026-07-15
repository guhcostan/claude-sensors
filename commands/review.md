---
description: Inferential modularity/coupling review of recently changed files — the semantic sensor an LLM is needed for.
---

1. Run `git diff --name-only HEAD` (fall back to `git diff --name-only` if that's empty) to find recently changed files. If neither shows changes, ask the user which files/directory to review.
2. For each changed file, read it and its direct importers/importees (grep for its module path across the codebase) to see the surrounding coupling.
3. Using Vlad Khononov's modularity heuristics — cohesion (does this module have one clear responsibility?), coupling (how many other modules does it know too much about?), and misplaced responsibility (is logic living in the wrong layer?) — report concrete findings: file, what's wrong, and a specific suggested fix. Skip files with nothing notable; don't pad the report.
4. Keep this a read-only review — do not modify code unless the user asks you to act on a finding.
