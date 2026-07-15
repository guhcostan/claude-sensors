export default function coverageParser({ resultFileContent = null }) {
  if (!resultFileContent) return { status: 'error', detail: 'coverage result file not found (set result_file)' };
  let files;
  try {
    files = JSON.parse(resultFileContent);
  } catch {
    return { status: 'error', detail: 'could not parse coverage-final.json' };
  }
  if (!files || typeof files !== 'object') return { status: 'error', detail: 'could not parse coverage-final.json' };
  let total = 0;
  let covered = 0;
  for (const f of Object.values(files)) {
    if (!f || typeof f !== 'object') continue;
    for (const hits of Object.values(f.s ?? {})) {
      total += 1;
      if (hits > 0) covered += 1;
    }
  }
  const pct = total === 0 ? 0 : Math.round((covered / total) * 10000) / 100;
  return { status: 'success', score: pct, detail: `${pct}% statements` };
}
