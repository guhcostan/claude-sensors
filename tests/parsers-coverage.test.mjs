import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getParser } from '../src/parsers/index.mjs';

const content = fs.readFileSync(new URL('./fixtures/coverage-final.json', import.meta.url), 'utf8');
const parse = getParser('coverage');

describe('coverage parser', () => {
  it('computes statement coverage percentage', () => {
    const r = parse({ stdout: '', stderr: '', exitCode: 0, resultFileContent: content });
    expect(r.status).toBe('success');
    expect(r.score).toBe(75); // 3 of 4 statements covered
    expect(r.detail).toBe('75% statements');
  });
  it('error when result file missing', () => {
    expect(parse({ stdout: '', stderr: '', exitCode: 0, resultFileContent: null }).status).toBe('error');
  });
});
