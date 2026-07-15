export default function defaultParser({ stdout = '', stderr = '', exitCode, resultFileContent = null }) {
  const body = (resultFileContent ?? stdout).trim();
  if (body.startsWith('{')) {
    try {
      const j = JSON.parse(body);
      if (typeof j.status === 'string') {
        return { status: j.status, score: j.score ?? null, detail: j.detail ?? '', findings: j.findings ?? [] };
      }
    } catch { /* fall through to generic handling */ }
  }
  if (exitCode === 0) return { status: 'success', score: 0, detail: 'OK' };
  const lines = `${stdout}\n${stderr}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return { status: 'failure', score: lines.length, detail: lines[0]?.slice(0, 200) ?? `exit ${exitCode}` };
}
