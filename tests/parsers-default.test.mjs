import { describe, it, expect } from 'vitest';
import { getParser } from '../src/parsers/index.mjs';

const parse = getParser('default');

describe('default parser', () => {
  it('success on exit 0', () => {
    expect(parse({ stdout: '', stderr: '', exitCode: 0 })).toEqual({ status: 'success', score: 0, detail: 'OK' });
  });
  it('failure on nonzero exit, score = output lines', () => {
    const r = parse({ stdout: 'bad thing\nother bad', stderr: '', exitCode: 1 });
    expect(r.status).toBe('failure');
    expect(r.score).toBe(2);
    expect(r.detail).toBe('bad thing');
  });
  it('passes through schema-shaped JSON on stdout', () => {
    const json = JSON.stringify({ status: 'failure', score: 7, detail: 'custom' });
    expect(parse({ stdout: json, stderr: '', exitCode: 1 }).score).toBe(7);
  });
  it('prefers resultFileContent over stdout', () => {
    const json = JSON.stringify({ status: 'success', score: 0, detail: 'from file' });
    expect(parse({ stdout: 'noise', stderr: '', exitCode: 0, resultFileContent: json }).detail).toBe('from file');
  });
  it('unknown parser name throws', () => {
    expect(() => getParser('nope')).toThrow(/Unknown parser/);
  });
});
