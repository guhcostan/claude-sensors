// Shared helpers for claude-sensors hook scripts.
import fs from 'node:fs';

export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function hasConfig(cwd) {
  return fs.existsSync(`${cwd}/.sensors/sensors.yaml`);
}

export function emit(hookEventName, additionalContext, extra = {}) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName, additionalContext },
    ...extra,
  }));
}
