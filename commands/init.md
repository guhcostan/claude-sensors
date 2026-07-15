---
description: Detect this project's stack and generate .sensors/sensors.yaml with maintainability sensors (lint, typecheck, tests, coverage).
---

Run this exact command and report its output to the user:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli.mjs" init
```

Then read the generated `.sensors/sensors.yaml` and summarize in one or two lines which sensors were detected (or, if none were detected, tell the user any command can be a sensor and point them at the commented example in the file).
