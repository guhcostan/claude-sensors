export default function vitestParser({ stdout = '', resultFileContent = null }) {
  let j;
  try {
    // vitest may print non-JSON noise before the report; find first '{'
    const body = (resultFileContent ?? stdout);
    j = JSON.parse(body.slice(body.indexOf('{')));
  } catch {
    return { status: 'error', detail: 'could not parse vitest JSON output' };
  }
  const failed = j.numFailedTests ?? 0;
  const passed = j.numPassedTests ?? 0;
  const findings = (j.testResults ?? [])
    .flatMap((tr) => (tr.assertionResults ?? [])
      .filter((a) => a.status === 'failed')
      .map((a) => ({ file: tr.name ?? '', line: 0, message: `${a.title}: ${(a.failureMessages ?? [])[0] ?? 'failed'}` })));
  return {
    status: failed === 0 ? 'success' : 'failure',
    score: failed,
    detail: failed === 0 ? `${passed} passed` : `${failed} failed, ${passed} passed`,
    findings,
  };
}
