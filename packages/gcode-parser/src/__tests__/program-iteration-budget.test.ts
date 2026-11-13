/*
 * One program iteration budget for a whole parse (#598, DD-017 §4.5). maxProgramIterations bounds the TOTAL of O-word
 * loop work and canned-cycle L repeats, not each cycle on its own: one unit per L repeat (never per segment), a
 * block always draws at least once, and a clamp warns `canned-cycle-repeat-limit` (deduped, first message kept).
 */
import { describe, expect, it } from 'vitest';
import { MoveKind } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../parse.js';

const lim = (maxProgramIterations: number) => ({ limits: { maxProgramIterations } }) as never;

/** X of every plunge (Cut) segment, rounded to 4 decimals. */
function plungeXs(r: ReturnType<typeof parseGcodeToIR>): number[] {
  const s = r.ir.segments;
  const out: number[] = [];
  for (let i = 0; i < s.count; i++) if ((s.kind[i] & MoveKind.Cut) !== 0) out.push(Math.round(s.x1[i] * 1e4) / 1e4);
  return out;
}
const warning = (r: ReturnType<typeof parseGcodeToIR>, code: string) =>
  r.ir.header.warnings.find((w) => w.code === code);

// G91: every hole steps X by 1 from X0, so hole n plunges at X = n.
const SETUP = 'G90\nG0 X0 Y0 Z1\nG91\n';
const cycle = (l: number) => `G81 X1 Y0 Z-0.5 R0.1 L${l}\n`;
const loop = (count: number) => `o1 repeat [${count}]\nG1 X0\no1 endrepeat\n`;

describe('canned-cycle L repeats share the program iteration budget', () => {
  it('five L1e9 blocks at limit 1000 drill 1000, 1, 1, 1, 1 holes (1004), warning count 5', () => {
    const r = parseGcodeToIR(SETUP + cycle(1_000_000_000).repeat(5), lim(1000));
    const xs = plungeXs(r);
    expect(xs).toHaveLength(1004);
    expect(xs.slice(995)).toEqual([996, 997, 998, 999, 1000, 1001, 1002, 1003, 1004]);
    const w = warning(r, 'canned-cycle-repeat-limit');
    expect(w?.message).toBe(
      'L1000000000 exceeds the program iteration budget (limit 1000, 1000 left); the cycle repeats 1000 times.'
    );
    expect(w?.count).toBe(5);
  });

  it('those five blocks spend all 1000 units: a following O-word loop stops at its first pass', () => {
    const r = parseGcodeToIR(SETUP + cycle(1_000_000_000).repeat(5) + loop(1), lim(1000));
    expect(plungeXs(r)).toHaveLength(1004);
    expect(warning(r, 'rs274-iteration-limit')?.message).toBe(
      'program iteration limit 1000 reached; execution stopped'
    );
  });

  it('an L1 block after the budget is spent is not clamped and does not warn', () => {
    const r = parseGcodeToIR(SETUP + cycle(1_000_000_000).repeat(5) + cycle(1), lim(1000));
    expect(plungeXs(r)).toHaveLength(1005);
    expect(warning(r, 'canned-cycle-repeat-limit')?.count).toBe(5);
  });

  it('at the limit across two blocks: L2 + L2 at limit 4 drill 4 holes with no warning', () => {
    const r = parseGcodeToIR(SETUP + cycle(2) + cycle(2), lim(4));
    expect(plungeXs(r)).toEqual([1, 2, 3, 4]);
    expect(warning(r, 'canned-cycle-repeat-limit')).toBeUndefined();
  });

  it('one over across two blocks: L2 + L3 at limit 4 drill 4 holes and warn about the second', () => {
    const r = parseGcodeToIR(SETUP + cycle(2) + cycle(3), lim(4));
    expect(plungeXs(r)).toEqual([1, 2, 3, 4]);
    expect(warning(r, 'canned-cycle-repeat-limit')?.message).toBe(
      'L3 exceeds the program iteration budget (limit 4, 2 left); the cycle repeats 2 times.'
    );
  });
});

describe('O-word loops and canned cycles draw from one budget', () => {
  it('a repeat loop then a cycle: the cycle gets what the loop left (limit 10, loop uses 6, L10 → 4 holes)', () => {
    const r = parseGcodeToIR(SETUP + loop(3) + cycle(10), lim(10));
    expect(plungeXs(r)).toEqual([1, 2, 3, 4]);
    expect(warning(r, 'canned-cycle-repeat-limit')?.message).toBe(
      'L10 exceeds the program iteration budget (limit 10, 4 left); the cycle repeats 4 times.'
    );
    expect(warning(r, 'rs274-iteration-limit')).toBeUndefined();
  });

  it('a cycle then a repeat loop: the loop stops when the cycle spent the budget (limit 10, L8, repeat [5])', () => {
    const r = parseGcodeToIR(SETUP + cycle(8) + loop(5), lim(10));
    expect(plungeXs(r)).toHaveLength(8);
    expect(warning(r, 'rs274-iteration-limit')?.message).toBe('program iteration limit 10 reached; execution stopped');
  });

  it('a cycle inside a repeat loop is charged per hole: repeat [10] of L30 at limit 100 drills 30+30+30+2 = 92', () => {
    const src = SETUP + 'o1 repeat [10]\n' + cycle(30) + 'o1 endrepeat\n';
    const r = parseGcodeToIR(src, lim(100));
    expect(plungeXs(r)).toHaveLength(92);
    expect(warning(r, 'canned-cycle-repeat-limit')?.message).toBe(
      'L30 exceeds the program iteration budget (limit 100, 2 left); the cycle repeats 2 times.'
    );
    expect(warning(r, 'rs274-iteration-limit')?.message).toBe('program iteration limit 100 reached; execution stopped');
  });

  it('a spent budget reads "none left" and "runs once" when that is the first message kept', () => {
    const r = parseGcodeToIR(SETUP + loop(2) + cycle(5), lim(4));
    expect(plungeXs(r)).toEqual([1]);
    expect(warning(r, 'canned-cycle-repeat-limit')?.message).toBe(
      'L5 exceeds the program iteration budget (limit 4, none left); the cycle runs once.'
    );
  });

  it('one unit left reads "1 left" and "runs once"', () => {
    const r = parseGcodeToIR(SETUP + loop(2) + cycle(5), lim(5));
    expect(plungeXs(r)).toEqual([1]);
    expect(warning(r, 'canned-cycle-repeat-limit')?.message).toBe(
      'L5 exceeds the program iteration budget (limit 5, 1 left); the cycle runs once.'
    );
  });
});

describe('bounded cost', () => {
  // The total, not each block, is capped: 2000 L1e9 blocks at cap 1e4 drill 1e4 + 1999 zero-length holes (4 segments
  // each, plus the setup move). Capping each block alone drills 2e7 holes and runs into the buffer limit after ~15 s on
  // the shared box. The cap is 1e4, not 1e7: 1e7 holes take ~15 s by themselves.
  it('2000 L1e9 blocks at cap 1e4 finish fast with 1 + 4 × 11999 segments', () => {
    const src = 'G90\nG0 X1 Y1 Z2\n' + 'G81 X1 Y1 Z2 R2 L1000000000\n'.repeat(2000);
    const t0 = Date.now();
    const r = parseGcodeToIR(src, lim(10_000));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.ir.segments.count).toBe(47_997);
    expect(r.stats.stopReason).toBeUndefined();
  });
});
