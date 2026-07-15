import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli.mjs';

describe('parseArgs', () => {
  it('splits command, flags and positionals', () => {
    const { cmd, flags, positional } = parseArgs(['check', '--level', 'fast', '--agent', 'extra']);
    expect(cmd).toBe('check');
    expect(flags.get('level')).toBe('fast');
    expect(flags.get('agent')).toBe(true);
    expect(positional).toEqual(['extra']);
  });
  it('handles empty argv', () => {
    expect(parseArgs([]).cmd).toBe(null);
  });
  it('treats leading flag as flag, not command', () => {
    const { cmd, flags } = parseArgs(['--version']);
    expect(cmd).toBe(null);
    expect(flags.get('version')).toBe(true);
  });
  it('treats leading --help as flag, not command', () => {
    const { cmd, flags } = parseArgs(['--help']);
    expect(cmd).toBe(null);
    expect(flags.get('help')).toBe(true);
  });
});
