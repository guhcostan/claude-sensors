export default function pytestParser({ stdout = '', exitCode }) {
  const failed = Number(stdout.match(/(\d+) failed/)?.[1] ?? 0);
  const passed = Number(stdout.match(/(\d+) passed/)?.[1] ?? 0);
  if (failed === 0 && passed === 0) {
    return { status: 'error', detail: `no pytest summary found (exit ${exitCode})` };
  }
  const findings = [...stdout.matchAll(/^FAILED (\S+?)(?:\s+-\s+(.*))?$/gm)]
    .map(([, id, reason]) => ({ file: id.split('::')[0], line: 0, message: `${id}${reason ? `: ${reason}` : ''}` }));
  return {
    status: failed === 0 ? 'success' : 'failure',
    score: failed,
    detail: failed === 0 ? `${passed} passed` : `${failed} failed, ${passed} passed`,
    findings,
  };
}
