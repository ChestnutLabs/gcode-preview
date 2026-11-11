/**
 * Hostile-input hardening, second sweep: the O-word detector and the Orca/Prusa print-time comments were
 * still super-linear. Each fix is checked against a verbatim copy of the old regex and against a crafted
 * input the old regex takes seconds on.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../../../gcode-parser/src/parse';
import { grblLaser, grblMill, hasExtrusionMove, hasOWord, linuxCnc } from '../cnc';
import { orcaBambu } from '../orca-bambu';
import { prusaSlicer } from '../prusaslicer';
import { createDialectRunner } from '../registry';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

const timed = <T>(fn: () => T): { out: T; ms: number } => {
  const t0 = performance.now();
  const out = fn();
  return { out, ms: performance.now() - t0 };
};

describe('hasOWord (was 22 s on 64 KiB of `O`)', () => {
  const OLD = /[oO][\s<]*\w*\s*(?:sub|call|if|while|do|repeat|return|endsub)\b/im;
  const cases = [
    'O100 sub',
    'O100 SUB',
    'o CALL',
    'o100 call',
    'O<name> call',
    'o<sub',
    'o< sub',
    'o<x< sub',
    'o  sub',
    'Osub',
    'Oendsub',
    'doOoend\nendsub(repeat',
    'o x\nendsub',
    'O100endsub',
    'foo sub',
    'do do',
    'dosub',
    'do',
    'sub',
    'O',
    '',
    'G1 X1 Y2',
    'o100 sub\nG1 X1\no100 endsub',
    'O100\nsub',
    'o while',
    'o iffy',
    'o if',
    'x if',
    'O100 repeat [3]',
    'O-1 sub',
    'o_1 return',
    '(o sub)'
  ];

  it.each(cases)('%j matches the old regex', (text) => {
    expect(hasOWord(text)).toBe(OLD.test(text));
  });

  it('literal results', () => {
    expect(hasOWord('O100 sub')).toBe(true);
    expect(hasOWord('o<sub')).toBe(true);
    expect(hasOWord('o<x< sub')).toBe(false);
    expect(hasOWord('dosub')).toBe(true);
    expect(hasOWord('do')).toBe(false);
    expect(hasOWord('x if')).toBe(false);
    expect(hasOWord('G1 X1 Y2')).toBe(false);
  });

  it('agrees with the old regex on 20,000 seeded random strings', () => {
    let seed = 0x9e3779b9;
    const rand = (n: number): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n | 0;
    };
    const tokens = ['o', 'O', '<', ' ', '\t', '\n', 'sub', 'call', 'if', 'do', 'while', 'repeat', 'return', 'endsub'];
    tokens.push('end', 's', 'u', 'b', '1', 'x', '_', '-', '(', ')', 'i', 'f', 'oo', 'Oo', 'dosub', 'ifo');
    let trues = 0;
    for (let n = 0; n < 20000; n++) {
      let s = '';
      for (let k = rand(10); k > 0; k--) s += tokens[rand(tokens.length)];
      const expected = OLD.test(s);
      if (expected) trues++;
      if (hasOWord(s) !== expected) throw new Error('mismatch on ' + JSON.stringify(s));
    }
    // the generator must exercise both outcomes, or the equality above proves nothing
    expect(trues).toBeGreaterThan(1000);
    expect(trues).toBeLessThan(19000);
  });

  it('64 KiB of `O` returns promptly (old regex: ~22 s)', () => {
    const { out, ms } = timed(() => hasOWord('O'.repeat(65536)));
    expect(out).toBe(false);
    expect(ms).toBeLessThan(100);
  });

  it('detection on a 64 KiB `O` head is prompt', () => {
    const { ms } = timed(() =>
      createDialectRunner([grblLaser(), grblMill(), linuxCnc()]).createRun({
        selection: 'auto',
        headText: 'O'.repeat(65536),
        tailText: ''
      })
    );
    expect(ms).toBeLessThan(100);
  });
});

describe('hasExtrusionMove (was 7 s on a 64 KiB head of `G1`)', () => {
  // Verbatim copy of the old `scoreEvidence` extrusion regex. Its input is `;`-stripped per line.
  const OLD = /G0*[0-3](?!\d)[^\n;]*E-?[.\d]/i;

  it('literal results', () => {
    expect(hasExtrusionMove('G1 X1 E2')).toBe(true);
    expect(hasExtrusionMove('G01E.5')).toBe(true);
    expect(hasExtrusionMove('g2 x1 e-.3')).toBe(true);
    expect(hasExtrusionMove('G0003 E1')).toBe(true);
    expect(hasExtrusionMove('G13 E1\nG1 X1\nE2')).toBe(false);
    expect(hasExtrusionMove('G4 E1')).toBe(false);
    expect(hasExtrusionMove('G1 E-')).toBe(false);
    expect(hasExtrusionMove('M67 E0 Q50')).toBe(false);
    // `[^\n;]` in the old regex crosses CR and U+2028, so these still count as one line.
    expect(hasExtrusionMove('G1 X1\rE2')).toBe(true);
    expect(hasExtrusionMove('G1 X1' + LS + 'E2')).toBe(true);
  });

  it('agrees with the old regex on 20,000 seeded random `;`-free strings', () => {
    let seed = 0x2545f491;
    const rand = (n: number): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n | 0;
    };
    const tokens = ['G', 'g', '0', '1', '2', '3', '4', '13', 'E', 'e', '-', '.', '5', ' ', '\n', '\r', 'X1', 'M3'];
    tokens.push('G1', 'G0', 'g2', 'G01', 'G13', ' E1', 'E.5', 'E-', 'e-.3', 'E-1');
    let trues = 0;
    for (let n = 0; n < 20000; n++) {
      let s = '';
      for (let k = rand(12); k > 0; k--) s += tokens[rand(tokens.length)];
      const expected = OLD.test(s);
      if (expected) trues++;
      if (hasExtrusionMove(s) !== expected) throw new Error('mismatch on ' + JSON.stringify(s));
    }
    // the generator must exercise both outcomes, or the equality above proves nothing
    expect(trues).toBeGreaterThan(1000);
    expect(trues).toBeLessThan(19000);
  });

  it('detection on a 64 KiB `G1` head is prompt (old regex: ~7 s)', () => {
    const { ms } = timed(() =>
      createDialectRunner([grblLaser(), grblMill(), linuxCnc()]).createRun({
        selection: 'auto',
        headText: 'G1'.repeat(32768),
        tailText: ''
      })
    );
    expect(ms).toBeLessThan(100);
  });
});

function parseWith(adapter: ReturnType<typeof orcaBambu> | ReturnType<typeof prusaSlicer>, text: string) {
  const run = createDialectRunner([adapter]).createRun({
    selection: 'auto',
    headText: text.slice(0, 64 * 1024),
    tailText: text.slice(-16 * 1024)
  });
  expect(run).not.toBeNull();
  const result = parseGcodeToIR(text, { onComment: run!.onComment, onCommand: run!.onCommand });
  return run!.finalize(result.ir).metadata;
}

describe('Orca/Bambu `total estimated time` comment', () => {
  const gcode = (comment: string): string =>
    ['; generated by OrcaSlicer 2.0.0', 'G1 X0 Y0 Z0.2 F1200', 'G1 X10 Y0 E1', comment, ''].join('\n');
  const estimate = (comment: string) => parseWith(orcaBambu(), gcode(comment))?.printEstimate?.seconds;

  it('literal results, identical to the previous regex', () => {
    expect(estimate('; total estimated time: 1h 2m 3s')).toBe(3723);
    expect(estimate('; model printing time:5m')).toBe(300);
    expect(estimate('; TOTAL ESTIMATED TIME: 5m')).toBe(300);
    expect(estimate('; total estimated time:')).toBeUndefined();
    expect(estimate('; total estimated time: garbage')).toBeUndefined();
  });

  it('an interior U+2028 / U+2029 ends the value in both regexes: no estimate', () => {
    expect(estimate('; total estimated time: 1h 2m' + LS + ' 3s')).toBeUndefined();
    expect(estimate('; total estimated time: 1h 2m' + PS + ' 3s')).toBeUndefined();
  });

  it('spaces + junk + U+2028 returns promptly (old regex: ~5 s)', () => {
    const { out, ms } = timed(() => estimate('; total estimated time:' + ' '.repeat(60000) + 'x' + LS + 'y'));
    expect(out).toBeUndefined();
    expect(ms).toBeLessThan(100);
  });
});

describe('PrusaSlicer `estimated printing time (normal mode)` comment', () => {
  const gcode = (comment: string): string =>
    ['; generated by PrusaSlicer 2.7.0 on 2024-01-01', 'G1 X0 Y0 Z0.2 F1200', 'G1 X10 Y0 E1', comment, ''].join('\n');
  const estimate = (comment: string) => parseWith(prusaSlicer(), gcode(comment))?.printEstimate?.seconds;

  it('literal results, identical to the previous regex', () => {
    expect(estimate('; estimated printing time (normal mode) = 37m 15s')).toBe(2235);
    expect(estimate('; estimated printing time (normal mode)=45s')).toBe(45);
    expect(estimate('; ESTIMATED PRINTING TIME (NORMAL MODE) = 5m')).toBe(300);
    expect(estimate('; estimated printing time (normal mode) =')).toBeUndefined();
    expect(estimate('; estimated printing time (normal mode) = garbage')).toBeUndefined();
  });

  it('an interior U+2028 / U+2029 ends the value in both regexes: no estimate', () => {
    expect(estimate('; estimated printing time (normal mode) = 37m' + LS + ' 15s')).toBeUndefined();
    expect(estimate('; estimated printing time (normal mode) = 37m' + PS + ' 15s')).toBeUndefined();
  });

  it('spaces + junk + U+2028 returns promptly (old regex: ~5 s)', () => {
    const { out, ms } = timed(() =>
      estimate('; estimated printing time (normal mode) =' + ' '.repeat(60000) + 'x' + LS + 'y')
    );
    expect(out).toBeUndefined();
    expect(ms).toBeLessThan(100);
  });
});
