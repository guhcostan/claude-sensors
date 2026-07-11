import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getParser } from '../src/parsers/index.mjs';

const ruffOut = fs.readFileSync(new URL('./fixtures/ruff.json', import.meta.url), 'utf8');

describe('ruff parser', () => {
  const parse = getParser('ruff');
  it('extracts violations', () => {
    const r = parse({ stdout: ruffOut, stderr: '', exitCode: 1 });
    expect(r).toMatchObject({ status: 'failure', score: 1 });
    expect(r.findings[0]).toMatchObject({ file: 'app/main.py', line: 3, message: 'F401: `os` imported but unused' });
  });
  it('clean run', () => {
    expect(parse({ stdout: '[]', stderr: '', exitCode: 0 })).toMatchObject({ status: 'success', score: 0 });
  });
  it('error on valid JSON that is not an array', () => {
    expect(parse({ stdout: '{}', stderr: '', exitCode: 1 }).status).toBe('error');
  });
});

describe('pytest parser', () => {
  const parse = getParser('pytest');
  it('parses failed summary', () => {
    const out = 'FAILED tests/test_x.py::test_a - AssertionError\n========= 1 failed, 3 passed in 0.12s =========';
    expect(parse({ stdout: out, stderr: '', exitCode: 1 })).toMatchObject({ status: 'failure', score: 1, detail: '1 failed, 3 passed' });
  });
  it('parses all-passed summary', () => {
    const out = '========= 4 passed in 0.10s =========';
    expect(parse({ stdout: out, stderr: '', exitCode: 0 })).toMatchObject({ status: 'success', score: 0, detail: '4 passed' });
  });
  it('error when summary is missing', () => {
    expect(parse({ stdout: 'garbage', stderr: '', exitCode: 3 }).status).toBe('error');
  });
});
