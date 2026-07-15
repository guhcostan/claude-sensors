---
description: Run the mutation-testing sensor on demand (if one is configured) and summarize surviving mutants per file.
---

1. Read `.sensors/sensors.yaml`. If no sensor has `interval: trigger` and a mutation-testing parser (e.g. `stryker`, `mutmut`), tell the user mutation testing isn't configured yet and stop — do not invent one.
2. Otherwise run: `node "${CLAUDE_PLUGIN_ROOT}/src/cli.mjs" trigger <that sensor's name>`
3. Summarize the result for the user: overall score (survivors), and call out the top few offending files from `findings` if present.
