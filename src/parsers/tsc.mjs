const LINE_RE = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/gm;

export default function tscParser({ stdout = '', exitCode }) {
  const findings = [...stdout.matchAll(LINE_RE)].map(([, file, line, code, msg]) => ({
    file,
    line: Number(line),
    message: `${code}: ${msg}`,
  }));
  if (findings.length === 0 && exitCode !== 0) {
    return { status: 'error', detail: `tsc exited ${exitCode} with no parseable errors` };
  }
  const score = findings.length;
  return {
    status: score === 0 ? 'success' : 'failure',
    score,
    detail: score === 0 ? 'No errors' : `${score} type error${score === 1 ? '' : 's'}`,
    findings,
  };
}
