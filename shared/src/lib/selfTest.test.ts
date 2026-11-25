import { describe, expect, it } from 'vitest';

import { formatTestRows, testExitCode, testVerdict, type TestRow } from './selfTest.js';

const row = (badge: TestRow['badge']): TestRow => ({ badge, name: 'x', detail: 'y' });

describe('the test verdict', () => {
  it('says everything looks good only when nothing failed or warned', () => {
    expect(testVerdict([row('ok'), row('off')])).toBe('Everything looks good.');
    expect(testVerdict([])).toBe('Everything looks good.');
  });

  it('counts warnings without calling them problems', () => {
    expect(testVerdict([row('ok'), row('warn')])).toBe('Working, with 1 thing to look at.');
    expect(testVerdict([row('warn'), row('warn')])).toBe('Working, with 2 things to look at.');
  });

  it('counts the problems first', () => {
    expect(testVerdict([row('fail'), row('warn')])).toBe('1 problem found, and 1 to look at.');
    expect(testVerdict([row('fail'), row('fail')])).toBe('2 problems found.');
  });
});

describe('the test exit code', () => {
  it('is 1 for a failure and 0 for a warning', () => {
    expect(testExitCode([row('ok'), row('warn')])).toBe(0);
    expect(testExitCode([row('ok'), row('fail')])).toBe(1);
  });
});

describe('formatTestRows', () => {
  const rows: TestRow[] = [
    { badge: 'ok', name: 'Whisper (local)', detail: 'answered in 1.2 s' },
    { badge: 'warn', name: 'HTTPS', detail: '2 of 3 places' },
    { badge: 'fail', name: 'LiveKit keys', detail: 'refused' },
    { badge: 'off', name: 'Voice UDP', detail: 'cannot be proved' },
  ];

  it('puts a marker, the name and the finding on each line, with the findings lined up', () => {
    const lines = formatTestRows(rows);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^ok\s+Whisper \(local\)\s+answered in 1\.2 s$/);
    expect(lines[1]).toMatch(/^WARN\s+HTTPS\s+2 of 3 places$/);
    expect(lines[2]).toMatch(/^FAIL\s+LiveKit keys\s+refused$/);
    expect(lines[3]).toMatch(/^--\s+Voice UDP\s+cannot be proved$/);
    const col = (l: string, text: string) => l.indexOf(text);
    expect(col(lines[0]!, 'answered')).toBe(col(lines[2]!, 'refused'));
  });

  it('uses the painter it is given for the marker, so the CLI can colour it', () => {
    const lines = formatTestRows(rows, (b) => `[${b}]`);
    expect(lines[0]).toMatch(/^\[ok\] /);
    expect(lines[2]).toMatch(/^\[fail\] /);
  });
});
