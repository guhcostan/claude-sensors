import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getParser } from '../src/parsers/index.mjs';

const stdout = fs.readFileSync(new URL('./fixtures/vitest.json', import.meta.url), 'utf8');
const parse = getParser('vitest');

describe('vitest parser', () => {
  it('reports failed count as score with findings', () => {
    const r = parse({ stdout, stderr: '', exitCode: 1 });
    expect(r).toMatchObject({ status: 'failure', score: 1, detail: '1 failed, 3 passed' });
    expect(r.findings[0]).toMatchObject({ file: '/repo/tests/math.test.ts', message: 'divides: expected 2 to be 3' });
  });
  it('success when all pass', () => {
    const clean = JSON.stringify({ numTotalTests: 5, numPassedTests: 5, numFailedTests: 0, success: true, testResults: [] });
    expect(parse({ stdout: clean, stderr: '', exitCode: 0 })).toMatchObject({ status: 'success', score: 0, detail: '5 passed' });
  });
});
