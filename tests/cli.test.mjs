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
});
