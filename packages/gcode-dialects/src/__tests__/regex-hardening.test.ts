/**
 * Hostile-input hardening (#469 sweep): four per-line/per-head regexes were super-linear. Each fix is
 * checked against a verbatim copy of the old regex on realistic + hand-made inputs, and against a
 * crafted input the old regex takes seconds on.
 */
import { describe, expect, it } from 'vitest';
import { parseKeyValue } from '../annotate';
import { grblLaser, grblMill, hasPercentEnvelope, linuxCnc, stripParenComments } from '../cnc';
import { createDialectRunner } from '../registry';
import { parseHmsToSeconds } from '../prusaslicer';

const timed = <T>(fn: () => T): { out: T; ms: number } => {
  const t0 = performance.now();
  const out = fn();
  return { out, ms: performance.now() - t0 };
};

describe('parseHmsToSeconds (was cubic on whitespace)', () => {
  const OLD = /^\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?\s*$/;
  const oldHms = (text: string): number | null => {
    const m = OLD.exec(text);
    if (m === null) return null;
    const total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    return total > 0 ? total : null;
  };
  const cases: Array<[string, number | null]> = [
    ['1h 2m 3s', 3723],
    ['1h2m', 3720],
    ['  5m ', 300],
    ['45s', 45],
    ['45s  ', 45],
    ['', null],
    ['     ', null],
    // `1d 2h` left out: the old regex had no day field (a defect, fixed later; see mutation-sweep.test.ts).
    ['garbage', null],
    ['0h 0m 0s', null],
    ['1h 2m 3s extra', null],
    ['2m 3s', 123],
    ['3s 2m', null],
    ['1 h 2 m', 3720],
    ['\t5m\n', 300],
    ['12', null],
    ['h', null]
  ];

  it.each(cases)('%j → %j, same as the old regex', (text, seconds) => {
    expect(parseHmsToSeconds(text)).toBe(seconds);
    expect(parseHmsToSeconds(text)).toBe(oldHms(text));
  });

  it('300 spaces + junk returns promptly (old regex: seconds)', () => {
    const { out, ms } = timed(() => parseHmsToSeconds(' '.repeat(300) + 'x'));
    expect(out).toBeNull();
    expect(ms).toBeLessThan(100);
  });
});

describe('stripParenComments (was quadratic on unmatched `(`)', () => {
  const oldStrip = (s: string): string => s.replace(/\([^)]*\)/g, '');
  const cases = [
    '',
    'G1 X1 (comment) Y2',
    '(a)(b)',
    '((a)',
    '(a',
    'a)b',
    '(a(b)c)',
    'x(y)z(w',
    'M3 (spin) S1000 (',
    '((())',
    '()',
    'no parens'
  ];

  it.each(cases)('%j matches the old regex', (text) => {
    expect(stripParenComments(text)).toBe(oldStrip(text));
  });

  it('literal results', () => {
    expect(stripParenComments('G1 X1 (comment) Y2')).toBe('G1 X1  Y2');
    expect(stripParenComments('((a)')).toBe('');
    expect(stripParenComments('x(y)z(w')).toBe('xz(w');
  });

  it('a 64 KiB run of `(` returns promptly (old regex: ~4 s)', () => {
    const line = '('.repeat(65536);
    const { out, ms } = timed(() => stripParenComments(line));
    expect(out).toBe(line);
    expect(ms).toBeLessThan(100);
  });
});

describe('hasPercentEnvelope (was quadratic on blank-line runs)', () => {
  const cases = [
    '%\nG1',
    '\n\n  %',
    '  %',
    'G1\n%',
    'G1 %',
    '\r\n%',
    '\uFEFF%',
    '\u2028%',
    'x\u2029 %',
    'G1\r\n\r\n %\r\n',
    'M3 %',
    '',
    '(a) %',
    '\u00a0%',
    '\n\n\nx %',
    'x\n \n %',
    'x\r%',
    'x\u2028%',
    'no envelope here'
  ];

  it.each(cases)('%j matches /^\\s*%/m', (text) => {
    expect(hasPercentEnvelope(text)).toBe(/^\s*%/m.test(text));
  });

  it('literal results', () => {
    expect(hasPercentEnvelope('%\nG1')).toBe(true);
    expect(hasPercentEnvelope('\n\n  %')).toBe(true);
    expect(hasPercentEnvelope('G1 %')).toBe(false);
    expect(hasPercentEnvelope('\r\n%')).toBe(true);
    expect(hasPercentEnvelope('x\n \n %')).toBe(true);
  });

  it('a 64 KiB run of blank lines returns promptly (old regex: ~5 s)', () => {
    const { out, ms } = timed(() => hasPercentEnvelope('\n'.repeat(65536) + 'x'));
    expect(out).toBe(false);
    expect(ms).toBeLessThan(100);
  });
});

describe('CNC detection on a hostile 64 KiB head (call sites)', () => {
  const detect = (headText: string) =>
    timed(() =>
      createDialectRunner([grblLaser(), grblMill(), linuxCnc()]).createRun({
        selection: 'auto',
        headText,
        tailText: ''
      })
    );

  it('an unmatched-`(` head is scored promptly (old regex: ~4 s)', () => {
    expect(detect('('.repeat(65536)).ms).toBeLessThan(500);
  });

  it('a blank-line head with a spindle word reaches the % check promptly (old regex: ~5 s)', () => {
    expect(detect('\n'.repeat(65536) + 'M3').ms).toBeLessThan(500);
  });
});

describe('parseKeyValue (was quadratic on an all-whitespace value)', () => {
  const OLD = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*\S)\s*$/;
  const oldKv = (c: string): { key: string; value: string } | null => {
    const m = OLD.exec(c);
    return m === null ? null : { key: m[1].toLowerCase(), value: m[2] };
  };
  const cases = [
    'a=1',
    'a = 1',
    'key: value here',
    'a=',
    'a=   ',
    '  a =  x  y  ',
    '1a=2',
    'a b=c',
    'filament_type = PLA;PETG ',
    '_x:y',
    '',
    ' =',
    'a==b',
    'a=\tx\t',
    'Total_Layers : 120',
    // trailing line terminators (a CRLF file's comments end in `\r`)
    'bed_shape = 0x0,250x0\r',
    'bed_shape = 0x0,250x0\r\n',
    'MINX:0.5\r',
    'a=1' + String.fromCharCode(0x2028),
    'a=1' + String.fromCharCode(0x2029) + ' ',
    'a=1\n',
    // an interior terminator fails in both
    'a=1\r2',
    'a=x\ny'
  ];

  it.each(cases)('%j matches the old regex', (text) => {
    expect(parseKeyValue(text)).toEqual(oldKv(text));
  });

  it('literal results', () => {
    expect(parseKeyValue('  Key = a  b  ')).toEqual({ key: 'key', value: 'a  b' });
    expect(parseKeyValue('a=   ')).toBeNull();
    expect(parseKeyValue('bed_shape = 0x0,250x0\r')).toEqual({ key: 'bed_shape', value: '0x0,250x0' });
    expect(parseKeyValue('MINX:0.5\r\n')).toEqual({ key: 'minx', value: '0.5' });
    expect(parseKeyValue('a=1' + String.fromCharCode(0x2028))).toEqual({ key: 'a', value: '1' });
    expect(parseKeyValue('a=1\r2')).toBeNull();
  });

  it('`a=` + 64 KiB of spaces returns promptly (old regex: ~5 s)', () => {
    const { out, ms } = timed(() => parseKeyValue('a=' + ' '.repeat(65536)));
    expect(out).toBeNull();
    expect(ms).toBeLessThan(100);
  });
});
