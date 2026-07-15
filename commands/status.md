---
description: Show the last known status of all configured sensors without re-running them.
---

Run this exact command and show its output to the user verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli.mjs" status
```

If it prints "no data", tell the user to run a normal edit or `/claude-sensors:init` first — sensors populate their status after `sensors check` runs (this happens automatically after edits and before you finish a turn).
