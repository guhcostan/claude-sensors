import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getParser } from '../src/parsers/index.mjs';

const stdout = fs.readFileSync(new URL('./fixtures/eslint.json', import.meta.url), 'utf8');
const parse = getParser('eslint');

describe('eslint parser', () => {
  it('counts problems and extracts findings', () => {
    const r = parse({ stdout, stderr: '', exitCode: 1 });
    expect(r.status).toBe('failure');
    expect(r.score).toBe(1);
    expect(r.detail).toBe('1 problem');
    expect(r.findings[0]).toMatchObject({ file: '/repo/server/index.ts', line: 19, message: 'no-console: Unexpected console statement.' });
  });
  it('success when clean', () => {
    const r = parse({ stdout: '[]', stderr: '', exitCode: 0 });
    expect(r).toMatchObject({ status: 'success', score: 0 });
  });
  it('error on unparseable output', () => {
    expect(parse({ stdout: 'not json', stderr: '', exitCode: 2 }).status).toBe('error');
  });
  it('error on valid JSON that is not an eslint report array', () => {
    expect(parse({ stdout: '{"messages":[]}', stderr: '', exitCode: 1 }).status).toBe('error');
  });
});
