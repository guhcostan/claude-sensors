export default function eslintParser({ stdout = '', resultFileContent = null }) {
  let files;
  try {
    files = JSON.parse((resultFileContent ?? stdout).trim());
  } catch {
    return { status: 'error', detail: 'could not parse eslint JSON output' };
  }
  if (!Array.isArray(files)) {
    return { status: 'error', detail: 'could not parse eslint JSON output' };
  }
  const findings = files.flatMap((f) =>
    f.messages.map((m) => ({
      file: f.filePath,
      line: m.line ?? 0,
      message: `${m.ruleId ?? 'parse'}: ${m.message}`,
    })),
  );
  const score = findings.length;
  return {
    status: score === 0 ? 'success' : 'failure',
    score,
    detail: score === 0 ? 'No issues' : `${score} problem${score === 1 ? '' : 's'}`,
    findings,
  };
}
