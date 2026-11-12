/**
 * #525: a G2/G3 arc whose points cannot be stored as float32 made the parser loop synchronously for as long
 * as its arc length said (~3.8e39 iterations for a 3e38 radius). #521 drops each out-of-range segment, but
 * the dropped segments did not count toward `maxSegments`, so neither the budget nor cancel() could stop it.
 *
 * Two fixes, each pinned here: dropped segments count toward the segment budget, and an O(1) pre-check
 * drops the whole arc when its target or its centre ± radius box is out of range. Every test passes
 * `maxSegments: 1000` and a short timeout, so a regression fails fast instead of hanging the worker.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../index';

const BIG = '3' + '0'.repeat(38); // 3e38, inside float32 (max 3.4028e38)
const FAST = 5_000;

function parse(src: string, maxSegments = 1000) {
  const t0 = Date.now();
  const { ir, stats } = parseGcodeToIR(src, { limits: { maxSegments } });
  const ms = Date.now() - t0;
  const oor = ir.header.warnings.filter((w) => w.code === 'number-out-of-range');
  return { ir, ms, count: ir.segments.count, stop: stats.stopReason?.code, oor };
}

// The #525 repro: G91 pushes the position to 6e38 (the second move is dropped, the position advances),
// then G90 and an arc of radius 3e38 around it.
const REPRO_HEAD = `G91\nG1 X1 E1\nG1 X${BIG}\nG1 X${BIG}\nG90\n`;

describe('arcs beyond the float32 range (#525)', () => {
  it(
    'the repro returns at once: the arc is dropped whole, with one deduped warning',
    () => {
      const r = parse(`${REPRO_HEAD}G2 I${BIG} J0 E1\n`);
      expect(r.ms).toBeLessThan(1000);
      expect(r.count).toBe(2);
      expect(r.stop).toBeUndefined();
      expect(r.oor).toHaveLength(1);
      expect(r.oor[0].count).toBe(2);
      expect(r.oor[0].message).toBe(
        'a stored position is beyond the float32 range the toolpath stores; segment dropped'
      );
    },
    FAST
  );

  it(
    'the repro with J omitted returns at once too',
    () => {
      const r = parse(`${REPRO_HEAD}G2 I${BIG} E1\n`);
      expect(r.ms).toBeLessThan(1000);
      expect(r.count).toBe(2);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(2);
    },
    FAST
  );

  it(
    'an arc whose box overflows on the low side is dropped whole',
    () => {
      const r = parse(`G1 X1 E1\nG2 I-${BIG} J0 E1\n`);
      expect(r.count).toBe(1);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(1);
    },
    FAST
  );

  it(
    'an arc whose box overflows on the high side is dropped whole',
    () => {
      const r = parse(`G1 X1 E1\nG2 I${BIG} J0 E1\n`);
      expect(r.count).toBe(1);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(1);
    },
    FAST
  );

  it(
    'an arc whose box overflows on Y is dropped whole',
    () => {
      const r = parse(`G1 X1 E1\nG2 I0 J${BIG} E1\n`);
      expect(r.count).toBe(1);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(1);
    },
    FAST
  );

  it(
    'a small arc to an out-of-range target is dropped whole, not drawn up to the last chord',
    () => {
      // G91: the arc starts at 1e38 with radius 1, so its box is in range, but its target is 4e38.
      const r = parse(`G91\nG1 X1${'0'.repeat(38)} E1\nG2 X${BIG} Y0 I1 J0 E1\n`);
      expect(r.count).toBe(1);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(1);
    },
    FAST
  );

  it(
    'the first arc of a file is checked against the origin it would set (its own start)',
    () => {
      // After a probe, G92 resyncs X to -3e38 with no segment emitted yet. The origin will be the arc's
      // start, so the box's high side (+3e38) is 6e38 from it: out of range.
      const r = parse(`G31 X10\nG92 X-${BIG}\nG2 I${BIG} J0 E1\n`);
      expect(r.count).toBe(0);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(1);
    },
    FAST
  );

  it(
    'dropped segments count toward maxSegments, so the budget stops a run of them',
    () => {
      const r = parse(`G91\nG1 X${BIG} E1\n${`G1 X${BIG} E1\n`.repeat(10)}`, 4);
      expect(r.count).toBe(1);
      expect(r.stop).toBe('E_LIMIT_SEGMENTS');
      expect(r.oor[0].count).toBe(3);
    },
    FAST
  );

  it(
    'a dropped arc counts toward maxSegments too',
    () => {
      const r = parse(`G1 X1 E1\nG2 I${BIG} J0 E1\nG2 I${BIG} J0 E1\nG2 I${BIG} J0 E1\n`, 3);
      expect(r.count).toBe(1);
      expect(r.stop).toBe('E_LIMIT_SEGMENTS');
      expect(r.oor[0].count).toBe(2);
    },
    FAST
  );

  it(
    'the position after a dropped arc is its target, so the next move is stored from there',
    () => {
      const r = parse(`G1 X1 E1\nG2 X5 Y0 I${BIG} J0 E1\nG1 Y1 E1\n`);
      expect(r.count).toBe(2);
      expect(r.ir.segments.x0[1]).toBe(5);
      expect(r.ir.segments.x1[1]).toBe(5);
      expect(r.ir.segments.y1[1]).toBe(1);
    },
    FAST
  );

  it(
    'an in-range arc still interpolates (control)',
    () => {
      // Clockwise from (10,0) to (0,10) around the origin is the 270° way: 1 line + 95 arc chords.
      const r = parse(`G1 X10 Y0 E1\nG2 X0 Y10 I-10 J0 E1\n`);
      expect(r.count).toBe(96);
      expect(r.stop).toBeUndefined();
      expect(r.oor).toHaveLength(0);
    },
    FAST
  );
});
