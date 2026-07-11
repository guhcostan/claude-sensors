import { describe, it, expect } from 'vitest';
import { getParser } from '../src/parsers/index.mjs';

const parse = getParser('tsc');
const out = `src/a.ts(10,5): error TS2304: Cannot find name 'foo'.
src/b.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.
Found 2 errors in 2 files.`;

describe('tsc parser', () => {
  it('counts type errors with locations', () => {
    const r = parse({ stdout: out, stderr: '', exitCode: 2 });
    expect(r).toMatchObject({ status: 'failure', score: 2, detail: '2 type errors' });
    expect(r.findings[0]).toMatchObject({ file: 'src/a.ts', line: 10, message: "TS2304: Cannot find name 'foo'." });
  });
  it('success on clean run', () => {
    expect(parse({ stdout: '', stderr: '', exitCode: 0 })).toMatchObject({ status: 'success', score: 0, detail: 'No errors' });
  });
});
