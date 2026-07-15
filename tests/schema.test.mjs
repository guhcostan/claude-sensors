import { describe, it, expect } from 'vitest';
import { makeResult } from '../src/schema.mjs';

describe('makeResult', () => {
  it('fills all fields with defaults', () => {
    const r = makeResult('lint', { status: 'failure', score: 2, detail: '2 warnings' });
    expect(r.sensor).toBe('lint');
    expect(r.status).toBe('failure');
    expect(r.score).toBe(2);
    expect(r.findings).toEqual([]);
    expect(typeof r.ranAt).toBe('string');
    expect(r.durationMs).toBe(0);
  });
  it('coerces bad status to error and bad score to null', () => {
    const r = makeResult('x', { status: 'weird', score: NaN });
    expect(r.status).toBe('error');
    expect(r.score).toBe(null);
  });
  it('normalizes findings', () => {
    const r = makeResult('lint', { status: 'failure', findings: [{ file: 'a.ts', message: 'no-console' }] });
    expect(r.findings[0]).toEqual({ file: 'a.ts', line: 0, message: 'no-console', guidance: '' });
  });
});
