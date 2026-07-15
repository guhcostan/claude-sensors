import { describe, it, expect } from 'vitest';
import { formatAgent, formatLine } from '../src/summary.mjs';

const config = {
  scoutingRule: true,
  sensors: [
    { name: 'lint', command: 'npm run lint', score: 'Number of lint issues (lower is better)', prompt: '' },
    { name: 'tests', command: 'npx vitest run', score: '', prompt: 'We expect the number of tests to go up.' },
  ],
};
const now = Date.parse('2026-07-10T14:00:10Z');
const results = [
  { sensor: 'lint', status: 'failure', score: 1, detail: '1 problem', findings: [{ file: './server/index.ts', line: 19, message: 'no-console: Unexpected console statement.', guidance: 'Use logger instead.' }], ranAt: '2026-07-10T14:00:02Z', durationMs: 800 },
  { sensor: 'tests', status: 'success', score: 0, detail: '326 passed', findings: [], ranAt: '2026-07-10T14:00:03Z', durationMs: 700 },
];
const snapshot = { takenAt: '2026-07-10T13:00:00Z', results: { lint: { ...results[0] }, tests: { ...results[1] } } };

describe('formatAgent', () => {
  const out = formatAgent(results, { config, snapshot, now });
  it('has header, scouting rule and per-sensor lines', () => {
    expect(out).toMatch(/^SENSORS STATUS/);
    expect(out).toContain('Follow scouting rule');
    expect(out).toContain('lint: FAILURE (1 problem) [ran 8s ago] | Same as snapshot');
    expect(out).toContain('cmd: `npm run lint`, score: Number of lint issues (lower is better)');
    expect(out).toContain('./server/index.ts:19 no-console: Unexpected console statement. — Use logger instead.');
    expect(out).toContain('prompt: We expect the number of tests to go up.');
  });
  it('omits scouting rule when disabled', () => {
    expect(formatAgent(results, { config: { ...config, scoutingRule: false }, snapshot, now })).not.toContain('scouting');
  });
});

describe('formatLine', () => {
  it('summarizes one char per sensor', () => {
    expect(formatLine(results)).toBe('●! lint:✗1 tests:✓0');
  });
  it('handles empty', () => {
    expect(formatLine([])).toBe('sensors: no data');
  });
});
